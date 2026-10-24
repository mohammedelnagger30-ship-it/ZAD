import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Moon, Sunrise, MapPin, BarChart3, Sun, Sunset, Check, X, Clock, Sparkles, BookOpen, ChevronLeft, Minus, Plus } from 'lucide-react';
import { Card, Button, Badge, SectionHeader, EmptyState } from '@/components/ui';
import { PrayerStatusSheet } from '@/components/PrayerStatusSheet';
import { PrayerWeekGrid } from '@/components/PrayerWeekGrid';
import { QiblaCompass } from '@/components/QiblaCompass';
import { DeviceProtectionBanner } from '@/components/DeviceProtectionBanner';
import type { Settings } from '@/db/database';
import type { NavParams, ScreenName } from '@/hooks/useApp';
import {
  calculatePrayerTimes,
  formatTime12h,
  getTimeUntil,
  getPrayerTimeZone,
  getIqamahTime,
  DEFAULT_IQAMAH_OFFSETS,
  type IqamahPrayerKey,
  CITY_PRESETS,
  isEgyptianLocation,
} from '@/utils/prayerTimes';
import { useCountdownClock, usePrayerSchedule } from '@/hooks/usePrayerSchedule';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import { trustedNow } from '@/utils/clock';
import {
  getDayPrayerRecords,
  confirmPrayer,
  setSunnah,
  getPrayerGrid,
  summariseGrid,
  FIVE_PRAYERS,
  PRAYER_LABELS_AR,
  computeRecordingWindows,
  isWindowOpen,
  type PrayerKey,
  type PrayerStatus,
  type PrayerRecordingWindow,
  canEditPrayerDate,
  type PrayerStats,
  type DayPrayerGrid,
} from '@/utils/prayerTracker';
import { todayKey, formatArabicDate, getHijriDate } from '@/utils/dateUtils';

interface PrayerScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  navigate: (screen: ScreenName, params?: NavParams) => void;
  params?: Record<string, unknown>;
}

/** Entry point into فقه الصلاة — the pillars/movements/errors/sunnah guide. */
function GuideBanner({ navigate }: Pick<PrayerScreenProps, 'navigate'>) {
  return (
    <button
      type="button"
      onClick={() => navigate('salah')}
      className="group flex w-full items-center gap-3 rounded-2xl border border-gold-300/70 bg-gold-50/40 px-4 py-3.5 text-right shadow-xs transition-all hover:border-gold-400 hover:shadow-md dark:border-[#cfa95c]/40 dark:bg-[#cfa95c]/[0.05] dark:hover:border-[#cfa95c]/70"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/15 text-gold-700 dark:bg-[#cfa95c]/15 dark:text-[#cfa95c]">
        <BookOpen size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-primary-900 dark:text-primary-50">فقه الصلاة</span>
        <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
          أركانها وحركاتها الصحيحة وأخطاؤها وسننها بأدلتها
        </span>
      </span>
      <ChevronLeft size={18} className="shrink-0 text-gray-400 transition-transform group-hover:-translate-x-1 dark:text-gray-500" />
    </button>
  );
}

/** Which (day, prayer) the status sheet is currently editing. */
interface SheetTarget {
  date: string;
  prayer: PrayerKey;
  label: string;
  isHistorical: boolean;
}

const PRAYER_ICONS: Record<string, typeof Moon> = {
  fajr: Sunrise, sunrise: Sun, dhuhr: Sun, asr: Sun, maghrib: Sunset, isha: Moon,
};

const NOTIFIABLE_PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * Voluntary prayers moved to their own screen: `NawafilScreen` holds every
 * نافلة (rawatib, witr, duha, qiyam) with its time, virtue and daily tracker.
 * This screen keeps the five فرائض only, plus the status sheet's rawatib slots
 * (those come straight from `prayerTracker`'s grid, not from a local list).
 */

export function PrayerScreen({ settings, onSaveSettings, navigate, params }: PrayerScreenProps) {
  const [records, setRecords] = useState<Record<string, string | null>>({});
  const [grid, setGrid] = useState<DayPrayerGrid[]>([]);
  const [stats, setStats] = useState<PrayerStats | null>(null);
  const [showLocation, setShowLocation] = useState(false);
  // Mosque timetable corrections and the جماعة minutes editor.
  const [showIqamahEditor, setShowIqamahEditor] = useState(false);
  // Which (day, prayer) the status sheet is open for, if any.
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // Reference clock for the countdown: per-second only in the last minute before a
  // prayer (see useCountdownClock) — not for the whole day.
  const nextPrayerTargetRef = useRef<number | null>(null);
  const now = useCountdownClock(nextPrayerTargetRef);
  const today = trustedNow();

  useEffect(() => {
    const prayerKey = params?.prayerKey;
    if (typeof prayerKey !== 'string' || !NOTIFIABLE_PRAYER_KEYS.includes(prayerKey)) return;
    document.getElementById(`prayer-time-${prayerKey}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [params]);

  const location =
    settings.latitude != null && settings.longitude != null
      ? {
          latitude: settings.latitude,
          longitude: settings.longitude,
          calcMethod: settings.calcMethod,
          asrMadhab: settings.asrMadhab,
          timeZone: getPrayerTimeZone(settings.timeZone, settings.cityName),
          prayerTimeAdjustments: settings.prayerTimeAdjustments,
        }
      : undefined;

  const load = useCallback(async () => {
    const recs = await getDayPrayerRecords(todayKey());
    const map: Record<string, string | null> = {};
    recs.forEach((r) => {
      map[r.prayer] = r.status;
    });
    setRecords(map);

    // The grid doubles as the weekly stats source, so the two can never disagree.
    const g = await getPrayerGrid(location);
    setGrid(g);
    setStats(summariseGrid(g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.latitude,
    settings.longitude,
    settings.calcMethod,
    settings.asrMadhab,
    settings.timeZone,
    settings.cityName,
    settings.prayerTimeAdjustments,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // The screen can stay open across midnight: the day list, week grid and stats must
  // roll over with the clock instead of showing yesterday's answers until somebody
  // reloads the page by hand. A minute-level comparison of the date key is all this
  // needs — the countdown's own cadence lives in useCountdownClock.
  useEffect(() => {
    let dayKey = todayKey();
    const interval = setInterval(() => {
      const currentDayKey = todayKey();
      if (currentDayKey !== dayKey) {
        dayKey = currentDayKey;
        void load();
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  // The midnight rollover above re-runs `load()`; the schedule hook only re-runs
  // on the day turning or the settings changing (see usePrayerSchedule).
  const { prayerTimeZone: timeZone, prayerResult, nextPrayer } = usePrayerSchedule({
    latitude: settings.latitude,
    longitude: settings.longitude,
    calcMethod: settings.calcMethod,
    asrMadhab: settings.asrMadhab,
    timeZone: settings.timeZone,
    cityName: settings.cityName,
    prayerTimeAdjustments: settings.prayerTimeAdjustments,
    now,
  });

  // The clock re-reads the ref at every wake, so pointing it at the next prayer's
  // instant is all the coordination the countdown needs.
  useEffect(() => {
    nextPrayerTargetRef.current = nextPrayer?.time.getTime() ?? null;
  });

  // Each فريضة opens for recording at its own adhan and shuts when the next
  // prayer's adhan comes: the day list, the status sheet and the week grid all
  // ask these windows, so none of them can offer a tap outside the prayer's
  // time. Yesterday keeps the wider correction rule through `canEditPrayerDate`
  // instead — a mistake stays fixable all the following day.
  const recordingWindows = useMemo(
    (): Record<string, PrayerRecordingWindow> =>
      computeRecordingWindows(
        (prayerResult?.prayers ?? [])
          .filter((prayer) => (FIVE_PRAYERS as readonly string[]).includes(prayer.name))
          .map((prayer) => ({ name: prayer.name, time: prayer.time })),
      ),
    [prayerResult],
  );
  const recordingOpen = (prayer: string) =>
    isWindowOpen(recordingWindows, prayer, now.getTime());

  // The day list changes itself at every adhan through the countdown clock, but
  // the week grid is a snapshot `load()` took: without this timer the grid would
  // go on offering a prayer whose window had shut (and never offer one whose
  // window had just opened) until midnight's reload. The +1s lands the reload
  // just past the boundary, so `trustedNow` inside it reads the crossed state.
  useEffect(() => {
    if (!prayerResult) return;
    const referenceNow = trustedNow().getTime();
    const nextBoundary = prayerResult.prayers
      .map((prayer) => prayer.time.getTime())
      .filter((time) => time > referenceNow)
      .sort((a, b) => a - b)[0];
    if (nextBoundary === undefined) return;
    const timer = window.setTimeout(() => void load(), nextBoundary - referenceNow + 1_000);
    return () => window.clearTimeout(timer);
  }, [prayerResult, load]);

  // Recording a prayer or a rawatib slot repaints the cell first and writes to
  // the database second. Recomputing the week grid (seven days of prayer times,
  // a sunnah query, and the stats that read it) before the tap shows anything
  // was the reason a checkmark used to arrive a beat late.
  const handlePick = async (status: PrayerStatus) => {
    if (!sheet) return;
    const { date, prayer } = sheet;
    const nextGrid = grid.map((day) =>
      day.date === date
        ? { ...day, status: { ...day.status, [prayer]: status } }
        : day,
    );
    setGrid(nextGrid);
    setStats(summariseGrid(nextGrid));
    setSheet(null);
    try {
      await confirmPrayer(date, prayer, status);
    } catch (error) {
      console.error('Recording prayer failed:', error);
    }
    void load();
  };

  /** Records one rawatib slot for whichever day the status sheet is editing. */
  const handleSheetSunnahToggle = async (type: string) => {
    if (!sheet) return;
    const { date, prayer } = sheet;
    const slot = grid
      .find((g) => g.date === date)
      ?.sunnah[prayer].find((s) => s.type === type);
    const done = !slot?.done;
    setGrid((prev) =>
      prev.map((day) =>
        day.date === date
          ? {
              ...day,
              sunnah: {
                ...day.sunnah,
                [prayer]: day.sunnah[prayer].map((s) =>
                  s.type === type ? { ...s, done } : s,
                ),
              },
            }
          : day,
      ),
    );
    try {
      await setSunnah(date, type, done);
    } catch (error) {
      console.error('Recording sunnah failed:', error);
    }
    void load();
  };

  const handleLocationPick = async (lat: number, lng: number, name: string) => {
    const city = CITY_PRESETS.find((preset) => preset.name === name);
    onSaveSettings({
      latitude: lat,
      longitude: lng,
      cityName: name,
      ...(city ? { timeZone: city.timeZone } : {}),
      locationMethod: 'manual',
    });
    setShowLocation(false);
  };

  const handleAutoLocation = () => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          if (!isEgyptianLocation(latitude, longitude)) {
            alert('التطبيق مضبوط لمصر فقط. سيستمر استخدام آخر موقع مصري محفوظ.');
            return;
          }
          onSaveSettings({
            latitude,
            longitude,
            cityName: 'موقعي داخل مصر',
            timeZone: 'Africa/Cairo',
            locationMethod: 'auto',
          });
          setShowLocation(false);
        },
        () => {
          alert('تعذّر تحديد موقعك الآن. سيستمر استخدام آخر موقع مصري محفوظ، ويمكنك اختيار القاهرة أو الإسكندرية.');
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
      );
    } else {
      alert('المتصفح لا يدعم تحديد الموقع. سيستمر استخدام آخر موقع مصري محفوظ.');
    }
  };

  if (!prayerResult) {
    return (
      <div className="space-y-4 pb-4">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">مواقيت الصلاة</h1>
        <GuideBanner navigate={navigate} />
        <EmptyState
          icon={<MapPin size={48} />}
          title="حدد موقعك"
          description="اختر مدينتك أو اسمح بتحديد موقعك تلقائياً لحساب مواقيت الصلاة"
          action={<Button onClick={() => setShowLocation(true)} variant="primary">تحديد الموقع</Button>}
        />
        {showLocation && (
          <LocationPicker
            onPick={handleLocationPick}
            onAuto={handleAutoLocation}
            onClose={() => setShowLocation(false)}
          />
        )}
      </div>
    );
  }

  // Today's adhan instants, keyed for the iqamah editor's live preview: each
  // row shows what its offset lands on *today*, not just a bare minute count.
  const iqamahPreview = Object.fromEntries(
    prayerResult.prayers
      .filter((prayer) => prayer.name !== 'sunrise')
      .map((prayer) => [prayer.name, prayer.time]),
  ) as Partial<Record<IqamahPrayerKey, Date>>;

  return (
    <div className="space-y-6 pb-6">
      {/* Enhanced Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-primary-800 dark:text-primary-100">مواقيت الصلاة</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {formatArabicDate(today)} — {getHijriDate(today, settings.hijriAdjustment)}
          </p>
        </div>
        <button
          onClick={() => setShowLocation(true)}
          className="flex max-w-[45vw] items-center gap-2 truncate rounded-2xl border-2 border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 shadow-md transition-all hover:border-primary-400 hover:shadow-lg dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-200 dark:hover:border-primary-600"
        >
          <MapPin size={18} />
          {settings.cityName || 'الموقع'}
        </button>
      </div>

      <GuideBanner navigate={navigate} />

      {/* Only when the device itself can silence the adhan — nothing to show otherwise. */}
      <DeviceProtectionBanner />

      {/* Enhanced Next Prayer Highlight — deep high-contrast gradient that stays readable on every palette */}
      {nextPrayer && (
        <div className="relative isolate overflow-hidden rounded-[2rem] p-6 shadow-2xl backdrop-blur-sm">
          {/* Deep primary gradient: light mode uses 600→900 for strong contrast, dark mode uses 700→950 */}
          <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 dark:from-primary-700 dark:via-primary-800 dark:to-primary-950" />
          {/* Ambient accent glow for depth */}
          <div className="pointer-events-none absolute -top-8 -right-8 -z-10 h-48 w-48 rounded-full bg-[var(--func-accent)]/25 blur-3xl dark:bg-[var(--func-accent)]/15" />
          {/* Decorative patterns — clearer borders for light mode */}
          <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full border-4 border-white/20 dark:border-white/10" />
          <div className="pointer-events-none absolute -right-10 top-10 -z-10 h-40 w-40 rounded-full border-4 border-white/20 dark:border-white/10" />
          <div className="pointer-events-none absolute right-1/3 bottom-0 -z-10 h-48 w-48 rounded-full border-4 border-white/20 dark:border-white/10 opacity-70" />
          <Clock className="pointer-events-none absolute -right-8 bottom-0 -z-10 h-40 w-40 rotate-12 text-white/[0.12] dark:text-white/[0.08]" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="flex-1">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/25 px-3 py-1.5 backdrop-blur-xs border border-white/30 dark:border-white/15">
                <span className="h-2 w-2 rounded-full bg-[var(--func-accent)] animate-pulse shadow-[0_0_16px_var(--func-accent)]" />
                <p className="text-xs font-semibold text-white">الصلاة القادمة</p>
              </div>
              <h2 className="text-4xl font-bold leading-tight sm:text-5xl text-white">{nextPrayer.arabicName}</h2>
              <p className="mt-3 text-xl font-semibold text-gold-300 drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)]">
                {getTimeUntil(nextPrayer.time, now)}
              </p>
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent('zad:trigger-azan', {
                      detail: {
                        prayerKey: (nextPrayer?.name as PrayerKey) || 'fajr',
                        prayerName: nextPrayer?.arabicName || 'الفجر',
                        // Without it the page has no instant to show: it would open
                        // claiming «الآن» with no time, no إقامة beside it, and no
                        // stale-close guard — a preview that looked broken.
                        prayerTime: nextPrayer?.time,
                        isPreview: true,
                      },
                    })
                  );
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/15 hover:bg-white/20 px-4 py-2.5 text-sm font-bold text-white backdrop-blur-xs transition-all hover:scale-105 border border-white/30 shadow-lg dark:bg-[var(--func-accent)]/15 dark:hover:bg-[var(--func-accent)]/25 dark:text-[var(--func-accent)] dark:border-[var(--func-accent)]/40"
              >
                <Sparkles size={16} />
                عرض صفحة الأذان
              </button>
            </div>
            <div className="flex flex-col items-center justify-center rounded-3xl bg-white/25 backdrop-blur-xs px-6 py-4 border border-white/30 shadow-xl dark:bg-white/10 dark:border-white/15">
              <p className="text-5xl font-bold text-white sm:text-6xl">
                {formatTime12h(nextPrayer.time, timeZone)}
              </p>
              <p className="mt-1 text-xs text-white/90 dark:text-white/80">وقت الصلاة</p>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Prayer Times List */}
      <div>
        <SectionHeader
          title="صلوات اليوم"
          icon={<Moon size={20} />}
          action={
            <button
              type="button"
              onClick={() => setShowIqamahEditor(true)}
              className="flex items-center gap-1.5 rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-bold text-primary-700 transition hover:border-primary-400 hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-200 dark:hover:border-primary-600"
            >
              <Clock size={14} />
              ضبط مواقيت المسجد
            </button>
          }
        />
        <div className="mb-4 rounded-2xl bg-primary-50 dark:bg-primary-900/30 p-4 border border-primary-100 dark:border-primary-800">
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            هذه مواقيت الفرائض الخمس: الأذان والإقامة لكل صلاة. تُفتح كل صلاة للتسجيل من ميعاد
            أذانها وتُغلق بتأذين التي بعدها — فلا يقبل التسجيل خارج وقتها. تصحيح صلوات الأمس
            متاح طوال اليوم التالي. وأما السنن الرواتب والنوافل فمكانها صفحة «النوافل».
          </p>
        </div>
        <div className="space-y-4">
          {prayerResult.prayers.map((prayer) => {
            const isSunrise = prayer.name === 'sunrise';
            const Icon = PRAYER_ICONS[prayer.name] || Moon;
            const confirmed = (records[prayer.name] as PrayerStatus | null | undefined) ?? null;
            // Recordable only inside its own window: from this prayer's adhan
            // until the next prayer's adhan. Before it there is nothing to
            // record; after it the day's list shuts and tomorrow's correction
            // rule (أمس) opens instead.
            const answerable = !isSunrise && recordingOpen(prayer.name);

            const row = (
              <div className="flex items-center gap-4">
                <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 ${
                  prayer.passed
                    ? 'border-primary-300 bg-gradient-to-br from-primary-100 to-primary-200 dark:border-primary-700 dark:from-primary-800 dark:to-primary-900'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                }`}>
                  <Icon size={24} className={prayer.passed ? 'text-primary-600 dark:text-gold-400' : 'text-gray-400'} />
                  {prayer.passed && <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-gold-400 shadow-xs" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-bold text-primary-800 dark:text-primary-100">{prayer.arabicName}</p>
                  {/* The row *is* the table the reader asked for: أذان and
                      إقامة side by side. Sunrise has no جماعة, so it keeps its
                      single time. */}
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">
                    {isSunrise ? (
                      formatTime12h(prayer.time, timeZone)
                    ) : (
                      <>
                        الأذان {formatTime12h(prayer.time, timeZone)}
                        <span className="mx-1 text-gray-300 dark:text-gray-600">•</span>
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          الإقامة{' '}
                          {formatTime12h(
                            getIqamahTime(prayer.time, prayer.name, settings.iqamahOffsets),
                            timeZone,
                          )}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {isSunrise ? (
                  <Badge variant="gold"><Sun size={12} /> شروق</Badge>
                ) : !prayer.passed ? (
                  <Badge variant="neutral">{getTimeUntil(prayer.time, now)}</Badge>
                ) : (
                  <span className="flex flex-col items-end gap-1">
                    {confirmed === 'ontime' && <Badge variant="success"><Check size={12} /> في وقتها</Badge>}
                    {confirmed === 'late' && <Badge variant="warning"><Clock size={12} /> قضاء</Badge>}
                    {confirmed === 'missed' && <Badge variant="error"><X size={12} /> لم صلَّ</Badge>}
                    {!confirmed && <Badge variant="neutral">لم تسجّلها</Badge>}
                    <span className="text-xs text-primary-600 dark:text-gold-400 font-medium">
                      {!answerable
                        ? 'انتهى وقت التسجيل'
                        : confirmed
                          ? 'اضغط للعرض'
                          : 'اضغط للتأكيد'}
                    </span>
                  </span>
                )}
              </div>
            );

            const prayerCard = !answerable ? (
              <Card className="p-5!">{row}</Card>
            ) : (
              <button
                onClick={() =>
                  setSheet({
                    date: todayKey(),
                    prayer: prayer.name as PrayerKey,
                    label: PRAYER_LABELS_AR[prayer.name as PrayerKey],
                    isHistorical: false,
                  })
                }
                aria-label={`صلاة ${prayer.arabicName} — ${
                  confirmed ? 'مسجّلة، اضغط للعرض' : 'لم تسجّل بعد، اضغط للتأكيد'
                }`}
                className={`block w-full text-right p-5 rounded-3xl border-r-4 transition-all duration-300 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-100 dark:focus-visible:ring-primary-900/50 ${
                  confirmed
                    ? 'border-r-primary-500 bg-white dark:bg-primary-900/40 hover:bg-primary-50 dark:hover:bg-primary-800/40 shadow-md'
                    : 'border-r-gray-200 dark:border-r-gray-700 bg-white dark:bg-primary-900/40 hover:border-r-primary-400 dark:hover:border-r-primary-600 hover:shadow-lg'
                }`}
              >
                {row}
              </button>
            );

            return (
              <div id={`prayer-time-${prayer.name}`} key={prayer.name}>
                {prayerCard}
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Qibla compass — the static bearing number is now an instrument
          the phone can actually aim with. */}
      <QiblaCompass
        qiblaDirection={prayerResult.qiblaDirection}
        contextLabel={settings.cityName ? `حسب موقعك: ${settings.cityName}` : undefined}
      />

      {/* Voluntary prayers moved to their own screen — this is the doorway. */}
      <button
        type="button"
        onClick={() => navigate('nawafil')}
        className="group flex w-full items-center gap-3 rounded-2xl border border-violet-300/70 bg-violet-50/50 px-4 py-3.5 text-right shadow-xs transition-all hover:border-violet-400 hover:shadow-md dark:border-violet-500/40 dark:bg-violet-500/10 dark:hover:border-violet-400/70"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/15 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300">
          <Sparkles size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-primary-900 dark:text-primary-50">
            صفحة النوافل
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
            السنن الرواتب والوتر والضحى وقيام الليل — مع أوقاتها وأفضلها ومتتبع يومي
          </span>
        </span>
        <ChevronLeft
          size={18}
          className="shrink-0 text-gray-400 transition-transform group-hover:-translate-x-1 dark:text-gray-500"
        />
      </button>

      {/* Enhanced Weekly Grid */}
      {grid.length > 0 && (
        <div>
          <SectionHeader title="صلوات الأسبوع" icon={<BarChart3 size={20} />} />
          <Card className="p-5!">
            <PrayerWeekGrid
              grid={grid}
              onEdit={(date, prayer, _status, label) =>
                setSheet({ date, prayer, label, isHistorical: date !== todayKey() })
              }
            />
            <div className="mt-4 rounded-2xl bg-primary-50 dark:bg-primary-900/30 p-4 border border-primary-100 dark:border-primary-800">
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                يمكنك تسجيل اليوم أو أمس فقط؛ الأيام الأقدم للعرض. والتأكيد يُحفظ فور الضغط ولا يمكن تغييره بعد ذلك.
                النقاط الصغيرة أسفل كل خانة هي السنن الرواتب المرتبطة بها: ملوّنة تعني صُلّيت، وحافّة فارغة تعني
                لم تُسجَّل بعد — اضغط الخانة عشان تسجلها مع صلاتها في نفس الخطوة.
              </p>
            </div>
          </Card>
        </div>
      )}

      {/* Enhanced Weekly Stats */}
      {stats && (
        <div>
          <SectionHeader title="ملخص الأسبوع" icon={<BarChart3 size={20} />} />
          <Card className="p-6!">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">نسبة الالتزام</p>
                <p className="text-4xl font-bold text-primary-700 dark:text-gold-400 mt-1">{stats.percentage}%</p>
              </div>
              <div className="h-20 w-20 rounded-full border-4 border-primary-200 dark:border-primary-800 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-linear-to-br from-primary-500 to-gold-400 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">{stats.percentage}%</span>
                </div>
              </div>
            </div>
            <div className="w-full h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-linear-to-r from-primary-500 via-primary-600 to-gold-400 rounded-full transition-all duration-700 ease-out shadow-lg"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
              <div className="rounded-2xl bg-success-50 dark:bg-success-900/20 p-4 border border-success-200 dark:border-success-800 text-center">
                <p className="text-2xl font-bold text-success-600">{stats.ontime}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">في وقتها</p>
              </div>
              <div className="rounded-2xl bg-warning-50 dark:bg-warning-900/20 p-4 border border-warning-200 dark:border-warning-800 text-center">
                <p className="text-2xl font-bold text-warning-600">{stats.late}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">قضاء</p>
              </div>
              <div className="rounded-2xl bg-error-50 dark:bg-error-900/20 p-4 border border-error-200 dark:border-error-800 text-center">
                <p className="text-2xl font-bold text-error-600">{stats.missed}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">فائتة</p>
              </div>
              <div className="rounded-2xl bg-gray-50 dark:bg-gray-800/30 p-4 border border-gray-200 dark:border-gray-700 text-center">
                <p className="text-2xl font-bold text-gray-400">{stats.unconfirmed}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">لم تسجّلها</p>
              </div>
            </div>
            {stats.unconfirmed > 0 && (
              <div className="mt-4 rounded-2xl bg-primary-50 dark:bg-primary-900/30 p-4 border border-primary-100 dark:border-primary-800">
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                  «لم تسجّلها» يعني إن الوقت عدّى والتسجيل مش موجود — مش إنك ما صليتهاش.
                  اضغط على أي خانة متاحة في الشبكة فوق لتسجيلها، وخانات الأمس تُصحَّح طوال اليوم.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Location picker modal */}
      {showLocation && (
        <LocationPicker
          onPick={handleLocationPick}
          onAuto={handleAutoLocation}
          onClose={() => setShowLocation(false)}
        />
      )}

      {showIqamahEditor && (
        <IqamahEditor
          settings={settings}
          todayTimes={iqamahPreview}
          onSave={({ iqamahOffsets, prayerTimeAdjustments }) => {
            // Both adjustments affect prayer display and every related alarm.
            onSaveSettings({ iqamahOffsets, prayerTimeAdjustments });
            setShowIqamahEditor(false);
          }}
          onClose={() => setShowIqamahEditor(false)}
        />
      )}

      {/* Prayer confirmation */}
      {sheet && (
        <PrayerStatusSheet
          prayer={sheet.prayer}
          timeLabel={formatTime12h(
            calculatePrayerTimes(
              settings.latitude!,
              settings.longitude!,
              today,
              settings.calcMethod,
              settings.asrMadhab,
              timeZone,
              settings.prayerTimeAdjustments,
            ).prayers.find((p) => p.name === sheet.prayer)!.time,
            timeZone,
          )}
          status={(() => {
            // The grid row is authoritative for the day being edited, *including* when
            // its status is null. The old `??` chain fell through to `records` — which
            // only ever holds today's five prayers — every time the grid said
            // "unrecorded", so yesterday's cell opened with today's answer and then
            // disagreed with the sheet for the rest of the week.
            const row = grid.find((g) => g.date === sheet.date);
            if (row) return (row.status[sheet.prayer] ?? null) as PrayerStatus | null;
            // Before the grid loads, only today's list can say anything at all.
            return sheet.date === todayKey()
              ? ((records[sheet.prayer] as PrayerStatus | null) ?? null)
              : null;
          })()}
          editable={
            canEditPrayerDate(sheet.date) &&
            // Today is additionally bound to the prayer's own window (adhan →
            // the next adhan); an idle sheet that outlives its window turns
            // read-only instead of letting a tap land outside the prayer's time.
            // Yesterday needs no window — the whole day is its correction time.
            (sheet.date !== todayKey() || recordingOpen(sheet.prayer))
          }
          isHistorical={sheet.isHistorical}
          dateLabel={sheet.label}
          sunnahs={grid.find((g) => g.date === sheet.date)?.sunnah[sheet.prayer]}
          onToggleSunnah={(type) => void handleSheetSunnahToggle(type)}
          onPick={handlePick}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function LocationPicker({
  onPick,
  onAuto,
  onClose,
}: {
  onPick: (lat: number, lng: number, name: string) => void;
  onAuto: () => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = CITY_PRESETS.filter((c) => c.name.includes(search) || !search);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Back, Escape and Tab stay inside the picker. Without this the Android back
  // button fell through to screen navigation and unmounted the whole prayer
  // screen from behind a dialog the user believed they were dismissing.
  useDialogBehavior(true, onClose, panelRef);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
        tabIndex={-1}
        className="w-full max-w-md md:max-w-lg outline-none"
      >
        <Card className="max-h-[80vh] flex flex-col animate-slide-up p-0!" noPadding>
          <div className="p-4 border-b border-primary-100 dark:border-primary-800">
            <h2 id="location-picker-title" className="text-lg font-bold text-primary-800 dark:text-primary-100 mb-3">اختر موقعك</h2>
          <Button variant="secondary" size="sm" onClick={onAuto} className="mb-2">
            <MapPin size={16} /> تحديد موقعي تلقائياً
          </Button>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن مدينة..."
            className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
          />
        </div>
        <div className="overflow-y-auto flex-1 p-2">
          {filtered.map((city) => (
            <button
              key={city.name}
              onClick={() => onPick(city.latitude, city.longitude, city.name)}
              className="w-full text-right p-3 rounded-xl hover:bg-primary-50 dark:hover:bg-primary-800/30 transition-smooth flex items-center gap-2"
            >
              <MapPin size={16} className="text-primary-500" />
              <span className="text-sm text-primary-800 dark:text-primary-100">{city.name}</span>
            </button>
          ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * The جماعة's minute per prayer, edited beside the table that reads it.
 * Each row previews today's resulting wall-clock time — the number and its
 * consequence are one glance apart — and saving goes through the shared
 * settings path, whose schedule fingerprint re-arms the iqamah alerts.
 */
function IqamahEditor({
  settings,
  todayTimes,
  onSave,
  onClose,
}: {
  settings: Settings;
  todayTimes: Partial<Record<IqamahPrayerKey, Date>>;
  onSave: (values: {
    iqamahOffsets: Record<IqamahPrayerKey, number>;
    prayerTimeAdjustments: Record<IqamahPrayerKey, number>;
  }) => void;
  onClose: () => void;
}) {
  const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const [draft, setDraft] = useState<Record<IqamahPrayerKey, number>>(() => ({
    ...DEFAULT_IQAMAH_OFFSETS,
    ...settings.iqamahOffsets,
  }));
  const [adhanDraft, setAdhanDraft] = useState<Record<IqamahPrayerKey, number>>(() => ({
    fajr: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
    ...settings.prayerTimeAdjustments,
  }));
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Back, Escape and Tab stay inside the editor instead of navigating the
  // prayer screen underneath it.
  useDialogBehavior(true, onClose, panelRef);

  const rows: { key: IqamahPrayerKey; label: string }[] = [
    { key: 'fajr', label: 'الفجر' },
    { key: 'dhuhr', label: 'الظهر' },
    { key: 'asr', label: 'العصر' },
    { key: 'maghrib', label: 'المغرب' },
    { key: 'isha', label: 'العشاء' },
  ];

  const setMinutes = (key: IqamahPrayerKey, minutes: number) => {
    const clamped = Math.min(Math.max(Math.round(minutes) || 0, 0), 120);
    setDraft((prev) => ({ ...prev, [key]: clamped }));
  };
  const setAdhanMinutes = (key: IqamahPrayerKey, minutes: number) => {
    const clamped = Math.min(Math.max(Math.round(minutes) || 0, -30), 30);
    setAdhanDraft((prev) => ({ ...prev, [key]: clamped }));
  };

  const previewAdhan = (key: IqamahPrayerKey): Date | undefined => {
    const currentTime = todayTimes[key];
    if (!currentTime) return undefined;
    const currentAdjustment = settings.prayerTimeAdjustments?.[key] ?? 0;
    return new Date(
      currentTime.getTime() + (adhanDraft[key] - currentAdjustment) * 60_000,
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      dir="rtl"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="iqamah-editor-title"
        tabIndex={-1}
        className="w-full max-w-md outline-none"
      >
        <Card className="max-h-[85vh] overflow-y-auto animate-slide-up p-4!">
        <div className="mb-4">
          <h2 id="iqamah-editor-title" className="text-lg font-bold text-primary-800 dark:text-primary-100">ضبط مواقيت المسجد</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            قارن بجدول مسجدك. الرقم الموجب يؤخر الأذان والسالب يقدّمه؛ ثم حدّد دقائق الإقامة بعده.
          </p>
        </div>

        <div className="space-y-2.5">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-2xl border border-primary-100 bg-white px-4 py-3 dark:border-primary-800 dark:bg-primary-900/40"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-primary-800 dark:text-primary-100">{row.label}</p>
                {previewAdhan(row.key) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    اليوم: الأذان {formatTime12h(previewAdhan(row.key)!, timeZone)}
                    {' · '}الإقامة{' '}
                    {formatTime12h(getIqamahTime(previewAdhan(row.key)!, row.key, draft), timeZone)}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <div className="flex items-center gap-1">
                  <span className="w-14 text-[0.625rem] text-gray-500 dark:text-gray-400">تصحيح الأذان</span>
                  <button
                    type="button"
                    onClick={() => setAdhanMinutes(row.key, adhanDraft[row.key] - 1)}
                    aria-label={`تقديم أذان ${row.label} دقيقة`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 transition hover:bg-primary-50 disabled:opacity-40 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                    disabled={adhanDraft[row.key] <= -30}
                  >
                    <Minus size={13} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={-30}
                    max={30}
                    value={adhanDraft[row.key]}
                    onChange={(e) => setAdhanMinutes(row.key, Number(e.target.value))}
                    aria-label={`تصحيح أذان ${row.label} بالدقائق`}
                    className="w-12 rounded-lg border border-primary-200 bg-gray-50 py-1 text-center text-sm font-bold text-primary-800 dark:border-primary-700 dark:bg-primary-800/30 dark:text-primary-100"
                  />
                  <button
                    type="button"
                    onClick={() => setAdhanMinutes(row.key, adhanDraft[row.key] + 1)}
                    aria-label={`تأخير أذان ${row.label} دقيقة`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 transition hover:bg-primary-50 disabled:opacity-40 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                    disabled={adhanDraft[row.key] >= 30}
                  >
                    <Plus size={13} />
                  </button>
                  <span className="w-7 text-[0.625rem] text-gray-400 dark:text-gray-500">دقيقة</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-14 text-[0.625rem] text-gray-500 dark:text-gray-400">الإقامة بعده</span>
                  <button
                    type="button"
                    onClick={() => setMinutes(row.key, draft[row.key] - 5)}
                    aria-label={`إنقاص إقامة ${row.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 transition hover:bg-primary-50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                    disabled={draft[row.key] <= 0}
                  >
                    <Minus size={13} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={120}
                    value={draft[row.key]}
                    onChange={(e) => setMinutes(row.key, Number(e.target.value))}
                    aria-label={`دقائق إقامة ${row.label} بعد الأذان`}
                    className="w-12 rounded-lg border border-primary-200 bg-gray-50 py-1 text-center text-sm font-bold text-primary-800 dark:border-primary-700 dark:bg-primary-800/30 dark:text-primary-100"
                  />
                  <button
                    type="button"
                    onClick={() => setMinutes(row.key, draft[row.key] + 5)}
                    aria-label={`زيادة إقامة ${row.label}`}
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 transition hover:bg-primary-50 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                    disabled={draft[row.key] >= 120}
                  >
                    <Plus size={13} />
                  </button>
                  <span className="w-7 text-[0.625rem] text-gray-400 dark:text-gray-500">دقيقة</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            onClick={() => onSave({ iqamahOffsets: draft, prayerTimeAdjustments: adhanDraft })}
            className="flex-1"
          >
            حفظ
          </Button>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
        </Card>
      </div>
    </div>
  );
}
