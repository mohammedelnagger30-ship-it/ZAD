import { useState, useCallback, useRef, useEffect } from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  Clock,
  ExternalLink,
  Info,
  Play,
  Smartphone,
  Square,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { Badge, Card, ToggleRow } from '@/components/ui';
import {
  IQAMAH_SOUNDS,
  iqamahPlayUrl,
  iqamahSoundAttribution,
  type IqamahSound,
} from '@/data/iqamahSound';
import { DEFAULT_IQAMAH_OFFSETS, type IqamahPrayerKey } from '@/utils/prayerTimes';
import { PRAYER_LABELS_AR } from '@/utils/prayerTracker';
import type { Settings } from '@/db/database';

export interface IqamahScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

/** Short human descriptions of what each recording actually contains. */
const SOUND_DESCRIPTIONS: Record<string, string> = {
  kamil_iqamah: 'الإقامة كاملة: التكبيرات، الشهادتان، حي على الصلاة، قد قامت الصلاة — ٣٤ ثانية',
  masjid_iqamah: 'مقطع من أذان إقامة رمضان في المسجد — ٢٠ ثانية',
  soft_tone: 'نغمة قصيرة لمن يفضل تنبيهًا هادئًا',
};

/** Default iqamah offsets for the times overview (minutes after each adhan). */
const OFFSET_PRAYERS: IqamahPrayerKey[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

function offsetMinutes(settings: Settings, key: IqamahPrayerKey): number {
  const raw = settings.iqamahOffsets?.[key];
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.min(Math.max(Math.trunc(raw), 0), 120)
    : DEFAULT_IQAMAH_OFFSETS[key];
}

export function IqamahScreen({ settings, onSaveSettings, onClose }: IqamahScreenProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [durations, setDurations] = useState<Record<string, string>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /** Measure each bundled file's duration so the list can show it truthfully. */
  useEffect(() => {
    let alive = true;
    for (const sound of IQAMAH_SOUNDS) {
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = iqamahPlayUrl(sound.id);
      probe.addEventListener('loadedmetadata', () => {
        if (!alive || !Number.isFinite(probe.duration) || probe.duration <= 0) return;
        const s = Math.round(probe.duration);
        const label =
          s < 60
            ? `${s} ثانية`
            : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} دقيقة`;
        setDurations((prev) => (prev[sound.id] ? prev : { ...prev, [sound.id]: label }));
      });
    }
    return () => {
      alive = false;
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const stopPreview = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }, []);

  const playPreview = useCallback(
    (soundId: string) => {
      if (playingId === soundId && audioRef.current && !audioRef.current.paused) {
        stopPreview();
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(iqamahPlayUrl(soundId));
      audioRef.current = audio;
      audio.addEventListener('ended', () => {
        if (audioRef.current === audio) setPlayingId(null);
      });
      audio.play().catch(() => {
        if (audioRef.current === audio) setPlayingId(null);
      });
      setPlayingId(soundId);
    },
    [playingId, stopPreview],
  );

  const selectedId = settings.iqamahSoundId ?? IQAMAH_SOUNDS[0].id;

  const renderSoundCard = (sound: IqamahSound) => {
    const isSelected = sound.id === selectedId;
    const isPlaying = playingId === sound.id;
    return (
      <div
        key={sound.id}
        role="radio"
        aria-checked={isSelected}
        tabIndex={0}
        onClick={() => onSaveSettings({ iqamahSoundId: sound.id })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSaveSettings({ iqamahSoundId: sound.id });
          }
        }}
        className={`group relative w-full cursor-pointer rounded-2xl border p-4 text-right transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
          isSelected
            ? 'border-primary-400 bg-primary-50/80 shadow-md shadow-primary-500/10 ring-1 ring-primary-400/50 dark:border-primary-500 dark:bg-primary-900/30'
            : 'border-primary-100/80 bg-white/80 hover:border-primary-200 hover:shadow-sm dark:border-primary-800/50 dark:bg-primary-900/10 dark:hover:border-primary-700/60'
        }`}
      >
        {/* Selected indicator — corner check */}
        {isSelected && (
          <span className="absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-white shadow-sm">
            <Check size={12} strokeWidth={3} aria-hidden="true" />
          </span>
        )}

        <div className="flex items-start gap-3">
          {/* Play / stop button */}
          <button
            type="button"
            aria-label={isPlaying ? `إيقاف معاينة ${sound.name}` : `معاينة ${sound.name}`}
            onClick={(e) => {
              e.stopPropagation();
              playPreview(sound.id);
            }}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
              isPlaying
                ? 'bg-primary-600 text-white shadow-md shadow-primary-500/30 animate-pulse'
                : isSelected
                  ? 'bg-primary-100 text-primary-700 group-hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-200'
                  : 'bg-gray-100 text-gray-500 group-hover:bg-primary-50 group-hover:text-primary-600 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {isPlaying ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="mr-0.5" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p
                className={`text-sm font-bold ${
                  isSelected
                    ? 'text-primary-900 dark:text-primary-100'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {sound.name}
              </p>
              {sound.id === 'kamil_iqamah' && (
                <Badge variant="gold">الموصى به</Badge>
              )}
            </div>

            <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {SOUND_DESCRIPTIONS[sound.id] ?? sound.name}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {durations[sound.id] && (
                <span className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-gray-400 dark:text-gray-500">
                  <Clock size={11} aria-hidden="true" /> {durations[sound.id]}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[0.6875rem] text-gray-400 dark:text-gray-500">
                <WifiOff size={11} aria-hidden="true" /> مضمّن في التطبيق
              </span>
            </div>

            {/* Attribution — required by the licence, small but present. */}
            <p className="mt-1 text-[0.625rem] leading-relaxed text-gray-400 dark:text-gray-500">
              {iqamahSoundAttribution(sound.id)}
            </p>

            {sound.sourceUrl && (
              <a
                href={sound.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="-mx-2 inline-flex min-h-[40px] items-center gap-1 px-2 text-[0.6875rem] font-medium text-primary-500 underline-offset-2 hover:underline dark:text-primary-400"
              >
                <ExternalLink size={11} aria-hidden="true" /> المصدر الأصلي
              </a>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8" dir="rtl">
      {/* Back */}
      <button
        type="button"
        onClick={onClose}
        className="-mx-2 inline-flex min-h-[40px] items-center gap-1.5 px-2 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100"
      >
        <ArrowRight size={16} aria-hidden="true" />
        رجوع إلى الإعدادات
      </button>

      {/* Hero */}
      <section className="relative isolate overflow-hidden rounded-[2rem] border border-gold-300/70 bg-gradient-to-br from-gold-50 via-white to-primary-50/40 p-6 text-center shadow-md dark:border-gold-700/60 dark:from-primary-950 dark:via-primary-900/80 dark:to-primary-900">
        {/* Decorative glow */}
        <div
          className="pointer-events-none absolute -top-20 left-1/2 h-60 w-60 -translate-x-1/2 rounded-full bg-primary-400/10 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-16 right-0 h-40 w-40 rounded-full bg-gold-400/10 blur-3xl"
          aria-hidden="true"
        />

        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-600 to-primary-900 text-white shadow-lg shadow-primary-600/30">
          <Bell size={28} aria-hidden="true" />
        </div>
        <h1 className="mt-3 text-2xl font-bold text-primary-900 dark:text-primary-50 md:text-3xl">
          صوت الإقامة
        </h1>
        <p className="mt-1 text-sm font-semibold text-gold-700 dark:text-gold-400">
          حَانَ الآنْ وَقْتُ الإِقَامَة
        </p>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          اختر صوت الإقامة الذي يرنّ عند دخول وقت الجماعة — كل التسجيلات مضمّنة في التطبيق
          وتعمل بدون إنترنت.
        </p>

        {/* Quick status chips */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              settings.iqamahSound && settings.adhanSound
                ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }`}
          >
            {settings.iqamahSound && settings.adhanSound ? (
              <Bell size={13} aria-hidden="true" />
            ) : (
              <BellOff size={13} aria-hidden="true" />
            )}
            {settings.iqamahSound && settings.adhanSound ? 'الصوت مُفعّل' : 'الصوت مُوقوف'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-100 px-3 py-1.5 text-xs font-semibold text-primary-700 dark:bg-primary-800/60 dark:text-primary-200">
            <Smartphone size={13} aria-hidden="true" />
            صفحة تلقائية عند وقت الجماعة
          </span>
        </div>
      </section>

      {/* Master switch */}
      <Card className="border border-primary-100/80 dark:border-primary-800/60">
        <ToggleRow
          label="تفعيل صوت الإقامة"
          description="يرنّ الصوت المختار أدناه عند دخول وقت الجماعة، بعد الأذان مباشرة"
          icon={
            settings.iqamahSound ? (
              <Volume2 size={18} className="text-primary-600 dark:text-gold-400" />
            ) : (
              <BellOff size={18} className="text-gray-400" />
            )
          }
          value={settings.iqamahSound}
          onChange={(v) => onSaveSettings({ iqamahSound: v })}
        />
        {!settings.adhanSound && (
          <p className="mt-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            صوت الأذان موقوف حاليًا — لن يرنّ صوت الإقامة حتى تُفعّل صوت الأذان من الإعدادات.
          </p>
        )}
      </Card>

      {/* Sound picker */}
      <section aria-label="اختيار صوت الإقامة">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-primary-900 dark:text-primary-100">
            الصوت المختار
          </h2>
          <Badge variant="primary">{IQAMAH_SOUNDS.length} أصوات</Badge>
        </div>

        <div
          role="radiogroup"
          aria-label="أصوات الإقامة"
          className={`space-y-2.5 transition-opacity duration-300 ${settings.iqamahSound ? '' : 'pointer-events-none opacity-50'}`}
        >
          {IQAMAH_SOUNDS.map(renderSoundCard)}
        </div>
      </section>

      {/* Iqamah offsets overview */}
      <section aria-label="توقيت الإقامة لكل صلاة">
        <h2 className="mb-3 text-base font-bold text-primary-900 dark:text-primary-100">
          توقيت الإقامة بعد الأذان
        </h2>
        <Card className="border border-primary-100/80 dark:border-primary-800/60">
          <p className="mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            الفترة بين الأذان والإقامة تُضبط من صفحة الصلاة حسب عادة مسجدك. هذه القيم
            الافتراضية الحالية:
          </p>
          <div className="grid grid-cols-5 gap-2">
            {OFFSET_PRAYERS.map((key) => {
              const minutes = offsetMinutes(settings, key);
              return (
                <div
                  key={key}
                  className="flex flex-col items-center rounded-xl bg-primary-50/60 py-2.5 dark:bg-primary-900/30"
                >
                  <span className="text-[0.6875rem] font-semibold text-gray-500 dark:text-gray-400">
                    {PRAYER_LABELS_AR[key]}
                  </span>
                  <span className="mt-0.5 text-sm font-bold text-primary-800 dark:text-gold-300">
                    {minutes > 0 ? `+${minutes}` : '0'}
                  </span>
                  <span className="text-[0.625rem] text-gray-400 dark:text-gray-500">دقيقة</span>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* How it works */}
      <section aria-label="كيف تعمل صفحة الإقامة">
        <h2 className="mb-3 text-base font-bold text-primary-900 dark:text-primary-100">
          كيف تعمل الصفحة التلقائية؟
        </h2>
        <div className="space-y-2.5">
          {[
            {
              icon: <Bell size={16} className="text-primary-600 dark:text-gold-400" />,
              title: 'عند دخول وقت الجماعة',
              desc: 'تفتح صفحة الإقامة تلقائيًا بصوت المختار — حتى لو كان التطبيق مغلقًا.',
            },
            {
              icon: <Smartphone size={16} className="text-primary-600 dark:text-gold-400" />,
              title: 'على الهاتف',
              desc: 'صفحة كاملة تظهر فوق شاشة القفل، بنفسها ترنّ بالإقامة لا بالأذان.',
            },
            {
              icon: <WifiOff size={16} className="text-primary-600 dark:text-gold-400" />,
              title: 'بدون إنترنت',
              desc: 'كل الأصوات مضمّنة داخل التطبيق — تعمل من أول فتحة بلا اتصال.',
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-3 rounded-2xl border border-primary-100/80 bg-white/70 p-3.5 dark:border-primary-800/50 dark:bg-primary-900/10"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-800/50">
                {item.icon}
              </span>
              <div>
                <p className="text-sm font-bold text-primary-900 dark:text-primary-100">
                  {item.title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {item.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Licence note */}
      <p className="flex items-start gap-2 rounded-2xl bg-gray-50 px-4 py-3 text-[0.6875rem] leading-relaxed text-gray-400 dark:bg-gray-900/50 dark:text-gray-500">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>
          التسجيلات الواردة في هذه الصفحة مرخّصة بتراخيص حرة (CC BY / CC BY-SA). الإسناد
          مذكور بجانب كل تسجيل، وهو موثّق أيضًا في ملف مصادر التطبيق.
        </span>
      </p>
    </div>
  );
}
