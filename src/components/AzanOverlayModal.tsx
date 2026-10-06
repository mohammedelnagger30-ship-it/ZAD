import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, CheckCircle2, Bell, BookOpen, X, Sparkles, Clock, MapPin } from 'lucide-react';
import type { Settings } from '@/db/database';
import { getAdhanSound } from '@/data/adhanSounds';
import { formatTime12h, getPrayerTimeZone } from '@/utils/prayerTimes';
import { confirmPrayer, PRAYER_LABELS_AR, type PrayerKey } from '@/utils/prayerTracker';
import { todayKey, formatArabicDate, getHijriDate } from '@/utils/dateUtils';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

export interface AzanOverlayProps {
  isOpen: boolean;
  prayerKey: PrayerKey;
  prayerName?: string;
  prayerTime?: Date;
  settings: Settings;
  isPreview?: boolean;
  onClose: () => void;
  onNavigateToAdhkar?: () => void;
}

const AFTER_AZAN_DUAA = {
  title: 'دعاء ما بعد الأذان',
  text: 'اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ، وَالصَّلاةِ الْقَائِمَةِ، آتِ مُحَمَّدًا الْوَسِيلَةَ وَالْفَضِيلَةَ، وَابْعَثْهُ مَقَامًا مَحْمُودًا الَّذِي وَعَدْتَهُ.',
  benefit: 'حلّت له شفاعتي يوم القيامة (رواة البخاري)',
};

export function AzanOverlayModal({
  isOpen,
  prayerKey,
  prayerName,
  prayerTime,
  settings,
  isPreview = false,
  onClose,
  onNavigateToAdhkar,
}: AzanOverlayProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const [showDuaa, setShowDuaa] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const displayName = prayerName || PRAYER_LABELS_AR[prayerKey] || 'الصلاة';
  const adhanSound = getAdhanSound(settings.adhanVoiceId);
  const audioUrl = `/audio/${adhanSound.file}`;

  const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const displayTime = prayerTime
    ? formatTime12h(prayerTime, timeZone)
    : formatTime12h(new Date(), timeZone);

  // Initialize and play audio
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlaying(false);
      setConfirmed(false);
      setSnoozed(false);
      return;
    }

    const audio = new Audio(audioUrl);
    audioRef.current = audio;
    audio.loop = false;

    const handleEnded = () => setIsPlaying(false);
    audio.addEventListener('ended', handleEnded);

    // Auto-play audio if enabled in settings (or preview)
    if (settings.adhanSound || isPreview) {
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((err) => {
        console.warn('Audio auto-play failed (user interaction required):', err);
        setIsPlaying(false);
      });
    }

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audioRef.current = null;
    };
  }, [isOpen, audioUrl, settings.adhanSound, isPreview]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleConfirmPrayer = useCallback(async () => {
    try {
      await confirmPrayer(todayKey(), prayerKey, 'ontime');
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
  }, [prayerKey, onClose]);

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
              id: Math.floor(Math.random() * 1000000),
              title: `تذكير صلاة ${displayName}`,
              body: `انقضت 10 دقائق على وقت صلاة ${displayName} — لا تنسَ الصلاة`,
              schedule: { at: snoozeTime },
              channelId: 'prayer-reminder',
              smallIcon: 'ic_notification',
              iconColor: '#1f734e',
            },
          ],
        });
      } catch (err) {
        console.error('Failed to schedule snooze notification:', err);
      }
    }
    setTimeout(() => {
      onClose();
    }, 1200);
  }, [displayName, onClose]);

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

  const today = new Date();

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/90 backdrop-blur-md p-4 transition-all duration-300"
      dir="rtl"
      role="dialog"
      aria-modal="true"
    >
      {/* Background Decorative Ambient Glows */}
      <div className="pointer-events-none absolute top-1/4 right-1/2 h-96 w-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-600/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-500/15 blur-3xl" />

      {/* Main Container Card */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-slate-900 via-emerald-950/90 to-slate-900 p-6 text-white shadow-2xl ring-1 ring-white/10 my-auto">
        
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
            className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Center Visual Circle & Sound Wave */}
        <div className="my-6 text-center">
          <div className="relative mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-gradient-to-tr from-emerald-700 to-amber-500 p-1 shadow-lg shadow-emerald-900/50">
            {isPlaying && (
              <>
                <div className="absolute inset-0 animate-ping rounded-full bg-emerald-500/30 duration-1000" />
                <div className="absolute -inset-2 animate-pulse rounded-full border border-amber-400/40" />
              </>
            )}
            <div className="flex h-full w-full items-center justify-center rounded-full bg-slate-950/80 backdrop-blur-sm">
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

          {/* Location & Date */}
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-slate-300">
            <span className="flex items-center gap-1">
              <MapPin size={14} className="text-emerald-400" />
              {settings.cityName || 'الموقع الحالي'}
            </span>
            <span>•</span>
            <span>{formatArabicDate(today)}</span>
            <span>•</span>
            <span>{getHijriDate(today)}</span>
          </div>
        </div>

        {/* Audio Player Controls */}
        {settings.adhanSound && (
          <div className="mb-6 rounded-2xl border border-emerald-500/20 bg-slate-900/60 p-3.5 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 overflow-hidden">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition"
                  aria-label={isPlaying ? 'إيقاف الأذان' : 'تشغيل الأذان'}
                >
                  {isPlaying ? <Pause size={22} /> : <Play size={22} className="mr-0.5" />}
                </button>
                <div className="truncate text-right">
                  <p className="text-xs font-semibold text-white truncate">{adhanSound.name}</p>
                  <p className="text-[11px] text-emerald-400">
                    {isPlaying ? 'جارٍ تشغيل الأذان الآن…' : 'موقوف مؤقتاً'}
                  </p>
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

              <button
                type="button"
                onClick={toggleMute}
                className="rounded-lg p-2 text-slate-400 hover:text-white transition"
                aria-label={isMuted ? 'إلغاء الكتم' : 'كتم الصوت'}
              >
                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
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
              className="text-[11px] text-slate-400 underline hover:text-slate-200"
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
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 py-2.5 px-3 text-xs font-semibold text-slate-200 transition"
            >
              <Bell size={15} className="text-amber-400" />
              {snoozed ? 'تم التذكير بعد 10د' : 'تذكير بعد 10 دقائق'}
            </button>

            {/* Go to Adhkar Screen */}
            <button
              type="button"
              onClick={handleGoToAdhkar}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-800 py-2.5 px-3 text-xs font-semibold text-slate-200 transition"
            >
              <BookOpen size={15} className="text-emerald-400" />
              أذكار الصلاة
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
