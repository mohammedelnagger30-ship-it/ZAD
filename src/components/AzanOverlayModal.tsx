import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Volume2, VolumeX, CheckCircle2, Bell, BookOpen, X, Sparkles, Clock, MapPin } from 'lucide-react';
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

export interface AzanOverlayProps {
  isOpen: boolean;
  prayerKey: PrayerKey;
  prayerName?: string;
  prayerTime?: Date;
  settings: Settings;
  isPreview?: boolean;
  /**
   * Opened by the native adhan notification. The notification posts at the prayer
   * instant itself and rings from its own channel, so the page must not start a second
   * copy of the adhan on top of it (see `SYSTEM_RING_WINDOW_MS`).
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

export function AzanOverlayModal({
  isOpen,
  prayerKey,
  prayerName,
  prayerTime,
  settings,
  isPreview = false,
  fromNotification = false,
  onClose,
  onNavigateToAdhkar,
}: AzanOverlayProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  /** The WebView refused to start the adhan without a gesture — fallback control. */
  const [blocked, setBlocked] = useState(false);
  /** The prayer notification is ringing right now; the page's own audio stays out. */
  const [systemRinging, setSystemRinging] = useState(false);
  const [ended, setEnded] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [showDuaa, setShowDuaa] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Back on Android dismisses the adhan page. Before this, back during the
  // adhan exited the app entirely — silencing the call mid-flight.
  useOverlayDismiss(isOpen, onClose);

  const displayName = prayerName || PRAYER_LABELS_AR[prayerKey] || 'الصلاة';
  const adhanSound = getAdhanSound(settings.adhanVoiceId);
  /**
   * Where the recording lives. A bundled voice is in the package, so its URL is known
   * at once; a downloaded one is answered by the store, and the play effect below waits
   * for it rather than starting a player against a path that isn't there yet.
   */
  const [audioUrl, setAudioUrl] = useState<string | null>(() =>
    adhanSound.bundled ? `/audio/${adhanSound.file}` : null,
  );

  useEffect(() => {
    if (adhanSound.bundled) {
      setAudioUrl(`/audio/${adhanSound.file}`);
      return;
    }
    let alive = true;
    void resolveAdhanPlayUrl(adhanSound).then((url) => {
      if (alive) setAudioUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [adhanSound]);

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
    setBlocked(false);
    setSystemRinging(false);
    setEnded(false);

    const handleEnded = () => {
      setIsPlaying(false);
      setEnded(true);
    };
    audio.addEventListener('ended', handleEnded);

    // Fired only by the retry path below (a first touch, or the fallback control).
    const startOnFirstTouch = () => {
      window.removeEventListener('pointerdown', startOnFirstTouch, true);
      window.removeEventListener('keydown', startOnFirstTouch, true);
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
          // button hunt — and keep that button visible as the very last resort.
          console.warn('Audio auto-play failed (user interaction required):', err);
          setIsPlaying(false);
          setBlocked(true);
          window.addEventListener('pointerdown', startOnFirstTouch, true);
          window.addEventListener('keydown', startOnFirstTouch, true);
        });
    };

    /*
     * The prayer notification is posted at the instant itself and rings from its own
     * channel, so a page arriving together with it stays quiet — two copies of the
     * adhan would overlap. Every other opening (preview, the in-app timer, a tap on
     * the notification long after the prayer) arrives to silence: this page is the
     * speaker then.
     */
    const systemRingingNow =
      fromNotification &&
      !isPreview &&
      prayerTime != null &&
      trustedNow().getTime() - prayerTime.getTime() < SYSTEM_RING_WINDOW_MS;

    if (systemRingingNow) {
      setSystemRinging(true);
    } else if (settings.adhanSound || isPreview) {
      start();
    }

    return () => {
      audio.removeEventListener('ended', handleEnded);
      window.removeEventListener('pointerdown', startOnFirstTouch, true);
      window.removeEventListener('keydown', startOnFirstTouch, true);
      audio.pause();
      audioRef.current = null;
    };
  }, [isOpen, audioUrl, settings.adhanSound, isPreview, fromNotification, prayerTime]);

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

  /** Fallback control, rendered only when auto-start was refused. */
  const startAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio
      .play()
      .then(() => {
        setIsPlaying(true);
        setBlocked(false);
      })
      .catch(() => setBlocked(true));
  }, []);

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  /** One line telling the person what the sound is doing — never «اضغط للتشغيل». */
  const soundStatus = systemRinging
    ? 'الأذان يُشغَّل تلقائيًا مع التنبيه'
    : blocked
      ? 'تعذّر التشغيل التلقائي — اضغط للتشغيل'
      : isPlaying
        ? 'جارٍ تشغيل الأذان الآن…'
        : ended
          ? 'انتهى الأذان'
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
      setConfirmed(true);
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err) {
      console.error('Failed to confirm prayer:', err);
      onClose();
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
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('zad:trigger-azan', {
            detail: { prayerKey, prayerName, prayerTime, isPreview: true },
          }),
        );
      }, 10 * 60000);
    }
    setTimeout(() => {
      onClose();
    }, 1200);
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
      className="fixed inset-0 z-[9999] flex items-start md:items-center justify-center overflow-y-auto bg-slate-950/90 backdrop-blur-md p-4 py-6 min-h-full transition-all duration-300"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      {/* Background Decorative Ambient Glows */}
      <div className="pointer-events-none absolute top-1/4 right-1/2 h-96 w-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-600/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-500/15 blur-3xl" />

      {/* Main Container Card */}
      <div className="relative w-full max-w-lg md:max-w-xl overflow-hidden rounded-3xl border border-emerald-500/30 bg-linear-to-b from-slate-900 via-emerald-950/90 to-slate-900 p-6 text-white shadow-2xl ring-1 ring-white/10 my-auto">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-emerald-500/20">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-semibold text-emerald-400 tracking-wide">
              {isPreview ? 'معاينة صفحة الأذان' : 'حَانَ الآنْ مَوْعِدُ الأَذَانْ'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full min-h-11 min-w-11 p-2.5 text-slate-400 hover:bg-white/10 hover:text-white transition"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Center Visual Circle & Sound Wave */}
        <div className="my-6 text-center">
          <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-linear-to-tr from-emerald-700 to-amber-500 p-1 shadow-lg shadow-emerald-900/50">
            {isPlaying && (
              <>
                <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30 duration-1000" />
                <div className="absolute -inset-2 animate-pulse rounded-full border border-amber-400/40" />
              </>
            )}
            <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-950/80 backdrop-blur-xs">
              <Sparkles size={44} className="text-amber-300 animate-pulse" />
            </div>
          </div>

          {/* Prayer Title & Time */}
          <h2 className="mt-4 text-3xl font-extrabold text-white tracking-wide">
            صلاة {displayName}
          </h2>
          <p className="mt-1 text-2xl font-bold text-amber-300 flex items-center justify-center gap-2">
            <Clock size={20} className="text-amber-400" />
            {displayTime}
          </p>
          {iqamahTime && (
            <p className="mt-1.5 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-300">
              <Clock size={15} className="text-emerald-400" />
              الإقامة {iqamahTime}
            </p>
          )}

          {/* Location & Date */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-300">
            <span className="flex items-center gap-1">
              <MapPin size={14} className="text-emerald-400" />
              {settings.cityName || 'الموقع الحالي'}
            </span>
            <span>•</span>
            <span>{formatArabicDate(today)}</span>
            <span>•</span>
            <span>{getHijriDate(today, settings.hijriAdjustment)}</span>
          </div>
        </div>

        {/* Adhan sound — starts by itself with the page, no button to hunt for */}
        {settings.adhanSound && (
          <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-3.5 backdrop-blur-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 overflow-hidden">
                {/*
                  Rendered only when the WebView refused to auto-start the adhan: a
                  safety net, not the normal way to hear it.
                */}
                {blocked && (
                  <button
                    type="button"
                    onClick={startAudio}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition"
                    aria-label="تشغيل الأذان"
                  >
                    <Play size={22} className="mr-0.5" />
                  </button>
                )}
                <div className="truncate text-right">
                  <p className="text-xs font-semibold text-white truncate">{adhanSound.name}</p>
                  <p className="text-[11px] text-emerald-400">{soundStatus}</p>
                </div>
              </div>

              {/* Soundwaves effect when playing */}
              {isPlaying && (
                <div className="flex items-end gap-1 h-6 px-2">
                  <span className="w-1 bg-amber-400 rounded-full animate-[bounce_1s_infinite_100ms] h-4" />
                  <span className="w-1 bg-emerald-400 rounded-full animate-[bounce_1s_infinite_300ms] h-6" />
                  <span className="w-1 bg-amber-300 rounded-full animate-[bounce_1s_infinite_200ms] h-3" />
                  <span className="w-1 bg-emerald-500 rounded-full animate-[bounce_1s_infinite_400ms] h-5" />
                </div>
              )}

              {/*
                The mute switch controls this page's own audio, so it is offered only
                while the page is the speaker — the notification's ringing belongs to
                Android and is stopped by dismissing the alert.
              */}
              {!systemRinging && (
                <button
                  type="button"
                  onClick={toggleMute}
                  className="rounded-lg min-h-11 min-w-11 p-2.5 text-slate-400 hover:text-white transition"
                  aria-label={isMuted ? 'إلغاء الكتم' : 'كتم الصوت'}
                >
                  {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Supplication After Azan Card */}
        <div className="mb-6 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Sparkles size={14} />
              {AFTER_AZAN_DUAA.title}
            </h3>
            <button
              type="button"
              onClick={() => setShowDuaa(!showDuaa)}
              className="px-2 py-1 text-xs text-slate-400 underline hover:text-slate-200"
            >
              {showDuaa ? 'إخفاء' : 'عرض'}
            </button>
          </div>

          {showDuaa && (
            <div className="space-y-2 text-right">
              <p className="text-sm font-semibold text-emerald-100 leading-relaxed font-serif">
                "{AFTER_AZAN_DUAA.text}"
              </p>
              <p className="text-[11px] text-amber-200/80 italic">
                {AFTER_AZAN_DUAA.benefit}
              </p>
            </div>
          )}
        </div>

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
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 py-3 px-4 font-bold text-sm text-slate-200 transition hover:bg-slate-800"
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
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 px-4 font-bold text-sm transition-all shadow-lg ${
              confirmed
                ? 'bg-emerald-600 text-white'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white shadow-emerald-900/40'
            }`}
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
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 py-2.5 md:py-3 px-3 text-xs md:text-sm font-semibold text-slate-200 transition"
            >
              <Bell size={15} className="text-amber-400" />
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
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 py-2.5 md:py-3 px-3 text-xs md:text-sm font-semibold text-slate-200 transition"
            >
              <BookOpen size={15} className="text-emerald-400" />
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
