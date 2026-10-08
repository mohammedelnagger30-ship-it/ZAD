import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { Settings } from '@/db/database';
import {
  calculatePrayerTimes,
  getNextPrayer,
  getPrayerTimeZone,
  type PrayerTimeInfo,
} from '@/utils/prayerTimes';
import { hasNotificationPermission } from '@/utils/notifications';
import type { PrayerKey } from '@/utils/prayerTracker';

export interface AzanTriggerState {
  isOpen: boolean;
  prayerKey: PrayerKey;
  prayerName?: string;
  prayerTime?: Date;
  isPreview?: boolean;
  /**
   * The system notification already sounded for this prayer, so the overlay must not
   * start a second recording on top of it.
   */
  fromNotification?: boolean;
}

/**
 * How late an in-app trigger may still open the adhan page.
 *
 * WebView timers are frozen while the screen is off, so a prayer can come due with no
 * timer running at all. Anything inside this window is still "the adhan just happened";
 * beyond it the notification has already had its say and reopening would be noise.
 */
const CATCH_UP_MS = 5 * 60_000;

/**
 * Grace period before falling back to the in-app player on native.
 *
 * The scheduled notification is an exact system alarm: it is the thing that sounds the
 * adhan while the app is closed, so it is given the first attempt. Playing from JS at
 * the same instant would run two adhans at once.
 */
const NOTIFICATION_GRACE_MS = 10_000;

/** Safety net for timers that were suspended with the screen off. */
const SWEEP_MS = 30_000;

/** setTimeout() refuses delays past ~24.8 days; prayers are never that far out. */
const MAX_TIMEOUT_MS = 2_147_000_000;

const FIRED_STORAGE_KEY = 'zad-azan-fired-prayers';
const FIRED_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Prayers that already triggered, keyed by their exact instant.
 *
 * Kept across remounts (settings changes re-run the effect) and reloads, otherwise a
 * refresh a few seconds after the adhan would open the page a second time.
 */
function readFiredPrayers(): Set<number> {
  try {
    const raw = sessionStorage.getItem(FIRED_STORAGE_KEY);
    if (!raw) return new Set<number>();
    const cutoff = Date.now() - FIRED_RETENTION_MS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<number>();
    return new Set(parsed.filter((v): v is number => typeof v === 'number' && v > cutoff));
  } catch {
    return new Set<number>();
  }
}

function writeFiredPrayers(fired: Set<number>): void {
  try {
    const cutoff = Date.now() - FIRED_RETENTION_MS;
    const kept = [...fired].filter((instant) => instant > cutoff);
    fired.clear();
    for (const instant of kept) fired.add(instant);
    sessionStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Storage unavailable: worst case the adhan page can open twice after a reload.
  }
}

export function useAzanTrigger(settings: Settings | null) {
  const [azanState, setAzanState] = useState<AzanTriggerState>({
    isOpen: false,
    prayerKey: 'fajr',
    isPreview: false,
  });

  const firedRef = useRef<Set<number> | null>(null);
  if (firedRef.current === null) {
    firedRef.current = readFiredPrayers();
  }

  /** True while notifications can actually be delivered — then the system alarm owns the sound. */
  const notificationsUsableRef = useRef(false);

  const isFired = useCallback(
    (instant: number) => firedRef.current?.has(instant) ?? false,
    [],
  );

  const markFired = useCallback((instant: number) => {
    const fired = firedRef.current ?? new Set<number>();
    firedRef.current = fired;
    fired.add(instant);
    writeFiredPrayers(fired);
  }, []);

  const openAzan = useCallback(
    (
      prayerKey: PrayerKey,
      prayerName: string | undefined,
      prayerTime: Date | undefined,
      options: { fromNotification?: boolean; force?: boolean } = {},
    ) => {
      const instant = prayerTime?.getTime();
      // `force` is for notification taps: the user asked for the adhan page explicitly,
      // even long after the prayer, so the already-fired bookkeeping must not hide it.
      if (instant != null && !options.force && isFired(instant)) return;
      if (instant != null) markFired(instant);

      setAzanState((prev) =>
        // Same prayer already on screen: leave it alone so the audio is not restarted.
        prev.isOpen && prev.prayerKey === prayerKey
          ? prev
          : {
              isOpen: true,
              prayerKey,
              prayerName,
              prayerTime,
              isPreview: false,
              fromNotification: options.fromNotification ?? false,
            },
      );
    },
    [isFired, markFired],
  );

  const triggerAzan = useCallback(
    (prayerKey: PrayerKey, prayerName?: string, prayerTime?: Date, isPreview = false) => {
      setAzanState({ isOpen: true, prayerKey, prayerName, prayerTime, isPreview, fromNotification: false });
    },
    [],
  );

  const closeAzan = useCallback(() => {
    setAzanState((prev) => ({ ...prev, isOpen: false, isPreview: false }));
  }, []);

  const refreshNotificationPermission = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      notificationsUsableRef.current = false;
      return;
    }
    try {
      notificationsUsableRef.current = await hasNotificationPermission();
    } catch {
      notificationsUsableRef.current = false;
    }
  }, []);

  // 1. Native notifications: a prayer alert arriving (app in foreground) or being tapped
  // (including the cold start where Capacitor replays the retained intent event) opens the
  // adhan page. The tap path is `force`d — that is the user asking for the page.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let recSub: PluginListenerHandle | undefined;
    let actSub: PluginListenerHandle | undefined;
    let cancelled = false;

    const handlePrayerNotification = (
      notification: { extra?: Record<string, unknown> } | undefined,
      force: boolean,
    ) => {
      const extra = notification?.extra;
      if (!extra || extra.type !== 'prayer' || !extra.prayerKey) return;
      openAzan(
        extra.prayerKey as PrayerKey,
        typeof extra.prayerName === 'string' ? extra.prayerName : undefined,
        typeof extra.time === 'string' ? new Date(extra.time) : undefined,
        { fromNotification: true, force },
      );
    };

    const setupListeners = async () => {
      try {
        recSub = await LocalNotifications.addListener('localNotificationReceived', (notification) =>
          handlePrayerNotification(notification, false),
        );
        actSub = await LocalNotifications.addListener('localNotificationActionPerformed', (action) =>
          handlePrayerNotification(action.notification, true),
        );
      } catch (err) {
        console.warn('LocalNotification listener setup failed:', err);
      } finally {
        if (cancelled) {
          recSub?.remove?.();
          actSub?.remove?.();
        }
      }
    };

    void setupListeners();

    return () => {
      cancelled = true;
      recSub?.remove?.();
      actSub?.remove?.();
    };
  }, [openAzan]);

  // 2. Permission state decides who owns the sound at prayer time (see `openForPrayer`).
  useEffect(() => {
    void refreshNotificationPermission();
  }, [refreshNotificationPermission]);

  // 3. Exact trigger: one timeout aimed at the next prayer, plus a sweep that catches
  // prayers that came due while timers were frozen.
  useEffect(() => {
    if (!settings || settings.latitude == null || settings.longitude == null) return;

    const { latitude, longitude, calcMethod, asrMadhab } = settings;
    const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);

    let disposed = false;
    let dueTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let pendingInstant: number | undefined;

    const openForPrayer = (prayer: PrayerTimeInfo) => {
      const instant = prayer.time.getTime();

      if (!notificationsUsableRef.current) {
        openAzan(prayer.name as PrayerKey, prayer.arabicName, prayer.time);
        return;
      }
      if (pendingInstant === instant) return;

      // Give the exact system alarm time to deliver before playing from JS.
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      pendingInstant = instant;
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = undefined;
        pendingInstant = undefined;
        if (disposed || isFired(instant)) return;
        openAzan(prayer.name as PrayerKey, prayer.arabicName, prayer.time);
      }, NOTIFICATION_GRACE_MS);
    };

    const sweep = () => {
      if (disposed) return;

      let times;
      try {
        times = calculatePrayerTimes(latitude, longitude, new Date(), calcMethod, asrMadhab, timeZone);
      } catch (err) {
        console.warn('Prayer time calculation failed:', err);
        return;
      }

      const now = Date.now();
      for (const prayer of times.prayers) {
        if (prayer.name === 'sunrise') continue;
        const instant = prayer.time.getTime();
        const lateBy = now - instant;
        if (lateBy < 0 || lateBy > CATCH_UP_MS) continue;
        if (isFired(instant)) continue;
        openForPrayer(prayer);
        break; // at most one prayer is inside the window
      }
    };

    const arm = () => {
      if (disposed) return;
      if (dueTimer !== undefined) {
        window.clearTimeout(dueTimer);
        dueTimer = undefined;
      }

      let next: PrayerTimeInfo | null = null;
      try {
        next = getNextPrayer(latitude, longitude, calcMethod, asrMadhab, timeZone);
      } catch (err) {
        console.warn('Could not schedule the next adhan:', err);
      }
      if (!next) return;

      const delay = Math.min(Math.max(next.time.getTime() - Date.now(), 0), MAX_TIMEOUT_MS);
      dueTimer = window.setTimeout(() => {
        sweep();
        arm();
      }, delay);
    };

    const handleWake = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshNotificationPermission().then(() => {
        if (disposed) return;
        sweep();
        arm();
      });
    };

    arm();
    const sweepTimer = window.setInterval(sweep, SWEEP_MS);
    document.addEventListener('visibilitychange', handleWake);

    return () => {
      disposed = true;
      if (dueTimer !== undefined) window.clearTimeout(dueTimer);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      window.clearInterval(sweepTimer);
      document.removeEventListener('visibilitychange', handleWake);
    };
  }, [settings, openAzan, isFired, refreshNotificationPermission]);

  // 4. Custom window event (PrayerScreen / Settings test buttons) previews the page.
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        triggerAzan(
          detail.prayerKey || 'fajr',
          detail.prayerName,
          detail.prayerTime,
          detail.isPreview ?? true
        );
      }
    };
    window.addEventListener('zad:trigger-azan', handleCustomEvent);
    return () => window.removeEventListener('zad:trigger-azan', handleCustomEvent);
  }, [triggerAzan]);

  return {
    azanState,
    triggerAzan,
    closeAzan,
  };
}
