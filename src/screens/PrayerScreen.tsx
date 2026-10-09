import { useState, useEffect, useCallback } from 'react';
import { Moon, Sunrise, MapPin, Compass, BarChart3, Sun, Sunset, Check, X, Clock, Sparkles } from 'lucide-react';
import { Card, Button, Badge, SectionHeader, EmptyState } from '@/components/ui';
import { PrayerStatusSheet } from '@/components/PrayerStatusSheet';
import { PrayerWeekGrid } from '@/components/PrayerWeekGrid';
import type { Settings } from '@/db/database';
import {
  calculatePrayerTimes,
  formatTime12h,
  getTimeUntil,
  getNextPrayer,
  getPrayerTimeZone,
  CITY_PRESETS,
} from '@/utils/prayerTimes';
import {
  getDayPrayerRecords,
  confirmPrayer,
  clearPrayer,
  getDaySunnahRecords,
  setSunnah,
  getPrayerGrid,
  summariseGrid,
  PRAYER_LABELS_AR,
  RAWATIB_BY_PRAYER,
  sunnahDoneMap,
  type PrayerKey,
  type PrayerStatus,
  canEditPrayerDate,
  type PrayerStats,
  type DayPrayerGrid,
} from '@/utils/prayerTracker';
import { todayKey, formatArabicDate, getHijriDate } from '@/utils/dateUtils';

interface PrayerScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
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

/**
 * Every sunnah this screen offers.
 *
 * The rawatib are built from the single definition in `prayerTracker`, so the
 * day list, the week grid and the status sheet can never disagree about which
 * slot belongs to which prayer. The two independent voluntary prayers are
 * appended because they are attached to no fard prayer.
 */
const SUNNAH_TYPES: {
  key: string;
  label: string;
  prayer?: PrayerKey;
  note?: string;
}[] = [
  ...Object.entries(RAWATIB_BY_PRAYER).flatMap(([prayer, slots]) =>
    slots.map((slot) => ({
      key: slot.type,
      prayer: prayer as PrayerKey,
      label: slot.label,
      note: prayer === 'fajr' ? 'من السنن الرواتب المؤكدة' : 'سنة راتبة',
    })),
  ),
  { key: 'witr', prayer: 'isha', label: 'صلاة الوتر', note: 'نافلة بعد العشاء' },
  { key: 'duha', label: 'صلاة الضحى', note: 'نافلة مستقلة' },
];

export function PrayerScreen({ settings, onSaveSettings }: PrayerScreenProps) {
  const [records, setRecords] = useState<Record<string, string | null>>({});
  const [confirmedAt, setConfirmedAt] = useState<Record<string, number | null>>({});
  const [sunnahRecords, setSunnahRecords] = useState<Record<string, boolean>>({});
  const [grid, setGrid] = useState<DayPrayerGrid[]>([]);
  const [stats, setStats] = useState<PrayerStats | null>(null);
  const [showLocation, setShowLocation] = useState(false);
  // Which (day, prayer) the status sheet is open for, if any.
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  // Reference clock for the countdown; keeps `getTimeUntil` in sync with one timer.
  const [now, setNow] = useState(() => new Date());
  const today = new Date();

  const location =
    settings.latitude != null && settings.longitude != null
      ? {
          latitude: settings.latitude,
          longitude: settings.longitude,
          calcMethod: settings.calcMethod,
          asrMadhab: settings.asrMadhab,
          timeZone: getPrayerTimeZone(settings.timeZone, settings.cityName),
        }
      : undefined;

  const load = useCallback(async () => {
    const recs = await getDayPrayerRecords(todayKey());
    const map: Record<string, string | null> = {};
    const times: Record<string, number | null> = {};
    recs.forEach((r) => {
      map[r.prayer] = r.status;
      times[r.prayer] = r.confirmedAt ?? null;
    });
    setRecords(map);
    setConfirmedAt(times);

    // `sunnahDoneMap` folds the legacy combined Dhuhr row, so today's list and
    // the week grid read older records identically.
    const sunnahMap = sunnahDoneMap(await getDaySunnahRecords(todayKey()));
    setSunnahRecords(sunnahMap);

    // The grid doubles as the weekly stats source, so the two can never disagree.
    const g = await getPrayerGrid(location);
    setGrid(g);
    setStats(summariseGrid(g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.latitude, settings.longitude, settings.calcMethod, settings.asrMadhab, settings.timeZone, settings.cityName]);

  useEffect(() => {
    load();
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [load]);

  const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const prayerResult = settings.latitude != null && settings.longitude != null
    ? calculatePrayerTimes(settings.latitude, settings.longitude, now, settings.calcMethod, settings.asrMadhab, timeZone)
    : null;

  const nextPrayer = settings.latitude != null && settings.longitude != null
    ? getNextPrayer(settings.latitude, settings.longitude, settings.calcMethod, settings.asrMadhab, timeZone)
    : null;

  const handlePick = async (status: PrayerStatus) => {
    if (!sheet) return;
    await confirmPrayer(sheet.date, sheet.prayer, status);
    await load();
  };

  const handleClear = async () => {
    if (!sheet) return;
    await clearPrayer(sheet.date, sheet.prayer);
    await load();
    setSheet(null);
  };

  const handleSunnahToggle = async (type: string) => {
    await setSunnah(todayKey(), type, !sunnahRecords[type]);
    await load();
  };

  /** Records one rawatib slot for whichever day the status sheet is editing. */
  const handleSheetSunnahToggle = async (type: string) => {
    if (!sheet) return;
    const slot = grid
      .find((g) => g.date === sheet.date)
      ?.sunnah[sheet.prayer].find((s) => s.type === type);
    await setSunnah(sheet.date, type, !slot?.done);
    await load();
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
          onSaveSettings({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            cityName: 'موقعي الحالي',
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locationMethod: 'auto',
          });
          setShowLocation(false);
        },
        () => {
          alert('تعذّر تحديد موقعك. اختر مدينة يدخياً.');
        }
      );
    } else {
      alert('المتصفح لا يدعم تحديد الموقع. اختر مدينة يدخياً.');
    }
  };

  if (!prayerResult) {
    return (
      <div className="space-y-4 pb-4">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">مواقيت الصلاة</h1>
        <EmptyState
          icon={<MapPin size={48} />}
          title="حدد موقعك"
          description="اختر مدينتك أو اسمح بتحديد موقعك تلقائياً لحساب مواقيت الصلاة"
          action={<Button onClick={() => setShowLocation(true)} variant="primary">تحديد الموقع</Button>}
        />
        {showLocation && <LocationPicker onPick={handleLocationPick} onAuto={handleAutoLocation} />}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-6">
      {/* Enhanced Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary-800 dark:text-primary-100">مواقيت الصلاة</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {formatArabicDate(today)} — {getHijriDate(today)}
          </p>
        </div>
        <button
          onClick={() => setShowLocation(true)}
          className="flex items-center gap-2 rounded-2xl border-2 border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 shadow-md transition-all hover:border-primary-400 hover:shadow-lg dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-200 dark:hover:border-primary-600"
        >
          <MapPin size={18} />
          {settings.cityName || 'الموقع'}
        </button>
      </div>

      {/* Enhanced Next Prayer Highlight */}
      {nextPrayer && (
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 p-6 text-white shadow-2xl dark:from-primary-700 dark:via-primary-800 dark:to-primary-950">
          {/* Decorative patterns */}
          <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full border-4 border-white/5" />
          <div className="pointer-events-none absolute -right-10 top-10 -z-10 h-40 w-40 rounded-full border-4 border-white/5" />
          <div className="pointer-events-none absolute right-1/3 bottom-0 -z-10 h-48 w-48 rounded-full border-4 border-white/5 opacity-50" />
          <Clock className="pointer-events-none absolute -right-8 bottom-0 -z-10 h-40 w-40 rotate-12 text-white/[0.05]" />

          <div className="relative flex items-center justify-between gap-6">
            <div className="flex-1">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-gold-400 animate-pulse" />
                <p className="text-xs font-semibold text-white/90">الصلاة القادمة</p>
              </div>
              <h2 className="text-4xl font-bold leading-tight sm:text-5xl">{nextPrayer.arabicName}</h2>
              <p className="mt-3 text-xl text-gold-300 font-semibold">
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
                        isPreview: true,
                      },
                    })
                  );
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-gold-400/20 hover:bg-gold-400/30 px-4 py-2.5 text-sm font-bold text-gold-300 backdrop-blur-sm transition-all hover:scale-105 border border-gold-400/30 shadow-lg"
              >
                <Sparkles size={16} />
                عرض صفحة الأذان
              </button>
            </div>
            <div className="flex flex-col items-center justify-center rounded-3xl bg-white/10 backdrop-blur-sm px-6 py-4 border border-white/20 shadow-xl">
              <p className="text-5xl font-bold text-gold-300 sm:text-6xl">
                {formatTime12h(nextPrayer.time, timeZone)}
              </p>
              <p className="mt-1 text-xs text-white/70">وقت الصلاة</p>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced Prayer Times List */}
      <div>
        <SectionHeader title="صلوات اليوم" icon={<Moon size={20} />} />
        <div className="mb-4 rounded-2xl bg-primary-50 dark:bg-primary-900/30 p-4 border border-primary-100 dark:border-primary-800">
          <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
            تظهر السنة الراتبة بجوار فرضها: ركعتان قبل الفجر، وست للظهر (أربع قبلًا واثنتان بعدًا)، وركعتان بعد المغرب وركعتان بعد العشاء.
            وكلها مقفولة حتى ميعاد صلاتها — تُسجَّل مع الصلاة لا قبلها.
          </p>
        </div>
        <div className="space-y-4">
          {prayerResult.prayers.map((prayer) => {
            const isSunrise = prayer.name === 'sunrise';
            const Icon = PRAYER_ICONS[prayer.name] || Moon;
            const confirmed = (records[prayer.name] as PrayerStatus | null | undefined) ?? null;
            const answerable = !isSunrise && prayer.passed;
            const attachedSunnahs = SUNNAH_TYPES.filter((sunnah) => sunnah.prayer === prayer.name);
            const isAsr = prayer.name === 'asr';

            const row = (
              <div className="flex items-center gap-4">
                <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 ${
                  prayer.passed
                    ? 'border-primary-300 bg-gradient-to-br from-primary-100 to-primary-200 dark:border-primary-700 dark:from-primary-800 dark:to-primary-900'
                    : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                }`}>
                  <Icon size={24} className={prayer.passed ? 'text-primary-600 dark:text-gold-400' : 'text-gray-400'} />
                  {prayer.passed && <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-gold-400 shadow-sm" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-bold text-primary-800 dark:text-primary-100">{prayer.arabicName}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">{formatTime12h(prayer.time, timeZone)}</p>
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
                      {confirmed ? 'اضغط للتغيير' : 'اضغط للتأكيد'}
                    </span>
                  </span>
                )}
              </div>
            );

            const prayerCard = !answerable ? (
              <Card className="!p-5">{row}</Card>
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
                  confirmed
                    ? (confirmedAt[prayer.name] != null &&
                      Date.now() - confirmedAt[prayer.name]! < 10_000
                      ? 'مسجّلة، اضغط لعرض مهلة التعديل'
                      : 'مسجّلة، التعديل مقفول')
                    : 'لم تسجّل بعد، اضغط للتأكيد'
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
              <div className="space-y-3" key={prayer.name}>
                {prayerCard}
                {(attachedSunnahs.length > 0 || isAsr) && (
                  <div className="mr-4 space-y-2 border-r-2 border-primary-200 pr-4 dark:border-primary-800">
                    <p className="text-sm font-bold text-primary-700 dark:text-gold-400 mb-2">
                      سنن ونوافل مرتبطة بصلاة {prayer.arabicName}
                    </p>
                    {/* A sunnah belongs to its prayer's time: before the adhan there is
                        nothing to record yet, so the toggles stay shut with the reason
                        shown rather than silently swallowing a tap. */}
                    {!prayer.passed && (
                      <p className="flex items-start gap-1.5 rounded-xl bg-gray-50 dark:bg-primary-800/30 px-3 py-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        <Clock size={13} className="mt-0.5 shrink-0" />
                        مقفولة لحد ميعاد صلاة {prayer.arabicName} — تُسجَّل مع صلاتها لا قبلها.
                      </p>
                    )}
                    {isAsr && (
                      <div className="rounded-2xl bg-primary-50 dark:bg-primary-900/30 px-4 py-3 border border-primary-100 dark:border-primary-800">
                        <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                          لا تُدرج هنا راتبة مؤكدة مخصوصة للعصر؛ وتختلف النوافل قبله باختلاف المذاهب.
                        </p>
                      </div>
                    )}
                    {attachedSunnahs.map((sunnah) => {
                      const done = !!sunnahRecords[sunnah.key];
                      const locked = !prayer.passed;
                      return (
                        <button
                          key={sunnah.key}
                          type="button"
                          aria-pressed={done}
                          disabled={locked}
                          title={locked ? `تفتح بعد ميعاد صلاة ${prayer.arabicName}` : undefined}
                          onClick={() => void handleSunnahToggle(sunnah.key)}
                          className={`flex w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-right transition-all duration-300 disabled:cursor-not-allowed ${
                            done
                              ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300 border-2 border-success-200 dark:border-success-800 shadow-sm'
                              : locked
                                ? 'bg-gray-50/70 text-gray-500 dark:bg-primary-900/20 dark:text-gray-400 border-2 border-dashed border-gray-200 dark:border-gray-700'
                                : 'bg-white text-gray-700 dark:bg-primary-900/40 dark:text-gray-200 border-2 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600'
                          }`}
                        >
                          <span className="flex-1">
                            <span className="block text-sm font-bold">{sunnah.label}</span>
                            {sunnah.note && (
                              <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                {sunnah.note}
                              </span>
                            )}
                          </span>
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                            done
                              ? 'border-success-500 bg-success-500 shadow-md'
                              : locked
                                ? 'border-dashed border-gray-300 dark:border-gray-600'
                                : 'border-gray-300 dark:border-gray-600'
                          }`}>
                            {done ? (
                              <Check size={14} className="text-white" />
                            ) : locked ? (
                              <Clock size={12} className="text-gray-400 dark:text-gray-500" />
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Enhanced Qibla Direction */}
      <Card className="!p-5 flex items-center gap-5 hover:shadow-lg transition-shadow">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-gradient-to-br from-gold-100 to-gold-200 dark:from-gold-900/30 dark:to-gold-900/50 shadow-md">
          <Compass size={32} className="text-gold-600 dark:text-gold-400" />
          <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-gold-400 shadow-sm" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">اتجاه القبلة</p>
          <p className="text-2xl font-bold text-primary-800 dark:text-primary-100 mt-1">
            {Math.round(prayerResult.qiblaDirection)}° من الشمال
          </p>
        </div>
      </Card>

      {/* Enhanced Independent Voluntary Prayers */}
      <div>
        <SectionHeader title="نوافل مستقلة" icon={<Sun size={20} />} />
        <Card noPadding className="!p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SUNNAH_TYPES.filter((sunnah) => !sunnah.prayer).map((sunnah) => (
              <button
                key={sunnah.key}
                onClick={() => handleSunnahToggle(sunnah.key)}
                className={`flex items-center justify-between p-4 rounded-2xl transition-all duration-300 ${
                  sunnahRecords[sunnah.key]
                    ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300 border-2 border-success-200 dark:border-success-800 shadow-sm'
                    : 'bg-gray-50 dark:bg-gray-800/30 text-gray-600 dark:text-gray-300 border-2 border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-600'
                }`}
              >
                <span className="text-sm font-bold">{sunnah.label}</span>
                <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all ${
                  sunnahRecords[sunnah.key] ? 'border-success-500 bg-success-500 shadow-md' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {sunnahRecords[sunnah.key] && <Check size={14} className="text-white" />}
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Enhanced Weekly Grid */}
      {grid.length > 0 && (
        <div>
          <SectionHeader title="صلوات الأسبوع" icon={<BarChart3 size={20} />} />
          <Card className="!p-5">
            <PrayerWeekGrid
              grid={grid}
              onEdit={(date, prayer, _status, label) =>
                setSheet({ date, prayer, label, isHistorical: date !== todayKey() })
              }
            />
            <div className="mt-4 rounded-2xl bg-primary-50 dark:bg-primary-900/30 p-4 border border-primary-100 dark:border-primary-800">
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                يمكنك تسجيل اليوم أو أمس فقط؛ الأيام الأقدم للعرض. بعد كل تأكيد لديك ١٠ ثوانٍ للتراجع أو التصحيح.
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
          <Card className="!p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">نسبة الالتزام</p>
                <p className="text-4xl font-bold text-primary-700 dark:text-gold-400 mt-1">{stats.percentage}%</p>
              </div>
              <div className="h-20 w-20 rounded-full border-4 border-primary-200 dark:border-primary-800 flex items-center justify-center">
                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary-500 to-gold-400 flex items-center justify-center">
                  <span className="text-white font-bold text-lg">{stats.percentage}%</span>
                </div>
              </div>
            </div>
            <div className="w-full h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden shadow-inner">
              <div
                className="h-full bg-gradient-to-r from-primary-500 via-primary-600 to-gold-400 rounded-full transition-all duration-700 ease-out shadow-lg"
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
                  اضغط على أي خانة في الشبكة فوق تسجّلها.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Location picker modal */}
      {showLocation && <LocationPicker onPick={handleLocationPick} onAuto={handleAutoLocation} />}

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
            ).prayers.find((p) => p.name === sheet.prayer)!.time,
            timeZone,
          )}
          status={
            (grid.find((g) => g.date === sheet.date)?.status[sheet.prayer] ??
              records[sheet.prayer] ??
              null) as PrayerStatus | null
          }
          confirmedAt={
            grid.find((g) => g.date === sheet.date)?.confirmedAt[sheet.prayer] ??
            (sheet.date === todayKey() ? confirmedAt[sheet.prayer] : null)
          }
          editable={canEditPrayerDate(sheet.date)}
          isHistorical={sheet.isHistorical}
          dateLabel={sheet.label}
          sunnahs={grid.find((g) => g.date === sheet.date)?.sunnah[sheet.prayer]}
          onToggleSunnah={(type) => void handleSheetSunnahToggle(type)}
          onPick={handlePick}
          onClear={handleClear}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function LocationPicker({ onPick, onAuto }: { onPick: (lat: number, lng: number, name: string) => void; onAuto: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = CITY_PRESETS.filter((c) => c.name.includes(search) || !search);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={(e) => e.target === e.currentTarget && null}>
      <Card className="w-full max-w-md max-h-[80vh] flex flex-col animate-slide-up !p-0" noPadding>
        <div className="p-4 border-b border-primary-100 dark:border-primary-800">
          <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100 mb-3">اختر موقعك</h2>
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
  );
}
