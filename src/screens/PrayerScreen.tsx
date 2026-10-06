import { useState, useEffect, useCallback } from 'react';
import { Moon, Sunrise, MapPin, Compass, BarChart3, Sun, Sunset, Check, X, Clock } from 'lucide-react';
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

const SUNNAH_TYPES: {
  key: string;
  label: string;
  prayer?: PrayerKey;
  note?: string;
}[] = [
  { key: 'rawatib_fajr', prayer: 'fajr', label: 'ركعتان قبل الفجر', note: 'من السنن الرواتب المؤكدة' },
  { key: 'rawatib_dhuhr_before', prayer: 'dhuhr', label: 'أربع ركعات قبل الظهر', note: 'سنة راتبة' },
  { key: 'rawatib_dhuhr_after', prayer: 'dhuhr', label: 'ركعتان بعد الظهر', note: 'سنة راتبة' },
  { key: 'rawatib_maghrib', prayer: 'maghrib', label: 'ركعتان بعد المغرب', note: 'سنة راتبة' },
  { key: 'rawatib_isha', prayer: 'isha', label: 'ركعتان بعد العشاء', note: 'سنة راتبة' },
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

    const sunnahRows = await getDaySunnahRecords(todayKey());
    const sunnahMap: Record<string, boolean> = Object.fromEntries(
      sunnahRows.map((row) => [row.type, row.done]),
    );
    // Preserve the older combined Dhuhr checkbox until the user records each rak'ah group.
    if (sunnahMap.rawatib_dhuhr !== undefined) {
      sunnahMap.rawatib_dhuhr_before ??= sunnahMap.rawatib_dhuhr;
      sunnahMap.rawatib_dhuhr_after ??= sunnahMap.rawatib_dhuhr;
    }
    setSunnahRecords(sunnahMap);

    // The grid doubles as the weekly stats source, so the two can never disagree.
    const g = await getPrayerGrid(location);
    setGrid(g);
    setStats(summariseGrid(g));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.latitude, settings.longitude, settings.calcMethod, settings.asrMadhab, settings.timeZone, settings.cityName]);

  useEffect(() => {
    load();
    const interval = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(interval);
  }, [load]);

  const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const prayerResult = settings.latitude != null && settings.longitude != null
    ? calculatePrayerTimes(settings.latitude, settings.longitude, today, settings.calcMethod, settings.asrMadhab, timeZone)
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
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">مواقيت الصلاة</h1>
        <button onClick={() => setShowLocation(true)} className="flex items-center gap-1 text-sm text-primary-600 dark:text-gold-400">
          <MapPin size={16} /> {settings.cityName || 'الموقع'}
        </button>
      </div>

      {/* Date */}
      <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
        {formatArabicDate(today)} — {getHijriDate(today)}
      </p>

      {/* Next prayer highlight */}
      {nextPrayer && (
        <div className="bg-gradient-to-bl from-primary-700 to-primary-900 dark:from-primary-800 dark:to-primary-950 rounded-3xl p-5 text-white relative overflow-hidden">
          <div className="absolute top-0 left-0 w-32 h-32 bg-gold-400/10 rounded-full -translate-x-16 -translate-y-16" />
          <div className="relative flex items-center justify-between">
            <div>
              <p className="text-gold-300 text-sm">الصلاة القادمة</p>
              <h2 className="text-3xl font-bold mt-1">{nextPrayer.arabicName}</h2>
              <p className="text-primary-200 text-sm mt-1">{getTimeUntil(nextPrayer.time, now)}</p>
            </div>
            <div className="text-left">
              <p className="text-3xl font-bold text-gold-300">{formatTime12h(nextPrayer.time, timeZone)}</p>
            </div>
          </div>
        </div>
      )}

      {/* All prayer times with confirmation */}
      <div>
        <SectionHeader title="صلوات اليوم" icon={<Moon size={20} />} />
        <p className="mb-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
          تظهر السنة الراتبة بجوار فرضها: ركعتان قبل الفجر، وست للظهر (أربع قبلًا واثنتان بعدًا)، وركعتان بعد المغرب وركعتان بعد العشاء.
        </p>
        <div className="space-y-3">
          {prayerResult.prayers.map((prayer) => {
            const isSunrise = prayer.name === 'sunrise';
            const Icon = PRAYER_ICONS[prayer.name] || Moon;
            const confirmed = (records[prayer.name] as PrayerStatus | null | undefined) ?? null;
            // Sunrise is not a prayer, and an upcoming prayer has nothing to confirm yet.
            const answerable = !isSunrise && prayer.passed;
            const attachedSunnahs = SUNNAH_TYPES.filter((sunnah) => sunnah.prayer === prayer.name);
            const isAsr = prayer.name === 'asr';

            const row = (
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${prayer.passed ? 'bg-primary-100 dark:bg-primary-800' : 'bg-gray-50 dark:bg-gray-800/50'}`}>
                  <Icon size={20} className={prayer.passed ? 'text-primary-600 dark:text-gold-400' : 'text-gray-400'} />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-primary-800 dark:text-primary-100">{prayer.arabicName}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{formatTime12h(prayer.time, timeZone)}</p>
                </div>
                {isSunrise ? (
                  <Badge variant="gold"><Sun size={10} /> شروق</Badge>
                ) : !prayer.passed ? (
                  <Badge variant="neutral">{getTimeUntil(prayer.time, now)}</Badge>
                ) : (
                  <span className="flex flex-col items-end gap-0.5">
                    {confirmed === 'ontime' && <Badge variant="success"><Check size={10} /> في وقتها</Badge>}
                    {confirmed === 'late' && <Badge variant="warning"><Clock size={10} /> قضاء</Badge>}
                    {confirmed === 'missed' && <Badge variant="error"><X size={10} /> لم صلَّ</Badge>}
                    {!confirmed && <Badge variant="neutral">لم تسجّلها</Badge>}
                    {/* The whole row is the affordance, so there is nothing to miss. */}
                    <span className="text-[11px] text-primary-600 dark:text-gold-400">
                      {confirmed ? 'اضغط للتغيير أو التراجع' : 'اضغط للتأكيد'}
                    </span>
                  </span>
                )}
              </div>
            );

            const prayerCard = !answerable ? (
              <Card>{row}</Card>
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
                className={`block w-full text-right p-4 rounded-2xl border-r-4 transition-smooth active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 ${
                  confirmed
                    ? 'border-r-primary-500 bg-white dark:bg-primary-900/40 hover:bg-primary-50 dark:hover:bg-primary-800/40'
                    : 'border-r-gray-200 dark:border-r-gray-700 bg-white dark:bg-primary-900/40 hover:border-r-primary-400 dark:hover:border-r-primary-600'
                }`}
              >
                {row}
              </button>
            );

            return (
              <div className="space-y-2" key={prayer.name}>
                {prayerCard}
                {(attachedSunnahs.length > 0 || isAsr) && (
                  <div className="mr-3 space-y-1 border-r-2 border-primary-100 pr-3 dark:border-primary-800">
                    <p className="text-xs font-semibold text-primary-600 dark:text-gold-400">
                      سنن ونوافل مرتبطة بصلاة {prayer.arabicName}
                    </p>
                    {isAsr && (
                      <p className="rounded-xl bg-white px-3 py-2 text-xs leading-5 text-gray-500 dark:bg-primary-900/40 dark:text-gray-400">
                        لا تُدرج هنا راتبة مؤكدة مخصوصة للعصر؛ وتختلف النوافل قبله باختلاف المذاهب.
                      </p>
                    )}
                    {attachedSunnahs.map((sunnah) => (
                      <button
                        key={sunnah.key}
                        type="button"
                        aria-pressed={!!sunnahRecords[sunnah.key]}
                        onClick={() => void handleSunnahToggle(sunnah.key)}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-right transition-smooth ${
                          sunnahRecords[sunnah.key]
                            ? 'bg-success-50 text-success-700 dark:bg-success-900/20 dark:text-success-300'
                            : 'bg-white text-gray-700 dark:bg-primary-900/40 dark:text-gray-200'
                        }`}
                      >
                        <span>
                          <span className="block text-sm font-medium">{sunnah.label}</span>
                          {sunnah.note && (
                            <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                              {sunnah.note}
                            </span>
                          )}
                        </span>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                          sunnahRecords[sunnah.key]
                            ? 'border-success-500 bg-success-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}>
                          {sunnahRecords[sunnah.key] && <Check size={12} className="text-white" />}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Qibla direction */}
      <Card className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center">
          <Compass size={28} className="text-gold-600 dark:text-gold-400" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">اتجاه القبلة</p>
          <p className="text-xl font-bold text-primary-800 dark:text-primary-100">
            {Math.round(prayerResult.qiblaDirection)}° من الشمال
          </p>
        </div>
      </Card>

      {/* Independent voluntary prayers */}
      <div>
        <SectionHeader title="نوافل مستقلة" icon={<Sun size={20} />} />
        <Card noPadding>
          <div className="p-3 grid grid-cols-2 gap-2">
            {SUNNAH_TYPES.filter((sunnah) => !sunnah.prayer).map((sunnah) => (
              <button
                key={sunnah.key}
                onClick={() => handleSunnahToggle(sunnah.key)}
                className={`flex items-center justify-between p-2.5 rounded-xl transition-smooth ${
                  sunnahRecords[sunnah.key]
                    ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-300'
                    : 'bg-gray-50 dark:bg-gray-800/30 text-gray-600 dark:text-gray-300'
                }`}
              >
                <span className="text-sm font-medium">{sunnah.label}</span>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  sunnahRecords[sunnah.key] ? 'border-success-500 bg-success-500' : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {sunnahRecords[sunnah.key] && <Check size={12} className="text-white" />}
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Weekly grid: which prayer, on which day. Tappable, so history can be corrected. */}
      {grid.length > 0 && (
        <div>
          <SectionHeader title="صلوات الأسبوع" icon={<BarChart3 size={20} />} />
          <Card>
            <PrayerWeekGrid
              grid={grid}
              onEdit={(date, prayer, _status, label) =>
                setSheet({ date, prayer, label, isHistorical: date !== todayKey() })
              }
            />
            <p className="mt-3 text-xs leading-5 text-gray-500 dark:text-gray-400">
              يمكنك تسجيل اليوم أو أمس فقط؛ الأيام الأقدم للعرض. بعد كل تأكيد لديك ١٠ ثوانٍ للتراجع أو التصحيح.
            </p>
          </Card>
        </div>
      )}

      {/* Weekly stats */}
      {stats && (
        <div>
          <SectionHeader title="ملخص الأسبوع" icon={<BarChart3 size={20} />} />
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">نسبة الالتزام</p>
              <p className="text-2xl font-bold text-primary-700 dark:text-gold-400">{stats.percentage}%</p>
            </div>
            <div className="w-full h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-l from-primary-500 to-gold-400 rounded-full transition-all duration-500"
                style={{ width: `${stats.percentage}%` }}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-3">
              <div className="text-center">
                <p className="text-lg font-bold text-success-600">{stats.ontime}</p>
                <p className="text-xs text-gray-500">في وقتها</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-warning-600">{stats.late}</p>
                <p className="text-xs text-gray-500">قضاء</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-error-600">{stats.missed}</p>
                <p className="text-xs text-gray-500">فائتة</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-gray-400">{stats.unconfirmed}</p>
                <p className="text-xs text-gray-500">لم تسجّلها</p>
              </div>
            </div>
            {stats.unconfirmed > 0 && (
              <p className="mt-3 pt-3 border-t border-primary-100 dark:border-primary-800/50 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                «لم تسجّلها» يعني إن الوقت عدّى والتسجيل مش موجود — مش إنك ما صليتهاش.
                اضغط على أي خانة في الشبكة فوق تسجّلها.
              </p>
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
