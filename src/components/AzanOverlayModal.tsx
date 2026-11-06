import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Volume2, VolumeX, CheckCircle2, Bell, BookOpen, X, BellRing, Clock, MapPin } from 'lucide-react';
import type { Settings } from '@/db/database';
import { getAdhanSound } from '@/data/adhanSounds';
import { resolveAdhanPlayUrl } from '@/utils/adhanStore';
import { formatTime12h, getDateInTimeZone, getIqamahTime, getPrayerTimeZone } from '@/utils/prayerTimes';
import { confirmPrayer, PRAYER_LABELS_AR, type PrayerKey } from '@/utils/prayerTracker';
import { formatDateKey, formatArabicDate, getHijriDate } from '@/utils/dateUtils';
import { notificationId } from '@/utils/notifications';
import { NOTIFICATION_BRAND } from '@/utils/notificationScheduler';
import { trustedNow } from '@/utils/clock';
import { setAdhanKeepScreenOn } from '@/utils/adhanOverlay';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { useTheme } from '@/hooks/useApp';
import { COLOR_PALETTES, DEFAULT_COLOR_PALETTE } from '@/utils/colorThemes';

export interface AzanOverlayProps {
  isOpen: boolean;
  prayerKey: PrayerKey;
  prayerName?: string;
  prayerTime?: Date;
  settings: Settings;
  isPreview?: boolean;
  /**
   * This page is the «اختبار الأذان» self-test.
   *
   * The page stays silent for it whatever the channel did — a page that played its own
   * copy would report a working adhan on a phone whose channel is dead, which is the
   * one failure the test exists to catch. The replay button stays visible, so the
   * reader can tell a dead channel from a dead page.
   */
  isTest?: boolean;
  /**
   * Opened by the native adhan/iqamah notification. The notification posts at the
   * instant itself and rings from its own channel, so the page must not start a second
   * copy of the call on top of it (see `SYSTEM_RING_WINDOW_MS`).
   */
  fromNotification?: boolean;
  onClose: () => void;
  onNavigateToAdhkar?: () => void;
}

const AFTER_AZAN_DUAA = {
  title: 'دعاء ما بعد الأذان',
  text: 'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ.',
  benefit: 'حلّت له شفاعتي يوم القيامة (رواة البخاري)',
};

/**
 * How long the notification's own adhan counts as "still ringing".
 *
 * The prayer alert is posted at the instant itself, so an opening that arrives with it
 * (the full-screen takeover, the banner a second later) already has the adhan in the
 * air and the page stays quiet. A later opening — a tap on the notification minutes
 * afterwards, a preview, the in-app timer — has no sound behind it, so the page starts
 * it by itself.
 *
 * The window covers the longest voice we ship (فَجر ~3:44, مكة ~3:23): starting a
 * second copy of the adhan while the first is still ringing would be worse than a page
 * opened after the call already finished, which carries the words of that call anyway.
 */
const SYSTEM_RING_WINDOW_MS = 4 * 60_000;

/**
 * Hard cap on holding the screen awake with the adhan page open: the page normally
 * releases it on close, this only covers a page left open by itself.
 */
const KEEP_SCREEN_ON_MAX_MS = 5 * 60_000;

/**
 * How long the "first touch starts it" retry stays armed after auto-play was refused.
 *
 * A takeover can open while nobody holds the phone (over the lock screen, screen on in
 * a pocket), and the WebView then needs a gesture before it will make a sound. That
 * retry is the right answer for the moment — but not hours later: the first touch of a
 * person picking the phone up at Asr must not start a Dhuhr that never rang. Past this
 * window the visible fallback button remains the deliberate way in.
 */
const BLOCKED_RETRY_MAX_MS = 2 * 60_000;

export function AzanOverlayModal({
  isOpen,
  prayerKey,
  prayerName,
  prayerTime,
  settings,
  isPreview = false,
  isTest = false,
  fromNotification = false,
  onClose,
  onNavigateToAdhkar,
}: AzanOverlayProps) {
  const theme = useTheme();
  const colorPalette = theme?.colorPalette ?? (() => {
    try {
      const savedPalette = localStorage.getItem('zad:palette');
      return COLOR_PALETTES.find((item) => item.id === savedPalette)?.id ?? DEFAULT_COLOR_PALETTE;
    } catch {
      return DEFAULT_COLOR_PALETTE;
    }
  })();
  const themeMode = theme?.themeMode || 'light';
  const palette = COLOR_PALETTES.find((p) => p.id === colorPalette) ?? COLOR_PALETTES[0];
  const primary = palette.color;
  const accent = palette.accent;
  const [isPlaying, setIsPlaying] = useState(false);
  /** The WebView refused to start the adhan/iqamah without a gesture — fallback control. */
  const [blocked, setBlocked] = useState(false);
  /** The notification is ringing right now; the page's own audio stays out. */
  const [systemRinging, setSystemRinging] = useState(false);
  /**
   * A «اختبار الأذان» page: the channel is being tested, so this page stays quiet too —
   * but the replay button stays visible, which is how a dead channel gets told apart
   * from a dead page.
   */
  const [selfTestQuiet, setSelfTestQuiet] = useState(false);
  const [ended, setEnded] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [showDuaa, setShowDuaa] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** True while the modal is mounted — guards setState / callbacks fired by timers. */
  const mountedRef = useRef(true);
  /** Timers that outlive the modal (snooze reminders, web fallback) — cleared on unmount. */
  const pendingTimeouts = useRef<number[]>([]);
  const clearPending = () => {
    pendingTimeouts.current.forEach((t) => clearTimeout(t));
    pendingTimeouts.current = [];
  };
  // Back on Android dismisses the page. Before this, back during the
  // call exited the app entirely — silencing the call mid-flight.
  useOverlayDismiss(isOpen, onClose);

  // Keep the mounted flag honest and tear down any timers we armed when the
  // modal unmounts — a 10-minute snooze timer must not fire setState on a gone page.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearPending();
    };
  }, []);

  const displayName = prayerName || PRAYER_LABELS_AR[prayerKey] || 'الصلاة';
  // Whether this open may make noise at all.
  const soundEnabled = settings.adhanSound;

  // Select the adhan sound.
  const adhanSound = getAdhanSound(settings.adhanVoiceId);
  const selectedSound = adhanSound;
  const selectedPlayUrl = `/audio/${adhanSound.file}`;

  /**
   * Where the recording lives. A bundled voice is in the package, so its URL is known
   * at once; a downloaded one is answered by the store, and the play effect below waits
   * for it rather than starting a player against a path that isn't there yet.
   */
  const [audioUrl, setAudioUrl] = useState<string | null>(() =>
    selectedSound.bundled ? selectedPlayUrl : null,
  );

  useEffect(() => {
    if (selectedSound.bundled) {
      setAudioUrl(selectedPlayUrl);
      return;
    }
    let alive = true;
    const promise = resolveAdhanPlayUrl(adhanSound);
    void promise.then((url) => {
      if (alive) setAudioUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [adhanSound, selectedSound, selectedPlayUrl]);

  const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const displayTime = prayerTime
    ? formatTime12h(prayerTime, timeZone)
    : formatTime12h(trustedNow(), timeZone);
  // The جماعة follows the call by the reader's mosque offset — shown so the
  // page answers "when does the prayer *start*?" without leaving it. Previews
  // without a real instant show no iqamah rather than a fabricated one.
  const iqamahTime = prayerTime
    ? formatTime12h(getIqamahTime(prayerTime, prayerKey, settings.iqamahOffsets), timeZone)
    : null;

  // Initialize and play the audio: the adhan is meant to reach the ear together with
  // the page, without anyone pressing anything.
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setBlocked(false);
      setSystemRinging(false);
      setSelfTestQuiet(false);
      setEnded(false);
      setConfirmed(false);
      setSnoozed(false);
      return;
    }

    // Still resolving where the downloaded voice lives — the effect re-runs once known.
    if (audioUrl === null) return;

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.loop = false;
    audio.volume = 1;
    audio.muted = false;
    setIsMuted(false);
    setBlocked(false);
    setSystemRinging(false);
    setEnded(false);

    const handleEnded = () => {
      setIsPlaying(false);
      setEnded(true);
    };
    audio.addEventListener('ended', handleEnded);

    let retryTimer: number | undefined;

    const stopFirstTouchRetry = () => {
      window.removeEventListener('pointerdown', startOnFirstTouch, true);
      window.removeEventListener('keydown', startOnFirstTouch, true);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    // Fired only by the retry path below (a first touch, or the fallback control).
    const startOnFirstTouch = () => {
      stopFirstTouchRetry();
      start();
    };

    const start = () => {
      audio
        .play()
        .then(() => {
          setIsPlaying(true);
          setBlocked(false);
        })
        .catch((err: unknown) => {
          // The WebView refused to start on its own. Arm a retry on the first touch, so
          // the adhan begins the moment the screen is touched instead of waiting for a
          // button hunt — and keep that button visible as the very last resort. The
          // retry is time-boxed (see BLOCKED_RETRY_MAX_MS) so it cannot detonate on a
          // touch that comes hours later.
          console.warn('Audio auto-play failed (user interaction required):', err);
          setIsPlaying(false);
          setBlocked(true);
          window.addEventListener('pointerdown', startOnFirstTouch, true);
          window.addEventListener('keydown', startOnFirstTouch, true);
          retryTimer = window.setTimeout(stopFirstTouchRetry, BLOCKED_RETRY_MAX_MS);
        });
    };

    /*
     * The prayer/iqamah notification is posted at the instant itself and rings from its own
     * channel, so a page arriving together with it stays quiet — two copies of the
     * call would overlap. Every other opening (preview, the in-app timer, a tap on
     * the notification long after the prayer) arrives to silence: this page is the
     * speaker then.
     */
    const systemRingingNow =
      fromNotification &&
      !isPreview &&
      prayerTime != null &&
      trustedNow().getTime() - prayerTime.getTime() < SYSTEM_RING_WINDOW_MS;

    /*
     * The self-test's own case, kept apart from the one above on purpose.
     *
     * A «اختبار الأذان» alarm opens the page as a *preview* while posting through the
     * prayer channel — the channel is what the test is about. So the page must not play
     * its own copy (a test that passes because the page sang would say nothing about the
     * channel), but it must keep the replay button visible: that is how a reader tells a
     * dead channel from a dead page. It is quiet whatever the channel did, which is why
     * it is keyed on the test itself and not on what came back from the receiver.
     */
    const selfTestQuiet = isTest;

    if (systemRingingNow) {
      setSystemRinging(true);
      setSelfTestQuiet(false);
    } else if (selfTestQuiet) {
      setSystemRinging(false);
      setSelfTestQuiet(true);
    } else if (soundEnabled || isPreview) {
      start();
    }

    return () => {
      audio.removeEventListener('ended', handleEnded);
      stopFirstTouchRetry();
      audio.pause();
      audioRef.current = null;
    };
  }, [isOpen, audioUrl, soundEnabled, isPreview, isTest, fromNotification, prayerTime]);

  /*
   * The takeover wakes the screen at prayer time, but Android's screen timeout would
   * put it back to sleep while the adhan is still in the air. Hold it for as long as
   * the page is open — released on close, and capped so a page left open by itself
   * cannot keep the display lit all night.
   */
  useEffect(() => {
    if (!isOpen) return;
    void setAdhanKeepScreenOn(true);
    const cap = window.setTimeout(() => {
      void setAdhanKeepScreenOn(false);
    }, KEEP_SCREEN_ON_MAX_MS);
    return () => {
      window.clearTimeout(cap);
      void setAdhanKeepScreenOn(false);
    };
  }, [isOpen]);

  /**
   * Play (or replay) this page's own copy of the call.
   *
   * Always offered, not only when auto-play was refused. The page is the one place a
   * reader can hear the adhan again after a phone came out of Doze with the volume
   * down, a channel the system had muted, or a takeover that arrived while the ringer
   * was on silent — the states this whole reliability work is about. Before, the button
   * existed only when the WebView refused to start, so a person who had heard nothing
   * had nothing to press.
   */
  const replayAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Already speaking: restart rather than stacking a second position on top of it.
    if (!audio.paused) {
      audio.currentTime = 0;
      audio.volume = isMuted ? 0 : 1;
      audio.muted = isMuted;
      return;
    }
    audio.currentTime = 0;
    audio.volume = isMuted ? 0 : 1;
    audio.muted = isMuted;
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        setBlocked(false);
        setEnded(false);
      })
      .catch(() => setBlocked(true));
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      const nextMuted = !isMuted;
      audio.muted = nextMuted;
      audio.volume = nextMuted ? 0 : 1;
      setIsMuted(nextMuted);
      return;
    }
    // No local audio element (e.g. sound is coming from the system notification/channel).
    // We can't mute the OS notification from here, so just toggle the UI state to avoid confusion.
    setIsMuted((v) => !v);
  }, [isMuted]);

  /** One line telling the person what the sound is doing — never «اضغط للتشغيل». */
  const soundStatus = systemRinging
    ? 'الأذان يُشغَّل تلقائيًا مع التنبيه'
    : selfTestQuiet
      ? 'اختبار: انتظر صوت التنبيه — إن لم يرن فالمشكلة في قناة الهاتف'
      : blocked
        ? 'تعذّر التشغيل التلقائي — اضغط زر التشغيل'
        : isPlaying
          ? 'جارٍ تشغيل الأذان الآن…'
          : ended
            ? 'انتهى الأذان — يمكنك تشغيله من جديد'
            : 'يبدأ صوت الأذان تلقائيًا…';

  const handleConfirmPrayer = useCallback(async () => {
    // A preview is a look at the page, never an answer: it must not write a record for
    // a prayer whose time has not come (or any prayer at all).
    if (isPreview) return;
    try {
      // The record belongs to the prayer's own day in the *city's* timezone. The device
      // clock can sit on either side of midnight while the overlay is open — a prayer
      // near midnight, a late notification tap, a device far from the selected zone —
      // and `todayKey()` (the device's day) would stamp the wrong date onto it.
      const prayerDate = formatDateKey(getDateInTimeZone(prayerTime ?? trustedNow(), timeZone));
      await confirmPrayer(prayerDate, prayerKey, 'ontime');
      if (mountedRef.current) setConfirmed(true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const closeTimer = window.setTimeout(() => {
        if (mountedRef.current) onClose();
      }, 1400);
      pendingTimeouts.current.push(closeTimer);
    } catch (err) {
      console.error('Failed to confirm prayer:', err);
      if (mountedRef.current) onClose();
    }
  }, [isPreview, prayerKey, prayerTime, timeZone, onClose]);

  const handleSnooze = useCallback(async () => {
    setSnoozed(true);
    if (audioRef.current) {
      audioRef.current.pause();
    }
    // Schedule a reminder in 10 minutes
    if (Capacitor.isNativePlatform()) {
      try {
        const snoozeTime = new Date(Date.now() + 10 * 60000);
        await LocalNotifications.schedule({
          notifications: [
            {
              // Reserved snooze range: recognisable, so the resume rebuild preserves it
              // instead of cancelling it with everything else. A random id was both
              // unknowable (every rebuild deleted the reminder) and free to collide
              // with a prayer alert's id.
              id: notificationId.snooze(),
              title: `تذكير صلاة ${displayName}`,
              body: `انقضت 10 دقائق على وقت صلاة ${displayName} — لا تنسَ الصلاة`,
              schedule: { at: snoozeTime },
              channelId: 'prayer-reminder',
              ...NOTIFICATION_BRAND,
            },
          ],
        });
      } catch (err) {
        console.error('Failed to schedule snooze notification:', err);
      }
    } else {
      // Web has no alarm queue, so the button used to claim «تم التذكير» while
      // scheduling nothing. Now it arms the two real reminders a browser can give:
      // a notification (permission is requested on this very click, which counts as
      // the user gesture) and — the sturdier one — the adhan page itself reopening
      // through the same event the test buttons use, which replays the call while
      // the tab lives. If the tab is closed, no web reminder can survive; that
      // limit is stated on the button instead of being papered over.
      try {
        if (typeof Notification !== 'undefined') {
          if (Notification.permission === 'default') {
            void Notification.requestPermission();
          }
          window.setTimeout(() => {
            try {
              if (Notification.permission === 'granted') {
                new Notification(`تذكير صلاة ${displayName}`, {
                  body: `انقضت 10 دقائق على وقت صلاة ${displayName} — لا تنسَ الصلاة`,
                  icon: '/icons/icon-192.png',
                });
              }
            } catch {
              // Some browsers refuse construction; the overlay below is the main reminder.
            }
          }, 10 * 60000);
        }
      } catch {
        // Notifications unavailable: the overlay reopening is still armed below.
      }
      const triggerTimer = window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('zad:trigger-azan', {
            detail: { prayerKey, prayerName, prayerTime, isPreview: true },
          }),
        );
      }, 10 * 60000);
      pendingTimeouts.current.push(triggerTimer);
    }
    const closeTimer = window.setTimeout(() => {
      if (mountedRef.current) onClose();
    }, 1200);
    pendingTimeouts.current.push(closeTimer);
  }, [displayName, onClose, prayerKey, prayerName, prayerTime]);

  const handleGoToAdhkar = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    onClose();
    if (onNavigateToAdhkar) {
      onNavigateToAdhkar();
    }
  };

  if (!isOpen) return null;

  // The adhan page belongs to the selected city, so the date it shows is the city's —
  // on a device far from the selected zone these two days can differ.
  const today = getDateInTimeZone(prayerTime ?? trustedNow(), timeZone);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto p-3 sm:p-6 transition-all duration-300"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      data-color-palette={colorPalette}
      data-theme-mode={themeMode}
      style={{
        background: `radial-gradient(ellipse at 50% 0%, ${primary}55 0%, ${primary}1f 42%, #04110c 100%)`,
      }}
    >
      {/* Background Decorative Ambient Glows */}
      <div
        className="pointer-events-none absolute -top-40 right-1/2 h-[420px] w-[420px] -translate-x-1/2 rounded-full blur-[140px]"
        style={{ backgroundColor: `${primary}26` }}
      />
      <div
        className="pointer-events-none absolute -bottom-40 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full blur-[140px]"
        style={{ backgroundColor: `${accent}1f` }}
      />

      {/* Main Container Card */}
      <div
        className="relative my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-[1.75rem] border p-4 text-white shadow-[0_32px_100px_-28px_rgba(0,0,0,0.85)] ring-1 ring-white/10 sm:max-h-[calc(100dvh-3rem)] sm:rounded-[2rem] sm:p-6"
        style={{
          borderColor: `${accent}66`,
          background: `linear-gradient(155deg, ${primary}3d 0%, rgba(7, 24, 17, 0.98) 38%, rgba(3, 12, 8, 0.99) 100%)`,
        }}
      >
        <div
          className="flex items-center justify-between gap-3 border-b pb-3.5"
          style={{ borderColor: `${accent}35` }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: accent }} />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent }} />
            </span>
            <span className="truncate text-xs font-bold tracking-wide text-amber-100 sm:text-sm">
              {isTest
                ? 'اختبار الأذان — تحقّق من وصول الصوت'
                : isPreview
                  ? 'معاينة صفة الأذان'
                  : 'حَانَ الآنْ مَوْعِدُ الأَذَانْ'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/75 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="py-5 text-center sm:py-6">
          <div
            className="relative mx-auto flex h-24 w-24 items-center justify-center rounded-full p-[3px] shadow-lg sm:h-28 sm:w-28"
            style={{
              backgroundImage: `linear-gradient(135deg, ${accent} 0%, #f3d993 45%, ${primary} 100%)`,
              boxShadow: `0 18px 55px -22px ${accent}aa`,
            }}
          >
            {isPlaying && (
              <>
                <div className="absolute inset-0 animate-ping rounded-full duration-1000" style={{ backgroundColor: `${primary}40` }} />
                <div className="absolute -inset-2 animate-pulse rounded-full border" style={{ borderColor: `${accent}55` }} />
              </>
            )}
            <div className="flex h-full w-full items-center justify-center rounded-full bg-[#07180f]">
              <BellRing size={38} strokeWidth={1.6} className={isPlaying ? 'animate-pulse' : ''} style={{ color: '#f1d78f' }} />
            </div>
          </div>

          <p className="mt-4 text-xs font-bold tracking-[0.18em] text-amber-200/80">حان وقت الصلاة</p>
          <h2 className="mt-1 text-3xl font-extrabold tracking-wide text-white sm:text-4xl">
            صلاة {displayName}
          </h2>
          <div className="mx-auto mt-4 flex w-fit items-center gap-3 rounded-2xl border px-5 py-2.5 shadow-inner" style={{ borderColor: `${accent}55`, backgroundColor: `${accent}18` }}>
            <Clock size={19} className="shrink-0" style={{ color: '#f1d78f' }} />
            <span className="text-3xl font-extrabold tabular-nums text-amber-100 sm:text-4xl">{displayTime}</span>
          </div>
          {iqamahTime && (
            <p className="mt-2 text-sm font-semibold text-white/75">
              الإقامة <span className="font-bold text-amber-100">{iqamahTime}</span>
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[0.7rem] text-white/70 sm:text-xs">
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={14} className="shrink-0 text-amber-200" />
              {settings.cityName || 'الموقع الحالي'}
            </span>
            <span aria-hidden="true" className="text-amber-200/60">•</span>
            <span>{formatArabicDate(today)}</span>
            <span aria-hidden="true" className="text-amber-200/60">•</span>
            <span>{getHijriDate(today, settings.hijriAdjustment)}</span>
          </div>
        </div>

        {/* Adhan/Iqamah sound — starts by itself with the page, no button to hunt for */}
        {soundEnabled && (
          <div
            className="mb-4 rounded-2xl border p-3.5 shadow-sm sm:mb-5"
            style={{
              borderColor: `${primary}66`,
              background: `linear-gradient(120deg, ${primary}25, rgba(255,255,255,0.035))`,
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 overflow-hidden">
                {/*
                  Always rendered: the reader who heard nothing (Doze held the channel,
                  the ringer was on silent, the phone was in ДND) needs a way to hear the
                  call without hunting. It doubles as the safety net when the WebView
                  refused to auto-start.
                */}
                {!systemRinging && (
                  <button
                    type="button"
                    onClick={replayAudio}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl font-bold text-[#102217] shadow-md transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${accent} 0%, ${primary} 100%)`,
                      color: '#102217',
                    }}
                    aria-label="تشغيل الأذان"
                  >
                    <Play size={22} className="mr-0.5" />
                  </button>
                )}
                <div className="truncate text-right">
                  <p className="truncate text-sm font-bold text-white">{adhanSound.name}</p>
                  <p className="mt-0.5 text-xs text-amber-100/75">{soundStatus}</p>
                </div>
              </div>

              {/* Soundwaves effect when playing */}
              {isPlaying && (
                <div className="flex items-end gap-1 h-6 px-2">
                  <span className="w-1 rounded-full animate-[bounce_1s_infinite_100ms] h-4" style={{ backgroundColor: accent }} />
                  <span className="w-1 rounded-full animate-[bounce_1s_infinite_300ms] h-6" style={{ backgroundColor: primary }} />
                  <span className="w-1 rounded-full animate-[bounce_1s_infinite_200ms] h-3" style={{ backgroundColor: accent }} />
                  <span className="w-1 rounded-full animate-[bounce_1s_infinite_400ms] h-5" style={{ backgroundColor: primary }} />
                </div>
              )}

              {/*
                The mute switch controls this page's own audio, so it is offered only
                while the page is the speaker — the notification's ringing belongs to
                Android and is stopped by dismissing the alert.
              */}
              {!systemRinging && !isTest && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-white/65 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                  aria-label={isMuted ? 'إلغاء الكتم' : 'كتم الصوت'}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Supplication After Azan Card — only for adhan, not iqamah */}
        {(
          <div
            className="mb-4 rounded-2xl border p-4 sm:mb-5"
            style={{
              borderColor: `${accent}55`,
              background: `linear-gradient(145deg, ${accent}1b, rgba(255,255,255,0.035))`,
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-bold text-amber-100">
                <BookOpen size={16} className="shrink-0 text-amber-200" />
                {AFTER_AZAN_DUAA.title}
              </h3>
              <button
                type="button"
                onClick={() => setShowDuaa(!showDuaa)}
                className="min-h-10 shrink-0 rounded-lg px-2.5 text-xs font-semibold text-white/65 underline-offset-4 transition hover:bg-white/5 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
              >
                {showDuaa ? 'إخفاء' : 'عرض'}
              </button>
            </div>

            {showDuaa && (
              <div className="space-y-2.5 text-right">
                <p className="font-serif text-[0.95rem] font-semibold leading-[2] text-white/90 sm:text-base">
                  «{AFTER_AZAN_DUAA.text}»
                </p>
                <p className="text-xs italic text-amber-100/75">
                  {AFTER_AZAN_DUAA.benefit}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-2.5">
          {isPreview ? (
            /*
             * A preview never records and never schedules. The confirm button would
             * stamp «في الموعد» onto a prayer whose time has not come (records are
             * final), and snooze would arm a real reminder minutes from a test — so
             * the only action on a previewed page is leaving it.
             */
            <button
              type="button"
              onClick={onClose}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
            >
              <X size={18} />
              إنهاء المعاينة
            </button>
          ) : (
            <>
          {/* Confirm Prayer Done Button */}
          <button
            type="button"
            onClick={handleConfirmPrayer}
            disabled={confirmed}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-extrabold text-white shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07180f] disabled:cursor-default"
            style={
              confirmed
                ? { backgroundColor: primary }
                : {
                    backgroundImage: `linear-gradient(90deg, ${primary} 0%, ${accent} 100%)`,
                    boxShadow: `0 20px 40px -20px ${primary}66`,
                  }
            }
          >
            <CheckCircle2 size={18} />
            {confirmed ? 'تم تسجيل أدائك للصلاة بنجاح!' : `تمت صلاة ${displayName} (تسجيل بالجدول)`}
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Remind in 10 minutes (Snooze) */}
            <button
              type="button"
              onClick={handleSnooze}
              disabled={snoozed}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-center text-xs font-semibold leading-snug text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-default disabled:opacity-70 sm:px-3 sm:text-sm"
              style={{
                borderColor: `${primary}66`,
                backgroundColor: `${primary}24`,
              }}
            >
              <Bell size={16} className="shrink-0 text-amber-200" />
              {snoozed
                ? Capacitor.isNativePlatform()
                  ? 'تم التذكير بعد 10د'
                  : 'سيصل التذكير ما دام التطبيق مفتوحًا'
                : 'تذكير بعد 10 دقائق'}
            </button>

            {/* Go to Adhkar Screen */}
            <button
              type="button"
              onClick={handleGoToAdhkar}
              className="flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2.5 text-xs font-semibold text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 sm:px-3 sm:text-sm"
              style={{
                borderColor: `${primary}66`,
                backgroundColor: `${primary}24`,
              }}
            >
              <BookOpen size={16} className="shrink-0 text-amber-200" />
              أذكار الصلاة
            </button>
          </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}
