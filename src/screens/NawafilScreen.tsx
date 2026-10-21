import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Moon,
  Sunrise,
  Sun,
  Sunset,
  Check,
  Clock,
  Sparkles,
  BookOpen,
  Star,
  ChevronDown,
  Droplets,
  Cloud,
  Home,
  Waves,
  Bed,
  Heart,
  Info,
  LayoutGrid,
  Repeat,
} from 'lucide-react';
import { Card, Badge, SectionHeader, EmptyState } from '@/components/ui';
import type { Settings } from '@/db/database';
import {
  formatDateKey,
  formatArabicDate,
  getHijriDate,
  getDayName,
  getDayNameShort,
  getLast7Days,
} from '@/utils/dateUtils';
import { calculatePrayerTimes, formatTime12h, getPrayerTimeZone } from '@/utils/prayerTimes';
import {
  getDaySunnahRecords,
  setSunnah,
  sunnahDoneMap,
  RAWATIB_BY_PRAYER,
  PRAYER_LABELS_AR,
  countDoneSunnahs,
  getSunnahRecordsForDates,
  nawafilStreak,
  nawafilOpportunity,
  type PrayerKey,
  type NawafilWindowTimes,
  type NawafilOpportunity,
} from '@/utils/prayerTracker';
import { toArabicNumber } from '@/data/surahs';

/**
 * Every voluntary prayer in one screen — the "professional" Nawafil page.
 *
 *  - A brand-gradient hero: Hijri + Gregorian date, a progress ring over the
 *    day's tally, and three live stats (today, perfect-day streak, week %).
 *  - A "النافلة المناسبة الآن" card driven by `nawafilOpportunity`: it reads
 *    the real timetable and names the نافلة whose window is open right now —
 *    قيام الليل in the night's last third, الوتر from Isha, الضحى from
 *    sunrise — or the next one coming, and celebrates a fully-answered day.
 *  - Filter chips per category with live counts, then the items themselves:
 *    one tap toggles, the virtue/time detail expands on demand.
 *
 * The rawatib still come from `RAWATIB_BY_PRAYER` — the same single definition
 * the prayer tracker, week grid and status sheet read — so a slot toggled here
 * and a slot toggled from the prayer confirmation sheet are the same record.
 * The remaining nawafil keep their own keys in the same `sunnahRecords` table,
 * which stores any string type, so no schema change is needed.
 */

type NawafilCategory = 'rawatib' | 'witr' | 'duha' | 'qiyam' | 'other';
type CategoryFilter = NawafilCategory | 'all';

interface NawafilItem {
  key: string;
  label: string;
  category: NawafilCategory;
  prayer?: PrayerKey;
  note?: string;
  description?: string;
  virtue?: string;
  time?: string;
  rakats?: string;
  icon?: typeof Sparkles;
}

interface NawafilScreenProps {
  /** Drives the hero's Hijri date and the opportunity card's timetable. */
  settings: Settings;
}

/** Per-prayer header for the rawatib cards (icon, gradient, blurb, virtue). */
const RAWATIB_HEADER: Partial<
  Record<PrayerKey, { icon: typeof Sunrise; gradient: string; virtue: string }>
> = {
  fajr: {
    icon: Sunrise,
    gradient: 'from-orange-400 to-amber-500',
    virtue: 'قال النبي ﷺ: «ركعتا الفجر خير من الدنيا وما فيها» — رواه الترمذي',
  },
  dhuhr: {
    icon: Sun,
    gradient: 'from-yellow-400 to-orange-500',
    virtue: 'من حافظ على الرواتب: «كان له بيت في الجنة» — رواه أحمد',
  },
  maghrib: {
    icon: Sunset,
    gradient: 'from-orange-500 to-red-500',
    virtue: 'من حافظ على الرواتب: «كان له بيت في الجنة» — رواه أحمد',
  },
  isha: {
    icon: Moon,
    gradient: 'from-indigo-500 to-purple-600',
    virtue: 'من حافظ على الرواتب: «كان له بيت في الجنة» — رواه أحمد',
  },
};

/** When and how many rak'ahs each rawatib slot is prayed. */
const RAWATIB_SLOT_INFO: Record<string, { time: string; rakats: string }> = {
  rawatib_fajr: { time: 'قبل أذان الفجر مباشرةً', rakats: 'ركعتان' },
  rawatib_dhuhr_before: { time: 'قبل أذان الظهر', rakats: 'أربع ركعات' },
  rawatib_dhuhr_after: { time: 'بعد صلاة الظهر مباشرةً', rakats: 'ركعتان' },
  rawatib_maghrib: { time: 'بعد صلاة المغرب مباشرةً', rakats: 'ركعتان' },
  rawatib_isha: { time: 'بعد صلاة العشاء مباشرةً', rakats: 'ركعتان' },
};

const NAWAFIL_ITEMS: NawafilItem[] = [
  // ---- السنن الرواتب: مبنية على التعريف الوحيد في prayerTracker ----
  ...Object.entries(RAWATIB_BY_PRAYER).flatMap(([prayer, slots]) =>
    slots.map((slot) => {
      const info = RAWATIB_SLOT_INFO[slot.type];
      return {
        key: slot.type,
        label: slot.label,
        category: 'rawatib' as const,
        prayer: prayer as PrayerKey,
        note: prayer === 'fajr' ? 'مؤكدة' : 'سنة راتبة',
        description:
          prayer === 'fajr'
            ? 'من أجمع السنن النبوية حفظًا وإتيانًا، وكان النبي ﷺ لا يدعهما رحلًا ولا مقيمًا.'
            : 'ركعتان متابعةً لسنة النبي ﷺ قبل الفريضة أو بعدها مباشرةً.',
        virtue: RAWATIB_HEADER[prayer as PrayerKey]?.virtue,
        time: info?.time,
        rakats: info?.rakats,
      };
    }),
  ),

  // ---- صلاة الوتر ----
  {
    key: 'witr',
    label: 'صلاة الوتر',
    category: 'witr',
    prayer: 'isha',
    note: 'سنة مؤكدة',
    description:
      'آخر صلاتك في الليل، تُصلّى بعد العشاء أو بعد قيام الليل وصلاة التراويح في رمضان.',
    virtue: 'قال النبي ﷺ: «إن الله وتر يحب الوتر، فأوتروا يا أهل القرآن» — رواه البخاري',
    time: 'بعد العشاء، ويُستحب أن يكون في آخر الليل عند من يثق باستيقاظه',
    rakats: 'ركعة واحدة، أو ٣، أو ٥، أو ٧، أو ٩، أو ١١',
    icon: Star,
  },

  // ---- صلاة الضحى ----
  {
    key: 'duha',
    label: 'صلاة الضحى',
    category: 'duha',
    note: 'نافلة شكر',
    description: 'تُصلّى بعد ارتفاع الشمس في الصباح، وهي صلاة المُصبحين.',
    virtue:
      'قال النبي ﷺ: «يُصبح على كل سلامى من أحدكم صدقة... فركعتا الضحى تُجزئان عن ذلك» — رواه مسلم',
    time: 'بعد شروق الشمس بربع ساعة تقريبًا، وحتى قبيل الظهر',
    rakats: 'ركعتان، أو ٤، أو ٦، أو ٨',
    icon: Sun,
  },

  // ---- قيام الليل ----
  {
    key: 'tahajjud',
    label: 'قيام الليل (التهجد)',
    category: 'qiyam',
    note: 'أفضل النوافل',
    description: 'صلاة في جوف الليل بين العشاء والفجر، بعد أن تنام قليلًا ثم تستيقظ.',
    virtue:
      '﴿وَمِنَ اللَّيْلِ فَتَهَجَّدْ بِهِ نَافِلَةً لَّكَ عَسَىٰ أَن يَبْعَثَكَ رَبُّكَ مَقَامًا مَّحْمُودًا﴾ — الإسراء: ٧٩',
    time: 'الثلث الأخير من الليل — خير الدور وأحبّها إلى الله',
    rakats: 'ركعتان ركعتان، ما شاء الله',
    icon: Bed,
  },
  {
    key: 'tarawih',
    label: 'صلاة التراويح',
    category: 'qiyam',
    note: 'في رمضان',
    description: 'تصلى جماعةً أو فرادى في ليالي رمضان بعد صلاة العشاء.',
    virtue: 'قال النبي ﷺ: «من قام رمضان إيمانًا واحتسابًا غُفر له ما تقدّم من ذنبه» — رواه البخاري',
    time: 'بعد العشاء مباشرةً في شهر رمضان',
    rakats: '٨، ١٠، ١٢، أو ٢٠ ركعة (والجمهور على ٢٠)',
    icon: BookOpen,
  },

  // ---- النوافل الأخرى ----
  {
    key: 'istikhara',
    label: 'صلاة الاستخارة',
    category: 'other',
    note: 'عند الحيرة',
    description: 'يطلب فيها العبد هداية الله في أمر يشك فيه أو يتردد فيه.',
    virtue:
      '«إذا همّ أحدكم بالأمر فليركع ركعتين من غير الفريضة، ثم ليقل: اللهم إني أستخيرك...» — متفق عليه',
    time: 'في أي وقت لا كراهية فيه',
    rakats: 'ركعتان',
    icon: Star,
  },
  {
    key: 'tawbah',
    label: 'صلاة التوبة',
    category: 'other',
    note: 'للتائب',
    description: 'يصليها ندمًا على الذنب ورجاءً لمغفرة الله، فيتوب بعدها توبة صادقة.',
    virtue:
      '«ما من عبد يُذنب ذنبًا فيتطهر ثم يُصلّي ثم يستغفر الله إلا غفر الله له» — رواه الترمذي',
    time: 'في أي وقت، على الفور بعد الذنب',
    rakats: 'ركعتان',
    icon: Heart,
  },
  {
    key: 'tahiyyatul_masjid',
    label: 'تحية المسجد',
    category: 'other',
    note: 'عند الدخول',
    description: 'يُستحب أن يصلي ركعتين قبل أن يجلس في المسجد.',
    virtue: '«إذا دخل أحدكم المسجد فلا يجلس حتى يصلي ركعتين» — متفق عليه',
    time: 'مباشرةً عند دخول المسجد',
    rakats: 'ركعتان',
    icon: Home,
  },
  {
    key: 'wudu_rakats',
    label: 'ركعتا الوضوء',
    category: 'other',
    note: 'بعد الوضوء',
    description: 'ركعتان خفيفتان يُصلّيهما العبد بعد إتمام وضوئه.',
    virtue:
      '«من توضّأ فأحسن الوضوء ثم صلى ركعتين لا يحدث فيهما نفسه غُفر له ما تقدّم من ذنبه» — رواه مسلم',
    time: 'بعد الوضوء مباشرةً',
    rakats: 'ركعتان',
    icon: Waves,
  },
  {
    key: 'istisqa',
    label: 'صلاة الاستسقاء',
    category: 'other',
    note: 'عند القحط',
    description: 'يخرج فيها المسلمون طالبين من الله الغيث والرحمة.',
    virtue: 'كان النبي ﷺ يخرج للاستسقاء متخشعًا متواضعًا، يحول رداءه ويصلي ركعتين',
    time: 'عند انحباس المطر وافتقار الناس إليه',
    rakats: 'ركعتان',
    icon: Droplets,
  },
  {
    key: 'kusuf',
    label: 'صلاة الكسوف والخسوف',
    category: 'other',
    note: 'سنة مؤكدة',
    description: 'تصلى عند كسوف الشمس أو خسوف القمر، فريضة أو سنة على خلاف بينهم.',
    virtue:
      '«إن الشمس والقمر آيتان من آيات الله لا ينكسفان لموت أحد ولا لحياته، فإذا رأيتموهما فصلّوا» — متفق عليه',
    time: 'أثناء الكسوف مباشرةً',
    rakats: 'ركعتان، في كل ركعة قراءة طويلة وركوعان',
    icon: Cloud,
  },
];

/** Every tracked key — the rawatib types plus each independent نافلة. */
const TRACKED_KEYS: readonly string[] = NAWAFIL_ITEMS.map((item) => item.key);
const TOTAL = NAWAFIL_ITEMS.length;

const CATEGORY_META: Record<
  NawafilCategory,
  { title: string; subtitle: string; icon: typeof Sparkles; tint: string }
> = {
  rawatib: {
    title: 'السنن الرواتب',
    subtitle: 'سنن ثابتة كان النبي ﷺ يحافظ عليها مع كل فريضة، أجرها عظيم وبها يُبنى البيت في الجنة',
    icon: Sun,
    tint: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  witr: {
    title: 'صلاة الوتر',
    subtitle: 'وتر الليل — تختم بها صلاتك في الليل، ويحبها الله عز وجل',
    icon: Moon,
    tint: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  duha: {
    title: 'صلاة الضحى',
    subtitle: 'نافلة أهل النهار، فيها شكر لنعم الله وتقبل لسوابغ فضله',
    icon: Sunrise,
    tint: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  },
  qiyam: {
    title: 'قيام الليل',
    subtitle: 'أحبّ الأعمال إلى الله أدومها وإن قل — لا تدعه ولو ركعتين',
    icon: Bed,
    tint: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
  other: {
    title: 'النوافل الأخرى',
    subtitle: 'نوافل في أوقات وحوادث مخصوصة، تُصلي عند الحاجة إليها بإذن الله',
    icon: Sparkles,
    tint: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  },
};

const CATEGORY_ORDER: NawafilCategory[] = ['rawatib', 'witr', 'duha', 'qiyam', 'other'];

/** The "الآن" card's content per open window, with its end time. */
const OPPORTUNITY_CONTENT: Record<
  Exclude<NawafilOpportunity, 'none'>,
  { icon: typeof Moon; title: string; desc: string; tile: string }
> = {
  qiyam: {
    icon: Moon,
    title: 'وقت قيام الليل',
    desc: 'الثلث الأخير من الليل — خير الدور وأحبّها إلى الله',
    tile: 'bg-violet-500/15 text-violet-300',
  },
  witr: {
    icon: Moon,
    title: 'وقت الوتر',
    desc: 'من أذان العشاء حتى أذان الفجر — ولا تدعه إذا نمت',
    tile: 'bg-indigo-500/15 text-indigo-300',
  },
  duha: {
    icon: Sunrise,
    title: 'وقت الضحى',
    desc: 'من الشروق حتى قبيل الظهر — صدقة على كل سلامى',
    tile: 'bg-orange-500/15 text-orange-300',
  },
};

export default function NawafilScreen({ settings }: NawafilScreenProps) {
  const [records, setRecords] = useState<Record<string, boolean>>({});
  const [weekCounts, setWeekCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // The live clock behind the opportunity card: it names the window open
  // right now, so it has to follow the wall clock — and rolling past midnight
  // turns the day key, which the reload below picks up within half a minute.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const day = formatDateKey(new Date(nowMs));

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const load = useCallback(async () => {
    try {
      const dates = getLast7Days();
      const [todayRows, weekRows] = await Promise.all([
        getDaySunnahRecords(day),
        getSunnahRecordsForDates(dates),
      ]);
      setRecords(sunnahDoneMap(todayRows));
      const counts: Record<string, number> = {};
      for (const date of dates) {
        counts[date] = countDoneSunnahs(weekRows.filter((row) => row.date === date), TRACKED_KEYS);
      }
      setWeekCounts(counts);
    } catch (error) {
      console.error('Failed to load nawafil records:', error);
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (type: string) => {
    const next = !records[type];
    // Optimistic first: the tick is instant, the write follows.
    setRecords((prev) => ({ ...prev, [type]: next }));
    // The week dots and the streak read `weekCounts`, not `records`, so today's
    // cell moves with the same tap — the week query only re-runs on a reload.
    setWeekCounts((prev) => ({
      ...prev,
      [day]: Math.max(0, (prev[day] ?? 0) + (next ? 1 : -1)),
    }));
    try {
      await setSunnah(day, type, next);
    } catch (error) {
      console.error('Failed to save nawafil record:', error);
      await load();
    }
  };

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // ---- Hero numbers ------------------------------------------------------
  const done = NAWAFIL_ITEMS.filter((item) => records[item.key]).length;
  const pct = TOTAL === 0 ? 0 : Math.round((done / TOTAL) * 100);
  const allDone = done === TOTAL;

  const weekStats = getLast7Days().map((date) => ({
    date,
    done: weekCounts[date] ?? 0,
    isToday: date === day,
  }));
  // Newest-first flags of "every tracked item was done that day" — the streak's input.
  const streak = nawafilStreak([...weekStats].reverse().map((s) => s.done === TOTAL));
  const perfectDays = weekStats.filter((s) => s.done === TOTAL).length;
  const weekPct = Math.round((weekStats.reduce((sum, s) => sum + s.done, 0) / (TOTAL * 7)) * 100);

  // ---- The opportunity card ----------------------------------------------
  const times = useMemo<NawafilWindowTimes | null>(() => {
    if (settings.latitude == null || settings.longitude == null) return null;
    try {
      // Local noon of `day`: the calendar day is all adhan reads, and noon
      // keeps that day stable under every time-zone offset.
      const result = calculatePrayerTimes(
        settings.latitude,
        settings.longitude,
        new Date(`${day}T12:00:00`),
        settings.calcMethod,
        settings.asrMadhab,
        getPrayerTimeZone(settings.timeZone, settings.cityName),
        settings.prayerTimeAdjustments,
      );
      const at = (name: string) => result.prayers.find((p) => p.name === name)?.time;
      const fajr = at('fajr');
      const sunrise = at('sunrise');
      const dhuhr = at('dhuhr');
      const maghrib = at('maghrib');
      const isha = at('isha');
      if (!fajr || !sunrise || !dhuhr || !maghrib || !isha) return null;
      return { fajr, sunrise, dhuhr, maghrib, isha };
    } catch {
      return null;
    }
  }, [
    settings.latitude,
    settings.longitude,
    settings.calcMethod,
    settings.asrMadhab,
    settings.timeZone,
    settings.cityName,
    settings.prayerTimeAdjustments,
    day,
  ]);

  const opportunity: NawafilOpportunity = times
    ? nawafilOpportunity(new Date(nowMs), times)
    : 'none';

  /** The next window that will open, for the "coming up" line. */
  const nextUp = useMemo(() => {
    if (!times) return null;
    const thirdStart = times.fajr.getTime() - (times.fajr.getTime() - times.maghrib.getTime()) / 3;
    const candidates = [
      { at: times.sunrise.getTime(), label: 'الضحى' },
      { at: times.isha.getTime(), label: 'الوتر' },
      { at: thirdStart, label: 'قيام الليل' },
      { at: times.fajr.getTime(), label: 'الوتر (حتى الفجر)' },
    ]
      .filter((candidate) => candidate.at > nowMs)
      .sort((a, b) => a.at - b.at);
    return candidates[0] ?? null;
  }, [times, nowMs]);

  const opportunityEnd = useMemo(() => {
    if (!times) return null;
    if (opportunity === 'qiyam' || opportunity === 'witr') return times.fajr;
    if (opportunity === 'duha') return times.dhuhr;
    return null;
  }, [times, opportunity]);

  const hijri = getHijriDate(new Date(nowMs), settings.hijriAdjustment ?? 0);

  const visibleCategories = CATEGORY_ORDER.filter(
    (category) => filter === 'all' || filter === category,
  );
  const categoryDone = (category: NawafilCategory) =>
    NAWAFIL_ITEMS.filter((item) => item.category === category && records[item.key]).length;

  return (
    <div className="space-y-5 pb-6">
      {/* ---- Hero: date, ring, stats, week dots ---- */}
      <section
        className="relative overflow-hidden rounded-3xl p-5 text-white shadow-lg"
        style={{ background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">النوافل</h1>
            <p className="mt-1 text-xs text-white/85">
              {getDayName(new Date(nowMs))} · {formatArabicDate(new Date(nowMs))}
              {hijri && <span> · {hijri}</span>}
            </p>
            <div className="mt-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-white/80">اليوم</span>
                <span className="font-bold">
                  {toArabicNumber(done)} / {toArabicNumber(TOTAL)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-white/80">السلسلة</span>
                <span className="font-bold">
                  {toArabicNumber(streak)} {streak === 1 ? 'يوم' : 'أيام'} متتالية
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-14 shrink-0 text-white/80">الأسبوع</span>
                <span className="font-bold">{toArabicNumber(weekPct)}٪</span>
              </div>
            </div>
          </div>

          {/* Progress ring */}
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.2" className="stroke-white/20" />
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                strokeWidth="3.2"
                strokeLinecap="round"
                strokeDasharray={`${pct} ${100 - pct}`}
                className="stroke-gold-300 transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold leading-none">{toArabicNumber(pct)}٪</span>
              <span className="mt-0.5 text-[9px] text-white/75">من نوافل اليوم</span>
            </div>
          </div>
        </div>

        {/* Week dots — the last seven days at a glance */}
        <div className="mt-4 rounded-2xl bg-white/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold text-primary-100">آخر {toArabicNumber(7)} أيام</p>
            <p className="text-[10px] text-primary-200">
              {toArabicNumber(perfectDays)} يوماً مكتملاً
            </p>
          </div>
          <div className="mt-2 flex items-center justify-between gap-1">
            {weekStats.map((stat) => {
              const [year, month, dayOfMonth] = stat.date.split('-').map(Number);
              const state =
                stat.done === TOTAL ? 'perfect' : stat.done > 0 ? 'partial' : 'empty';
              return (
                <div
                  key={stat.date}
                  title={`${getDayNameShort(new Date(year, month - 1, dayOfMonth).getDay())}: ${toArabicNumber(stat.done)} / ${toArabicNumber(TOTAL)}`}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-[9px] text-primary-200">
                    {getDayNameShort(new Date(year, month - 1, dayOfMonth).getDay())}
                  </span>
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-all ${
                      state === 'perfect'
                        ? 'bg-emerald-400 text-gray-950'
                        : stat.isToday
                          ? 'bg-white/15 text-white ring-2 ring-gold-300'
                          : state === 'partial'
                            ? 'bg-emerald-400/35 text-white'
                            : 'bg-white/10 text-primary-200'
                    }`}
                  >
                    {state === 'perfect' ? (
                      <Check size={13} strokeWidth={3} />
                    ) : (
                      toArabicNumber(stat.done)
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---- The نافلة whose window is open right now ---- */}
      {!loading && allDone ? (
        <Card className="border-gold-300/60 bg-gradient-to-br from-gold-50/70 to-amber-50/50 p-4! dark:border-[#cfa95c]/40 dark:from-[#cfa95c]/[0.08] dark:to-amber-900/10">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-400 to-amber-500 text-white shadow-md">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-50">
                أتممت نوافل اليوم كلها
              </p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
                يوم كامل بالنوافل والسنن — ما شاء الله، تقبّل الله منك
              </p>
            </div>
            <Badge variant="gold">مكتمل</Badge>
          </div>
        </Card>
      ) : opportunity !== 'none' && times ? (
        <Card className="overflow-hidden p-0!">
          <div className="flex items-center gap-3 bg-gradient-to-l from-primary-700 to-primary-900 p-4 text-white dark:from-primary-800 dark:to-gray-900">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                OPPORTUNITY_CONTENT[opportunity].tile
              }`}
            >
              {(() => {
                const Icon = OPPORTUNITY_CONTENT[opportunity].icon;
                return <Icon size={20} />;
              })()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-white/70">النافلة المناسبة الآن</p>
              <p className="text-sm font-bold">{OPPORTUNITY_CONTENT[opportunity].title}</p>
              <p className="mt-0.5 text-[11px] leading-5 text-white/80">
                {OPPORTUNITY_CONTENT[opportunity].desc}
              </p>
            </div>
            {opportunityEnd && (
              <div className="shrink-0 text-left">
                <p className="text-[9px] text-white/70">ينتهي</p>
                <p className="text-xs font-bold text-gold-300">
                  {formatTime12h(opportunityEnd)}
                </p>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-4!">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-600 dark:bg-primary-500/15 dark:text-primary-200">
              <Clock size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-50">نوافلك بانتظارك</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {nextUp
                  ? `النافلة القادمة: ${nextUp.label} — ${formatTime12h(new Date(nextUp.at))}`
                  : 'الرواتب مع كل صلاة، والضحى بعد الشروق، والوتر بعد العشاء'}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ---- Filter chips ---- */}
      {!loading && (
        <div role="group" aria-label="تصفية النوافل" className="flex flex-wrap items-center gap-2">
          <FilterChip
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            icon={<LayoutGrid size={14} />}
            label={`الكل (${toArabicNumber(done)}/${toArabicNumber(TOTAL)})`}
          />
          {CATEGORY_ORDER.map((category) => {
            const total = NAWAFIL_ITEMS.filter((item) => item.category === category).length;
            const categoryItemsDone = categoryDone(category);
            const Icon = CATEGORY_META[category].icon;
            return (
              <FilterChip
                key={category}
                active={filter === category}
                onClick={() => setFilter(category)}
                icon={<Icon size={14} />}
                label={`${CATEGORY_META[category].title} (${toArabicNumber(categoryItemsDone)}/${toArabicNumber(total)})`}
              />
            );
          })}
        </div>
      )}

      {/* ---- Items ---- */}
      {visibleCategories.map((category) => {
        const items = NAWAFIL_ITEMS.filter((item) => item.category === category);
        if (items.length === 0) return null;
        const meta = CATEGORY_META[category];
        const doneInCategory = categoryDone(category);

        return (
          <section key={category} className="space-y-3">
            <div>
              <SectionHeader
                title={meta.title}
                icon={<meta.icon size={20} />}
                action={
                  doneInCategory === items.length ? (
                    <Badge variant="success">
                      <Check size={12} /> أتممتها
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      {toArabicNumber(doneInCategory)} / {toArabicNumber(items.length)}
                    </Badge>
                  )
                }
              />
              <p className="-mt-1 mb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {meta.subtitle}
              </p>
            </div>

            {category === 'rawatib' ? (
              <RawatibCards items={items} records={records} onToggle={handleToggle} />
            ) : (
              <div className="space-y-2.5">
                {items.map((item) => {
                  const itemDone = !!records[item.key];
                  const isOpen = !!expanded[item.key];
                  const Icon = item.icon ?? Sparkles;
                  return (
                    <div
                      key={item.key}
                      className={`rounded-2xl border p-3.5 transition-all ${
                        itemDone
                          ? 'border-success-200 bg-success-50/40 dark:border-success-800 dark:bg-success-900/10'
                          : 'border-gray-200 bg-white dark:border-white/10 dark:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                            itemDone ? 'bg-gradient-to-br from-success-500 to-emerald-600 text-white shadow-md' : meta.tint
                          }`}
                        >
                          <Icon size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-50">
                              {item.label}
                            </h3>
                            {item.note && (
                              <Badge variant={itemDone ? 'success' : 'gold'}>{item.note}</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                            {item.rakats && (
                              <span className="inline-flex items-center gap-1">
                                <Repeat size={11} className="shrink-0" />
                                {item.rakats}
                              </span>
                            )}
                            {item.time && (
                              <span className="inline-flex items-center gap-1">
                                <Clock size={11} className="shrink-0" />
                                {item.time}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-pressed={itemDone}
                          aria-label={`تسجيل ${item.label}`}
                          onClick={() => void handleToggle(item.key)}
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all active:scale-95 ${
                            itemDone
                              ? 'border-success-500 bg-success-500 text-white shadow-md'
                              : 'border-gray-300 text-transparent hover:border-success-400 dark:border-gray-600'
                          }`}
                        >
                          <Check size={16} strokeWidth={3} />
                        </button>
                      </div>

                      {(item.description || item.virtue) && (
                        <div className="mt-2.5 border-t border-gray-100 pt-2.5 dark:border-white/10">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(item.key)}
                            className="inline-flex min-h-8 items-center gap-1.5 text-[11px] font-bold text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200"
                          >
                            <Info size={12} className="shrink-0" />
                            الفضيلة والوقت
                            <ChevronDown
                              size={13}
                              className={`shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {isOpen && (
                            <div className="mt-2 space-y-2">
                              {item.description && (
                                <p className="rounded-xl bg-primary-50/70 px-3 py-2 text-xs leading-6 text-gray-700 dark:bg-primary-900/30 dark:text-gray-300">
                                  {item.description}
                                </p>
                              )}
                              {item.virtue && (
                                <p className="flex items-start gap-1.5 rounded-xl bg-gold-50/60 px-3 py-2 text-xs leading-6 text-gray-700 dark:bg-[#cfa95c]/[0.07] dark:text-gray-300">
                                  <Star size={13} className="mt-1 shrink-0 text-gold-600 dark:text-gold-400" />
                                  <span>{item.virtue}</span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {loading && (
        <EmptyState
          icon={<Sparkles size={48} />}
          title="جارٍ تحميل النوافل..."
          description="لحظات ويظهر لك كل ما يحتاجه يومك"
        />
      )}

      {/* ---- Closing tip ---- */}
      {!loading && (
        <Card className="border-gold-300/60 bg-gradient-to-br from-gold-50/60 to-amber-50/40 p-4! dark:border-[#cfa95c]/40 dark:from-[#cfa95c]/[0.06] dark:to-amber-900/10">
          <div className="flex items-start gap-2.5">
            <Sparkles size={17} className="mt-0.5 shrink-0 text-gold-600 dark:text-[#cfa95c]" />
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              <span className="font-bold">نصيحة: </span>
              لا تُجهد نفسك، وداوم على ما تقدر عليه. الأحبّ إلى الله أدومُها وإن قل، والمقصود
              الدوام لا الكثرة.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

/** One filter chip — same visual language as the adhkar page's chips. */
function FilterChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-smooth ${
        active
          ? 'bg-primary-600 text-white shadow-sm'
          : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800/60 dark:text-primary-200 dark:hover:bg-primary-800'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The rawatib grouped under their own prayer: one card per فريضة, slots inside
 * it as toggles, with a header showing the prayer's icon and virtue.
 */
function RawatibCards({
  items,
  records,
  onToggle,
}: {
  items: NawafilItem[];
  records: Record<string, boolean>;
  onToggle: (type: string) => void;
}) {
  const prayers = Array.from(
    new Set(items.map((item) => item.prayer).filter((p): p is PrayerKey => !!p)),
  );

  return (
    <div className="space-y-3">
      {prayers.map((prayer) => {
        const slots = items.filter((item) => item.prayer === prayer);
        const header = RAWATIB_HEADER[prayer];
        const Icon = header?.icon ?? Sunrise;
        const doneCount = slots.filter((slot) => records[slot.key]).length;
        const allDone = doneCount === slots.length;

        return (
          <Card
            key={prayer}
            className={`overflow-hidden p-0! transition-all ${
              allDone
                ? 'border-2 border-success-200 bg-success-50/40 dark:border-success-800 dark:bg-success-900/10'
                : 'border-2'
            }`}
          >
            {/* Prayer header */}
            <div className="flex items-center gap-3 border-b border-primary-100/70 bg-primary-50/50 px-4 py-3 dark:border-primary-800/70 dark:bg-primary-900/20">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-md ${
                  header?.gradient ?? 'from-primary-500 to-gold-500'
                }`}
              >
                <Icon size={20} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-bold text-primary-900 dark:text-primary-50">
                  سنن راتبة {PRAYER_LABELS_AR[prayer]}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {doneCount === slots.length
                    ? 'أتممتها اليوم — بارك الله فيك'
                    : `${toArabicNumber(slots.length - doneCount)} ركعات متبقية اليوم`}
                </p>
              </div>
              {allDone && (
                <Badge variant="success">
                  <Check size={12} /> مكتملة
                </Badge>
              )}
            </div>

            {/* Slots */}
            <div className="space-y-2.5 p-3.5">
              {slots.map((slot) => {
                const slotDone = !!records[slot.key];
                return (
                  <button
                    key={slot.key}
                    type="button"
                    aria-pressed={slotDone}
                    onClick={() => void onToggle(slot.key)}
                    className={`flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-right transition-all active:scale-[0.99] ${
                      slotDone
                        ? 'border-2 border-success-200 bg-success-50 dark:border-success-800 dark:bg-success-900/20'
                        : 'border-2 border-gray-200 bg-white hover:border-primary-300 dark:border-gray-700 dark:bg-primary-900/40 dark:hover:border-primary-600'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-gray-900 dark:text-gray-50">
                          {slot.label}
                        </span>
                        {slot.rakats && <Badge variant="neutral">{slot.rakats}</Badge>}
                        {slot.note && (
                          <Badge variant={slotDone ? 'success' : 'gold'}>{slot.note}</Badge>
                        )}
                      </span>
                      {slot.time && (
                        <span className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                          <Clock size={12} className="shrink-0" />
                          {slot.time}
                        </span>
                      )}
                    </span>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                        slotDone
                          ? 'border-success-500 bg-success-500 shadow-md'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    >
                      {slotDone && <Check size={14} className="text-white" />}
                    </span>
                  </button>
                );
              })}

              {header?.virtue && (
                <p className="rounded-xl bg-primary-50/70 px-3 py-2 text-xs leading-relaxed text-gray-600 dark:bg-primary-900/40 dark:text-gray-300">
                  {header.virtue}
                </p>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
