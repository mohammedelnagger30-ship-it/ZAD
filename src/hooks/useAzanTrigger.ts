import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import type { Settings } from '@/db/database';
import {
  addCalendarDays,
  calculatePrayerTimes,
  calculatePrayerTimesForDay,
  calendarDayInZone,
  getIqamahTime,
  getNextPrayer,
  getPrayerTimeZone,
  type PrayerTimeInfo,
} from '@/utils/prayerTimes';
import { hasNotificationPermission } from '@/utils/notifications';
import { onAdhanOverlay } from '@/utils/adhanOverlay';
import { iqamahPlayUrl } from '@/data/iqamahSound';
import { onClockChange, trustedNow, trustedNowMs } from '@/utils/clock';
import type { PrayerKey } from '@/utils/prayerTracker';

export interface AzanTriggerState {
  isOpen: boolean;
  mode: 'adhan' | 'iqamah';
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
 * How late the in-app iqamah may still ring.
 *
 * Shorter than the adhan's window on purpose: the adhan announces the *start* of a
 * window of time, but the جماعة is a moment — a congregation standing in prayer, and
 * the phone then calling it two minutes late, is worse than silence. Past this the
 * alert has had its say; the notification (when there is permission for one) has
 * already rung at the right minute regardless.
 */
const IQAMAH_CATCH_UP_MS = 2 * 60_000;

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
const FIRED_IQAMAH_STORAGE_KEY = 'zad-azan-fired-iqamah';
const FIRED_RETENTION_MS = 24 * 60 * 60_000;

/**
 * Prayers that already triggered, keyed by their exact instant.
 *
 * Kept across remounts (settings changes re-run the effect) and reloads, otherwise a
 * refresh a few seconds after the adhan would open the page a second time. The iqamah
 * keeps its own set for the same reason: a page reload between the adhan and the
 * جماعة must not ring the iqamah twice, and must not lose the one that already rang.
 */
function readFired(storageKey: string): Set<number> {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return new Set<number>();
    const cutoff = trustedNowMs() - FIRED_RETENTION_MS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<number>();
    return new Set(parsed.filter((v): v is number => typeof v === 'number' && v > cutoff));
  } catch {
    return new Set<number>();
  }
}

function writeFired(storageKey: string, fired: Set<number>): void {
  try {
    const cutoff = trustedNowMs() - FIRED_RETENTION_MS;
    const kept = [...fired].filter((instant) => instant > cutoff);
    fired.clear();
    for (const instant of kept) fired.add(instant);
    sessionStorage.setItem(storageKey, JSON.stringify(kept));
  } catch {
    // Storage unavailable: worst case a sound can repeat after a reload.
  }
}

function readFiredPrayers(): Set<number> {
  return readFired(FIRED_STORAGE_KEY);
}

function writeFiredPrayers(fired: Set<number>): void {
  writeFired(FIRED_STORAGE_KEY, fired);
}

export function useAzanTrigger(settings: Settings | null) {
  const [azanState, setAzanState] = useState<AzanTriggerState>({
    isOpen: false,
    mode: 'adhan',
    prayerKey: 'fajr',
    isPreview: false,
  });

  const firedRef = useRef<Set<number> | null>(null);
  if (firedRef.current === null) {
    firedRef.current = readFiredPrayers();
  }

  /** جماعة instants that already rang in the WebView — see {@link readFired}. */
  const firedIqamahRef = useRef<Set<number> | null>(null);
  if (firedIqamahRef.current === null) {
    firedIqamahRef.current = readFired(FIRED_IQAMAH_STORAGE_KEY);
  }

  /** The iqamah's own audio element — one at a time, stopped when the hook goes away. */
  const iqamahAudioRef = useRef<HTMLAudioElement | null>(null);

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

  const isIqamahFired = useCallback(
    (instant: number) => firedIqamahRef.current?.has(instant) ?? false,
    [],
  );

  const markIqamahFired = useCallback((instant: number) => {
    const fired = firedIqamahRef.current ?? new Set<number>();
    firedIqamahRef.current = fired;
    fired.add(instant);
    writeFired(FIRED_IQAMAH_STORAGE_KEY, fired);
  }, []);

  const unmarkIqamahFired = useCallback((instant: number) => {
    firedIqamahRef.current?.delete(instant);
    if (firedIqamahRef.current) writeFired(FIRED_IQAMAH_STORAGE_KEY, firedIqamahRef.current);
  }, []);

  /**
   * Ring the جماعة's own recording from the WebView — the path used whenever the
   * system alarm is not there to do it (notification permission refused, or the web
   * build, which arms no native queue at all).
   *
   * The instant is marked *before* the call: a sound that starts must not be replayed
   * by the next sweep. If the WebView refuses playback — Chrome's autoplay rule can
   * still say no when nothing has been touched yet — the mark is lifted so the sweep
   * inside the catch-up window can try again, rather than the إقامة silently vanishing.
   */
  const playIqamah = useCallback(
    (instant: number) => {
      markIqamahFired(instant);
      iqamahAudioRef.current?.pause();
      const audio = new Audio(iqamahPlayUrl());
      iqamahAudioRef.current = audio;
      const release = () => {
        if (iqamahAudioRef.current === audio) iqamahAudioRef.current = null;
      };
      audio.addEventListener('ended', release);
      void audio.play().catch(() => {
        release();
        unmarkIqamahFired(instant);
      });
    },
    [markIqamahFired, unmarkIqamahFired],
  );

  // Whatever is still speaking when the app (or this hook) goes away must stop: an
  // orphaned recording would keep playing over the next screen with no way to silence
  // it, and a settings change re-runs this hook and would otherwise stack a second one.
  useEffect(() => () => {
    iqamahAudioRef.current?.pause();
    iqamahAudioRef.current = null;
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
              mode: 'adhan',
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
      setAzanState({ isOpen: true, mode: 'adhan', prayerKey, prayerName, prayerTime, isPreview, fromNotification: false });
    },
    [],
  );

  const closeAzan = useCallback(() => {
    setAzanState((prev) => ({ ...prev, isOpen: false, isPreview: false, mode: 'adhan' }));
  }, []);

  /** Open the iqamah page (for the جماعة call). Mirrors openAzan but for the iqamah. */
  const openIqamah = useCallback(
    (
      prayerKey: PrayerKey,
      prayerName: string | undefined,
      iqamahTime: Date | undefined,
      options: { fromNotification?: boolean; force?: boolean } = {},
    ) => {
      const instant = iqamahTime?.getTime();
      // `force` is for notification taps: the user asked for the page explicitly.
      if (instant != null && !options.force && isIqamahFired(instant)) return;
      if (instant != null) markIqamahFired(instant);

      setAzanState((prev) =>
        // Same prayer already on screen: leave it alone so the audio is not restarted.
        prev.isOpen && prev.prayerKey === prayerKey && prev.mode === 'iqamah'
          ? prev
          : {
              isOpen: true,
              mode: 'iqamah',
              prayerKey,
              prayerName,
              prayerTime: iqamahTime,
              isPreview: false,
              fromNotification: options.fromNotification ?? false,
            },
      );
    },
    [isIqamahFired, markIqamahFired],
  );

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
      if (!extra || !extra.prayerKey) return;

      // Handle iqamah notifications (type 'iqamah') — open the iqamah page
      if (extra.type === 'iqamah') {
        openIqamah(
          extra.prayerKey as PrayerKey,
          typeof extra.prayerName === 'string' ? extra.prayerName : undefined,
          typeof extra.time === 'string' ? new Date(extra.time) : undefined,
          { fromNotification: true, force },
        );
        return;
      }

      // Handle prayer notifications (type 'prayer') — open the adhan page
      if (extra.type !== 'prayer') return;
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

  // 1b. Native takeover path: the adhan page can now open itself while the app is
  // closed (full-screen intent), and at the prayer instant while it is open.
  // `adhanLaunch` is the activity being brought forward — treat it like a tap.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let off: (() => void) | undefined;

    void onAdhanOverlay((data, source) => {
      if (!data?.prayerKey) return;
      const isIqamah = data.type === 'iqamah';
      if (isIqamah) {
        openIqamah(
          data.prayerKey as PrayerKey,
          data.prayerName,
          typeof data.time === 'string' ? new Date(data.time) : undefined,
          { fromNotification: true, force: source === 'launch' },
        );
      } else {
        openAzan(
          data.prayerKey as PrayerKey,
          data.prayerName,
          typeof data.time === 'string' ? new Date(data.time) : undefined,
          { fromNotification: true, force: source === 'launch' },
        );
      }
    })
      .then((remove) => {
        if (cancelled) remove();
        else off = remove;
      })
      .catch((err) => {
        console.warn('Adhan overlay listener setup failed:', err);
      });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [openAzan]);

  // 2. Permission state decides who owns the sound at prayer time (see `openForPrayer`).
  useEffect(() => {
    void refreshNotificationPermission();
  }, [refreshNotificationPermission]);

  // 3. Exact trigger: one timeout aimed at the next prayer, plus a sweep that catches
  // prayers that came due while timers were frozen.
  //
  // The timers below read nine settings and no more, so the effect is aimed by those
  // nine and not by the object: saving anything else — font size, a translation toggle,
  // the snooze length — used to tear down and re-arm every pending adhan and جماعة
  // timeout, which is precisely where a missed or doubled call would be born. Same idea
  // as `scheduleFingerprint` in App.tsx.
  const scheduleFingerprint = settings
    ? [
        settings.latitude,
        settings.longitude,
        settings.calcMethod,
        settings.asrMadhab,
        settings.timeZone,
        settings.cityName,
        settings.adhanSound,
        settings.iqamahSound,
        JSON.stringify(settings.prayerTimeAdjustments),
        JSON.stringify(settings.iqamahOffsets),
      ].join('|')
    : '';
  useEffect(() => {
    if (!settings || settings.latitude == null || settings.longitude == null) return;

    const { latitude, longitude, calcMethod, asrMadhab } = settings;
    const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);

    let disposed = false;
    let dueTimer: number | undefined;
    let iqamahTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let iqamahFallbackTimer: number | undefined;
    let pendingInstant: number | undefined;
    let pendingIqamahInstant: number | undefined;

    /**
     * Whether anything in the WebView should ring the جماعة at all. The adhan is the
     * master switch: with it off there is no call being made to, so repeating it for
     * the إقامة would announce a prayer the user asked the app not to sound.
     */
    const iqamahSoundEnabled = settings.iqamahSound !== false && settings.adhanSound;

    /**
     * Every جماعة instant still computable — today's and tomorrow's — sorted, each one
     * its prayer's own time plus the offset the mosque is set to.
     *
     * Tomorrow is included because the last prayer of the day has tomorrow's إقامة
     * nowhere near it: when the queue is rebuilt late at night, fajr's جماعة is the
     * only one ahead, and it lives on the next calendar day.
     */
    const iqamahTimes = (): Date[] => {
      return iqamahTimesWithInfo().map((i) => i.time);
    };

    /** Same times but with prayerKey and prayerName for opening the page. */
    const iqamahTimesWithInfo = (): Array<{
      time: Date;
      prayerKey: PrayerKey;
      prayerName: string;
    }> => {
      const baseDay = calendarDayInZone(trustedNow(), timeZone);
      const out: Array<{ time: Date; prayerKey: PrayerKey; prayerName: string }> = [];
      for (const day of [baseDay, addCalendarDays(baseDay, 1)]) {
        let prayers;
        try {
          prayers = calculatePrayerTimesForDay(
            latitude, longitude, day, calcMethod, asrMadhab, settings.prayerTimeAdjustments,
          ).prayers;
        } catch (err) {
          console.warn('Iqamah time calculation failed:', err);
          continue;
        }
        for (const prayer of prayers) {
          if (prayer.name === 'sunrise') continue;
          out.push({
            time: getIqamahTime(prayer.time, prayer.name, settings.iqamahOffsets),
            prayerKey: prayer.name as PrayerKey,
            prayerName: prayer.arabicName,
          });
        }
      }
      return out.sort((a, b) => a.time.getTime() - b.time.getTime());
    };

    /**
     * Ring the إقامة from the WebView — only where nothing else is going to.
     *
     * The native notification owns this sound whenever notifications are usable: it is
     * armed at the exact minute and fires whether or not anything in the WebView is
     * awake, so playing here as well would put two copies of the same call in the air,
     * a beat apart — the exact failure the adhan's own grace window exists to avoid.
     */
    const ringIqamahIfDue = () => {
      if (disposed || !iqamahSoundEnabled) return;
      if (notificationsUsableRef.current) return;
      const now = trustedNowMs();
      for (const at of iqamahTimes()) {
        const instant = at.getTime();
        const lateBy = now - instant;
        if (lateBy < 0 || lateBy > IQAMAH_CATCH_UP_MS) continue;
        if (isIqamahFired(instant)) continue;
        playIqamah(instant);
        break; // at most one جماعة minute is inside the window
      }
    };

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
        // This branch runs precisely when the *listener* never heard the alert — the
        // flaky half of the pipeline. The alert itself was posted natively at the
        // prayer instant and is likely still ringing from its channel, so the page is
        // opened as if it came from that notification: within `SYSTEM_RING_WINDOW_MS`
        // it stays quiet (no second copy of the same call over the first), and past
        // that window it becomes the speaker itself. Without this flag the WebView
        // started its own recording on top of the still-ringing channel sound — two
        // copies of the same adhan a beat apart, which is what «الأذان بيقطع» was.
        openAzan(prayer.name as PrayerKey, prayer.arabicName, prayer.time, {
          fromNotification: true,
        });
      }, NOTIFICATION_GRACE_MS);
    };

    const openForIqamah = (prayerKey: PrayerKey, prayerName: string, iqamahTime: Date) => {
      const instant = iqamahTime.getTime();

      if (!notificationsUsableRef.current) {
        openIqamah(prayerKey, prayerName, iqamahTime);
        return;
      }
      if (pendingIqamahInstant === instant) return;

      // Give the exact system alarm time to deliver before opening the page.
      if (iqamahFallbackTimer !== undefined) window.clearTimeout(iqamahFallbackTimer);
      pendingIqamahInstant = instant;
      iqamahFallbackTimer = window.setTimeout(() => {
        iqamahFallbackTimer = undefined;
        pendingIqamahInstant = undefined;
        if (disposed || isIqamahFired(instant)) return;
        // Open the iqamah page as if the notification arrived — within the ring window
        // it stays quiet (the notification is already ringing), past it the page speaks.
        openIqamah(prayerKey, prayerName, iqamahTime, { fromNotification: true });
      }, NOTIFICATION_GRACE_MS);
    };

    const sweep = () => {
      if (disposed) return;

      let times;
      try {
        times = calculatePrayerTimes(
          latitude, longitude, trustedNow(), calcMethod, asrMadhab, timeZone,
          settings.prayerTimeAdjustments,
        );
      } catch (err) {
        console.warn('Prayer time calculation failed:', err);
        return;
      }

      // The permission flag is re-read here, immediately before it decides who owns
      // the sound, instead of being trusted from the cache filled at mount and on
      // visibilitychange. Granting notifications from Settings happens while the app
      // is in the foreground and fires no visibilitychange, so that cache stayed
      // "false" for the rest of the session: the native takeover rang the channel
      // sound at the prayer instant while `openForPrayer` took the no-permission
      // branch and played its own copy at the very same moment — two adhans, and the
      // page's "the system is already ringing" window never applied, because the page
      // thought it was the speaker.
      void refreshNotificationPermission().then(() => {
        if (disposed) return;
        const now = trustedNowMs();
        for (const prayer of times.prayers) {
          if (prayer.name === 'sunrise') continue;
          const instant = prayer.time.getTime();
          const lateBy = now - instant;
          if (lateBy < 0 || lateBy > CATCH_UP_MS) continue;
          if (isFired(instant)) continue;
          openForPrayer(prayer);
          break; // at most one prayer is inside the window
        }
        // The إقامة is checked after the permission refresh for the same reason the
        // adhan is: that flag decides whether this branch rings at all, and it is read
        // immediately before the decision rather than trusted from mount.
        ringIqamahIfDue();
      });
    };

    const arm = () => {
      if (disposed) return;
      if (dueTimer !== undefined) {
        window.clearTimeout(dueTimer);
        dueTimer = undefined;
      }
      if (iqamahTimer !== undefined) {
        window.clearTimeout(iqamahTimer);
        iqamahTimer = undefined;
      }

      // The جماعة's own clock, armed apart from the prayer's: the notification side
      // runs on exactly this minute too, and without a timer here the WebView would
      // only notice on the next 30-second sweep — half a minute late for a moment
      // that is defined by the minute it happens.
      if (iqamahSoundEnabled) {
        const nextIqamah = iqamahTimesWithInfo().find((at) => at.time.getTime() > trustedNowMs());
        if (nextIqamah) {
          const iqamahDelay = Math.min(
            Math.max(nextIqamah.time.getTime() - trustedNowMs(), 0),
            MAX_TIMEOUT_MS,
          );
          iqamahTimer = window.setTimeout(() => {
            void refreshNotificationPermission().then(() => {
              if (disposed) return;
              openForIqamah(nextIqamah.prayerKey, nextIqamah.prayerName, nextIqamah.time);
              arm();
            });
          }, iqamahDelay);
        }
      }

      let next: PrayerTimeInfo | null = null;
      try {
        next = getNextPrayer(
          latitude, longitude, calcMethod, asrMadhab, timeZone,
          settings.prayerTimeAdjustments,
        );
      } catch (err) {
        console.warn('Could not schedule the next adhan:', err);
      }
      if (!next) return;

      const delay = Math.min(Math.max(next.time.getTime() - trustedNowMs(), 0), MAX_TIMEOUT_MS);
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
    // A corrected trusted instant — a network sync, or a clock change caught by
    // the watchdog — re-points every deadline: check what is already due and
    // re-aim the next timer.
    const offClockChange = onClockChange(() => {
      sweep();
      arm();
    });

    return () => {
      disposed = true;
      if (dueTimer !== undefined) window.clearTimeout(dueTimer);
      if (iqamahTimer !== undefined) window.clearTimeout(iqamahTimer);
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      if (iqamahFallbackTimer !== undefined) window.clearTimeout(iqamahFallbackTimer);
      window.clearInterval(sweepTimer);
      document.removeEventListener('visibilitychange', handleWake);
      offClockChange();
    };
  // `settings` is read inside for the fields folded into the fingerprint above — and
  // for nothing else, which is what makes the narrow dependency safe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleFingerprint, openAzan, isFired, isIqamahFired, playIqamah, refreshNotificationPermission]);

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
    openIqamah,
  };
}
