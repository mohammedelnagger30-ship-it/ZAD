import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  CheckCircle,
  ChevronLeft,
  CircleDashed,
  Copy,
  BookOpen,
  Droplets,
  Flower2,
  Heart,
  HeartHandshake,
  Home,
  Landmark,
  LayoutGrid,
  Minus,
  Moon,
  Plane,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Utensils,
  Vibrate,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui';
import { toArabicNumber } from '@/data/surahs';
import { ADHKAR_CATEGORIES, type AdhkarCategory, type Dhikr } from '@/data/adhkar';
import { todayKey, getDayNameShort, getLast7Days } from '@/utils/dateUtils';
import { trustedNow } from '@/utils/clock';
import { normalizeArabic } from '@/utils/arabic';
import { normalizeCompletedDays, recordCompletedDay } from '@/utils/adhkarDays';

const STORAGE_KEY = 'hifzi-adhkar-state';
const SYNC_COMPLETE_EVENT = 'zad:cloud-sync-complete';

const ICONS: Record<string, typeof Sunrise> = {
  sunrise: Sunrise,
  sunset: Sunset,
  'check-circle': CheckCircle,
  moon: Moon,
  sun: Sun,
  'book-open': BookOpen,
  droplets: Droplets,
  landmark: Landmark,
  utensils: Utensils,
  home: Home,
  plane: Plane,
  'heart-handshake': HeartHandshake,
  'flower-2': Flower2,
  sparkles: Sparkles,
};

/**
 * One visual identity per collection: the tile gradient on its card, the bar
 * that fills under its title, the ring around its counter, and the hero it
 * gets on its own page. Written out here rather than derived from the id so
 * every step stays a plain class Tailwind can see in this file — a computed
 * `bg-${color}-500` would be dropped from the build and the whole identity
 * would silently vanish in production.
 */
interface CategoryStyle {
  /** Tinted pill for the hadith reference and small badges. */
  chip: string;
  /** Gradient for the icon tile and the accent line over the card. */
  icon: string;
  /** Solid fill for progress bars and the hero's meter. */
  bar: string;
  /**
   * The same colour as a stroke, for the SVG ring around a counter. An SVG
   * circle is painted by `stroke`, not by `background`, so `bar` on a ring
   * draws nothing at all — the two are written out separately rather than
   * derived, since both spellings have to appear literally in this file for
   * Tailwind to keep them.
   */
  ring: string;
  /** Gradient for the collection's own header card. */
  hero: string;
}

const DEFAULT_CATEGORY_STYLE: CategoryStyle = {
  chip: 'bg-primary-100 text-primary-800 dark:bg-primary-800 dark:text-primary-200',
  icon: 'from-primary-400 to-primary-600',
  bar: 'bg-primary-500',
  ring: 'stroke-primary-500',
  hero: 'from-primary-600 to-primary-950',
};

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  morning: {
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    icon: 'from-amber-400 to-orange-500',
    bar: 'bg-amber-500',
    ring: 'stroke-amber-500',
    hero: 'from-amber-600 to-orange-800',
  },
  evening: {
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
    icon: 'from-violet-500 to-indigo-700',
    bar: 'bg-violet-500',
    ring: 'stroke-violet-500',
    hero: 'from-violet-600 to-indigo-800',
  },
  after_prayer: {
    chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    icon: 'from-emerald-500 to-teal-700',
    bar: 'bg-emerald-500',
    ring: 'stroke-emerald-500',
    hero: 'from-emerald-600 to-teal-800',
  },
  sleep: {
    chip: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
    icon: 'from-blue-500 to-blue-800',
    bar: 'bg-blue-500',
    ring: 'stroke-blue-500',
    hero: 'from-blue-600 to-blue-900',
  },
  wakeup: {
    chip: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
    icon: 'from-rose-500 to-pink-700',
    bar: 'bg-rose-500',
    ring: 'stroke-rose-500',
    hero: 'from-rose-600 to-pink-800',
  },
  general_adhkar: {
    chip: 'bg-gold-100 text-gold-800 dark:bg-gold-950/60 dark:text-gold-300',
    icon: 'from-gold-400 to-gold-600',
    bar: 'bg-gold-500',
    ring: 'stroke-gold-500',
    hero: 'from-gold-500 to-amber-700',
  },
  wudu: {
    chip: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300',
    icon: 'from-cyan-500 to-sky-700',
    bar: 'bg-cyan-500',
    ring: 'stroke-cyan-500',
    hero: 'from-cyan-600 to-sky-800',
  },
  mosque: {
    chip: 'bg-primary-100 text-primary-800 dark:bg-primary-800 dark:text-primary-200',
    icon: 'from-primary-500 to-primary-800',
    bar: 'bg-primary-500',
    ring: 'stroke-primary-500',
    hero: 'from-primary-600 to-primary-950',
  },
  food: {
    chip: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300',
    icon: 'from-orange-500 to-amber-700',
    bar: 'bg-orange-500',
    ring: 'stroke-orange-500',
    hero: 'from-orange-600 to-amber-800',
  },
  home: {
    chip: 'bg-lime-100 text-lime-800 dark:bg-lime-950/60 dark:text-lime-300',
    icon: 'from-lime-500 to-emerald-700',
    bar: 'bg-lime-500',
    ring: 'stroke-lime-500',
    hero: 'from-lime-600 to-emerald-800',
  },
  travel: {
    chip: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
    icon: 'from-sky-500 to-indigo-600',
    bar: 'bg-sky-500',
    ring: 'stroke-sky-500',
    hero: 'from-sky-600 to-indigo-800',
  },
  deceased: {
    chip: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
    icon: 'from-slate-500 to-slate-700',
    bar: 'bg-slate-500',
    ring: 'stroke-slate-500',
    hero: 'from-slate-600 to-slate-800',
  },
  general_duas: {
    chip: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300',
    icon: 'from-purple-500 to-fuchsia-600',
    bar: 'bg-purple-500',
    ring: 'stroke-purple-500',
    hero: 'from-purple-600 to-fuchsia-800',
  },
  quranic_duas: {
    chip: 'bg-gold-100 text-gold-800 dark:bg-gold-950/60 dark:text-gold-300',
    icon: 'from-gold-500 to-primary-700',
    bar: 'bg-gold-500',
    ring: 'stroke-gold-500',
    hero: 'from-gold-600 to-primary-950',
  },
};

const styleOf = (categoryId: string): CategoryStyle =>
  CATEGORY_STYLES[categoryId] ?? DEFAULT_CATEGORY_STYLE;

/** The three chips under the search box. */
const FILTERS = [
  { id: 'all', label: 'الكل', icon: LayoutGrid },
  { id: 'incomplete', label: 'غير المكتمل', icon: CircleDashed },
  { id: 'favorites', label: 'المفضلة', icon: Heart },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

interface AdhkarState {
  day: string;
  counts: Record<string, number>;
  favorites: string[];
  fontSize: number;
  haptics: boolean;
  /**
   * Every day the daily adhkar was carried all the way through, newest last.
   *
   * `counts` is wiped whenever the date rolls over, so on its own it can
   * only ever answer "did I finish *today*" — and the day it is finished is
   * the one day it stops keeping. This list is what turns a year of
   * scattered afternoons into a number: «أتممت أذكار ١٠ أيام» cannot be
   * counted from a counter that forgets.
   */
  completedDays: string[];
}

const DEFAULT_STATE: AdhkarState = {
  day: todayKey(),
  counts: {},
  favorites: [],
  fontSize: 22,
  haptics: false,
  completedDays: [],
};

function loadState(): { state: AdhkarState; error: string | null } {
  try {
    if (typeof localStorage === 'undefined') return { state: DEFAULT_STATE, error: null };
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: DEFAULT_STATE, error: null };
    const stored = JSON.parse(raw) as Partial<AdhkarState>;
    const currentDay = todayKey();
    const counts = stored.day === currentDay && stored.counts && typeof stored.counts === 'object'
      ? Object.fromEntries(
          Object.entries(stored.counts)
            .filter(([id, value]) =>
              ADHKAR_CATEGORIES.some((category) => category.items.some((item) => item.id === id)) &&
              typeof value === 'number' &&
              Number.isFinite(value),
            )
            .map(([id, value]) => {
              const item = ADHKAR_CATEGORIES.flatMap((category) => category.items).find((dhikr) => dhikr.id === id);
              return [id, Math.min(Math.max(Math.floor(value), 0), item?.count ?? 0)];
            }),
        )
      : {};
    return {
      state: {
        day: currentDay,
        counts,
        favorites: Array.isArray(stored.favorites)
          ? stored.favorites.filter((id): id is string =>
              typeof id === 'string' &&
              ADHKAR_CATEGORIES.some((category) => category.items.some((item) => item.id === id)),
            )
          : [],
        fontSize: typeof stored.fontSize === 'number' ? Math.min(Math.max(stored.fontSize, 18), 32) : 22,
        haptics: stored.haptics === true,
        // What is on disk may have come from a backup, from another device,
        // or from a version of the app that kept no list at all.
        completedDays: normalizeCompletedDays(stored.completedDays),
      },
      error: null,
    };
  } catch {
    return { state: DEFAULT_STATE, error: 'تعذّر قراءة تقدم الأذكار المحفوظ على هذا الجهاز.' };
  }
}

function vibrate(enabled: boolean, completed: boolean) {
  if (!enabled || typeof navigator === 'undefined') return;
  try {
    navigator.vibrate?.(completed ? 100 : 20);
  } catch (error) {
    console.warn('تعذّر تشغيل الاهتزاز لهذا الجهاز.', error);
  }
}

/** The line the hero opens with — chosen from the device's trusted clock. */
function getGreeting(hour: number): string {
  if (hour >= 4 && hour < 12) return 'صباح الخير وبركة';
  if (hour >= 12 && hour < 16) return 'نهارك مبارك';
  if (hour >= 16 && hour < 20) return 'مساء الخير';
  return 'ليلة طيبة';
}

/**
 * A circular progress meter. The stroke grows clockwise from twelve o'clock
 * (the SVG is rotated a quarter turn) and `children` sit in its middle, so
 * the hero, the collection header and every counter card share one meter at
 * three different sizes instead of three hand-rolled circles.
 */
function ProgressRing({
  progress,
  size = 48,
  stroke = 4,
  trackClass,
  fillClass,
  className = '',
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  trackClass: string;
  fillClass: string;
  className?: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className={trackClass} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={`transition-all duration-500 ${fillClass}`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** The three filter chips, on the home page and inside a collection alike. */
function FilterChips({
  filter,
  favoritesCount,
  onChange,
}: {
  filter: FilterId;
  favoritesCount: number;
  onChange: (id: FilterId) => void;
}) {
  return (
    <div role="group" aria-label="تصفية الأذكار" className="flex flex-wrap items-center gap-2">
      {FILTERS.map(({ id, label, icon: Icon }) => {
        const active = filter === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={active}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-smooth ${
              active
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-primary-100 text-primary-800 hover:bg-primary-100 dark:bg-primary-800/60 dark:text-primary-200 dark:hover:bg-primary-800'
            }`}
          >
            <Icon size={14} className={active && id === 'favorites' ? 'fill-white' : ''} />
            {id === 'favorites' ? `المفضلة (${toArabicNumber(favoritesCount)})` : label}
          </button>
        );
      })}
    </div>
  );
}

interface AdhkarScreenProps {
  /** Deep links: a search result sends `{ categoryId }` to open that category directly. */
  params?: Record<string, unknown>;
}

export function AdhkarScreen({ params }: AdhkarScreenProps = {}) {
  // Read once, on mount: a deep link must land on the category, and re-reading
  // it later would throw the reader back out of the category they opened.
  const [activeCategory, setActiveCategory] = useState<string | null>(() =>
    typeof params?.categoryId === 'string' ? params.categoryId : null,
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterId>('all');
  // The old boolean view of the same idea, kept as a derived value so every
  // predicate below reads the way it always has.
  const favoritesOnly = filter === 'favorites';
  const [initialState] = useState(loadState);
  const [state, setState] = useState<AdhkarState>(initialState.state);
  const [storageError, setStorageError] = useState<string | null>(initialState.error);
  const [notice, setNotice] = useState<string | null>(null);

  // Nothing is written on mount. Opening the screen used to persist the state
  // it had just read and fire `zad:adhkar-updated` along with it — and that
  // event starts a sync round — so merely visiting a category pushed a round
  // and stamped a new `modified_at` on data that had not changed. The guard
  // compares object identity: `state` is only ever replaced by an edit, so the
  // first run (the read) and every unchanged re-render fall through.
  const lastPersistedRef = useRef(state);
  useEffect(() => {
    if (lastPersistedRef.current === state) return;
    lastPersistedRef.current = state;
    const persist = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          ...state,
          syncModifiedAt: Date.now(),
        }));
        window.dispatchEvent(new Event('zad:adhkar-updated'));
        setStorageError(null);
      } catch {
        setStorageError('تعذّر حفظ التقدم. تحقق من مساحة التخزين المتاحة في المتصفح.');
      }
    };
    persist();
  }, [state]);

  useEffect(() => {
    const reloadSyncedState = () => {
      const next = loadState();
      setState(next.state);
      setStorageError(next.error);
    };
    window.addEventListener(SYNC_COMPLETE_EVENT, reloadSyncedState);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, reloadSyncedState);
  }, []);

  useEffect(() => {
    const checkDay = () => {
      const day = todayKey();
      setState((previous) => previous.day === day ? previous : { ...previous, day, counts: {} });
    };
    const timer = window.setInterval(checkDay, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 1800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const allItems = useMemo(
    () => ADHKAR_CATEGORIES.filter((category) => category.daily !== false).flatMap((category) => category.items),
    [],
  );
  const completedItems = allItems.filter((item) => (state.counts[item.id] ?? 0) >= item.count).length;
  const overallProgress = allItems.length ? completedItems / allItems.length : 0;
  const active = ADHKAR_CATEGORIES.find((category) => category.id === activeCategory) ?? null;
  const normalizedQuery = normalizeArabic(query);
  const activeItems = active?.items.filter((dhikr) => {
    const matchesQuery = normalizeArabic(`${dhikr.text} ${dhikr.reference} ${dhikr.virtue ?? ''} ${dhikr.note ?? ''}`)
      .includes(normalizedQuery);
    if (!matchesQuery) return false;
    if (favoritesOnly && !state.favorites.includes(dhikr.id)) return false;
    if (filter === 'incomplete' && (state.counts[dhikr.id] ?? 0) >= dhikr.count) return false;
    return true;
  }) ?? [];

  const visibleCategories = useMemo(() => {
    const search = normalizeArabic(query);
    return ADHKAR_CATEGORIES.map((category) => ({
      category,
      items: category.items.filter((item) => {
        if (favoritesOnly && !state.favorites.includes(item.id)) return false;
        if (filter === 'incomplete' && (state.counts[item.id] ?? 0) >= item.count) return false;
        if (!search) return true;
        return normalizeArabic(`${item.text} ${item.reference} ${item.virtue ?? ''} ${item.note ?? ''}`).includes(search);
      }),
    })).filter(({ items }) => items.length > 0);
  }, [query, filter, favoritesOnly, state.favorites, state.counts]);

  /**
   * Files the day away the moment the last daily dhikr is counted.
   *
   * It watches `overallProgress` rather than a save action because there is
   * no save action — the day either happened or it did not. Returning the
   * previous state untouched when the date is already in the list is what
   * keeps this from looping: the bar sits at 100% across many renders, and
   * the effect runs again on each of them.
   */
  useEffect(() => {
    if (overallProgress < 1) return;
    setState((previous) => {
      const completedDays = recordCompletedDay(previous.completedDays, previous.day);
      // The same array back means the day was already filed, so the state
      // itself is left untouched — and an unchanged state is what stops this
      // from running again on the re-render it would otherwise cause.
      return completedDays === previous.completedDays
        ? previous
        : { ...previous, completedDays };
    });
  }, [overallProgress]);

  const updateCount = useCallback((dhikr: Dhikr, delta: number) => {
    const current = state.counts[dhikr.id] ?? 0;
    const next = Math.min(Math.max(current + delta, 0), dhikr.count);
    vibrate(state.haptics, delta > 0 && next === dhikr.count && current < dhikr.count);
    setState((previous) => {
      const count = previous.counts[dhikr.id] ?? 0;
      return {
        ...previous,
        counts: { ...previous.counts, [dhikr.id]: Math.min(Math.max(count + delta, 0), dhikr.count) },
      };
    });
  }, [state.counts, state.haptics]);

  const resetDhikr = (id: string) => {
    setState((previous) => ({ ...previous, counts: { ...previous.counts, [id]: 0 } }));
  };

  const resetCategory = (category: AdhkarCategory) => {
    setState((previous) => ({
      ...previous,
      counts: Object.fromEntries(
        Object.entries(previous.counts).filter(([id]) => !category.items.some((item) => item.id === id)),
      ),
    }));
    setNotice('تم تصفير عدّادات هذه الفئة');
  };

  const toggleFavorite = (id: string) => {
    setState((previous) => ({
      ...previous,
      favorites: previous.favorites.includes(id)
        ? previous.favorites.filter((favorite) => favorite !== id)
        : [...previous.favorites, id],
    }));
  };

  const copyDhikr = async (dhikr: Dhikr) => {
    try {
      await navigator.clipboard.writeText(`${dhikr.text}\n${dhikr.reference}`);
      setNotice('تم نسخ الذكر ومرجعه');
    } catch {
      setNotice('تعذّر النسخ. تحقق من إذن الحافظة وحاول مرة أخرى.');
    }
  };

  if (active) {
    const style = styleOf(active.id);
    const categoryDone = active.items.every((item) => (state.counts[item.id] ?? 0) >= item.count);
    return (
      <div className="space-y-4 pb-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setActiveCategory(null);
              setQuery('');
              setFilter('all');
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-lg py-2 text-sm font-medium text-primary-600 dark:text-gold-400"
          >
            <ChevronLeft size={19} className="rotate-180" />
            كل الأذكار
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setState((previous) => ({ ...previous, fontSize: Math.max(18, previous.fontSize - 2) }))}
              aria-label="تصغير الخط"
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-100 text-primary-800 dark:bg-primary-800 dark:text-primary-200"
            >
              <span className="text-sm font-bold">أ−</span>
            </button>
            <button
              onClick={() => setState((previous) => ({ ...previous, fontSize: Math.min(32, previous.fontSize + 2) }))}
              aria-label="تكبير الخط"
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-100 text-primary-800 dark:bg-primary-800 dark:text-primary-200"
            >
              <span className="text-sm font-bold">أ+</span>
            </button>
          </div>
        </div>

        {storageError && (
          <Card className="border-error-200 bg-error-50 dark:border-error-800 dark:bg-error-900/20">
            <p role="alert" className="text-sm text-error-700 dark:text-error-300">{storageError}</p>
          </Card>
        )}

        <CategoryProgress
          category={active}
          counts={state.counts}
          onReset={() => resetCategory(active)}
          haptics={state.haptics}
          onHapticsChange={(haptics) => setState((previous) => ({ ...previous, haptics }))}
        />

        <div className="relative">
          <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في أذكار هذه الفئة..."
            aria-label="البحث في الأذكار"
            className="w-full rounded-xl border border-primary-100 bg-white py-2.5 pr-10 pl-10 text-sm text-primary-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-hidden dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="مسح البحث" className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          )}
        </div>

        <FilterChips filter={filter} favoritesCount={state.favorites.length} onChange={setFilter} />

        <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
          {activeItems.map((dhikr, index) => (
              <div
                key={dhikr.id}
                className="animate-stagger-in"
                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
              >
                <DhikrCard
                  dhikr={dhikr}
                  index={index}
                  count={state.counts[dhikr.id] ?? 0}
                  fontSize={state.fontSize}
                  favorite={state.favorites.includes(dhikr.id)}
                  accent={style}
                  onTap={() => updateCount(dhikr, 1)}
                  onUndo={() => updateCount(dhikr, -1)}
                  onReset={() => resetDhikr(dhikr.id)}
                  onFavorite={() => toggleFavorite(dhikr.id)}
                  onCopy={() => void copyDhikr(dhikr)}
                />
              </div>
            ))}
          {activeItems.length === 0 && (
            <Card className="py-8 text-center">
              <p className="font-semibold text-primary-800 dark:text-primary-100">
                {filter === 'incomplete' && categoryDone ? 'أتممت أذكار هذه الفئة كلها' : 'لا توجد أذكار مطابقة'}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {filter === 'incomplete' && categoryDone
                  ? 'تقبل الله — تراجعها متى شئت.'
                  : 'غيّر عبارة البحث أو أوقف تصفية المفضلة.'}
              </p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  const homeGroups = [
    {
      key: 'daily',
      title: 'روتينك اليومي',
      note: 'يُحتسب في إنجاز اليوم',
      Icon: Sunrise,
      iconClass: 'text-amber-600',
      categories: ADHKAR_CATEGORIES.filter((category) => category.daily !== false),
    },
    {
      key: 'occasions',
      title: 'أذكار المناسبات ونداؤها',
      note: 'تُقرأ عند الحاجة ولا تُحتسب يومياً',
      Icon: Sparkles,
      iconClass: 'text-gold-600',
      categories: ADHKAR_CATEGORIES.filter((category) => category.daily === false),
    },
  ];

  return (
    <div className="space-y-4 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 md:text-3xl dark:text-primary-100">الأذكار</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">أذكارك وأدعيتك، مع حفظ تقدمك على الجهاز</p>
        </div>
        <button
          onClick={() => setState((previous) => ({ ...previous, haptics: !previous.haptics }))}
          aria-pressed={state.haptics}
          aria-label={state.haptics ? 'إيقاف الاهتزاز عند العد' : 'تفعيل الاهتزاز عند العد'}
          className={`flex h-11 w-11 items-center justify-center rounded-xl transition-smooth ${
            state.haptics
              ? 'bg-primary-600 text-white'
              : 'bg-primary-100 text-primary-600 dark:bg-primary-800 dark:text-gold-400'
          }`}
        >
          <Vibrate size={19} />
        </button>
      </div>

      {storageError && (
        <Card className="border-error-200 bg-error-50 dark:border-error-800 dark:bg-error-900/20">
          <p role="alert" className="text-sm text-error-700 dark:text-error-300">{storageError}</p>
        </Card>
      )}

      <DailyHero
        completed={completedItems}
        total={allItems.length}
        progress={overallProgress}
        completedDays={state.completedDays}
        currentDay={state.day}
      />

      <div className="relative">
        <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في نص الذكر أو المرجع..."
          aria-label="البحث في كل الأذكار"
          className="w-full rounded-xl border border-primary-100 bg-white py-2.5 pr-10 pl-10 text-sm text-primary-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-hidden dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="مسح البحث" className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        )}
      </div>

      <FilterChips filter={filter} favoritesCount={state.favorites.length} onChange={setFilter} />

      {query || filter !== 'all' ? (
        <div className="space-y-5 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
          {visibleCategories.map(({ category, items }) => (
            <section key={category.id} className="space-y-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-primary-800 dark:text-primary-100">
                <span
                  className={`h-3 w-3 shrink-0 rounded-full bg-linear-to-br ${styleOf(category.id).icon}`}
                  aria-hidden="true"
                />
                {category.title}
                <span className="text-[11px] font-normal text-gray-400 dark:text-gray-500">
                  {toArabicNumber(items.length)}
                </span>
              </h2>
              {items.map((dhikr, index) => (
                <div
                  key={dhikr.id}
                  className="animate-stagger-in"
                  style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                >
                  <DhikrCard
                    dhikr={dhikr}
                    index={index}
                    count={state.counts[dhikr.id] ?? 0}
                    fontSize={state.fontSize}
                    favorite={state.favorites.includes(dhikr.id)}
                    accent={styleOf(category.id)}
                    onTap={() => updateCount(dhikr, 1)}
                    onUndo={() => updateCount(dhikr, -1)}
                    onReset={() => resetDhikr(dhikr.id)}
                    onFavorite={() => toggleFavorite(dhikr.id)}
                    onCopy={() => void copyDhikr(dhikr)}
                  />
                </div>
              ))}
            </section>
          ))}
          {visibleCategories.length === 0 && (
            <Card className="py-8 text-center">
              <p className="font-semibold text-primary-800 dark:text-primary-100">
                {filter === 'incomplete' ? 'لا توجد أذكار غير مكتملة' : 'لا توجد أذكار مطابقة'}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {filter === 'incomplete'
                  ? 'أنهيت ما في هذه التصفية، تقبل الله.'
                  : 'جرّب بحثاً آخر أو غيّر التصفية.'}
              </p>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {homeGroups.map(({ key, title, note, Icon, iconClass, categories }) => (
            <section key={key} className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-1 px-0.5">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-primary-800 dark:text-primary-100">
                  <Icon size={15} className={iconClass} aria-hidden="true" />
                  {title}
                </h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">{note}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {categories.map((category, index) => (
                  <CategoryCard
                    key={category.id}
                    category={category}
                    counts={state.counts}
                    index={index}
                    onOpen={() => setActiveCategory(category.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Card className="border-dashed bg-gray-50 dark:bg-gray-800/20">
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          الأدعية القرآنية معروضة بنص الآيات ومرجعها، دون تحديد عدد للتكرار. أما الأذكار الأخرى فتُعرض بمراجع بياناتها الحالية.
        </p>
      </Card>

      {notice && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-primary-900 px-4 py-2.5 text-center text-sm text-white shadow-lg md:bottom-8">
          {notice}
        </div>
      )}
    </div>
  );
}

/**
 * The page's opening card: greeting, today's tally inside a ring, and the
 * last seven days as one row of chips — the answer to «أنجزت اليوم؟» and to
 * «كم يوماً أتممتها؟» without scrolling. The strip reads oldest on the
 * right, newest on the left, which is the direction an Arabic reader
 * follows.
 */
function DailyHero({
  completed,
  total,
  progress,
  completedDays,
  currentDay,
}: {
  completed: number;
  total: number;
  progress: number;
  completedDays: string[];
  currentDay: string;
}) {
  const greeting = getGreeting(trustedNow().getHours());
  const percent = Math.round(progress * 100);
  const isComplete = progress === 1;
  const last7 = getLast7Days();
  return (
    <Card className="relative overflow-hidden border-primary-700 bg-linear-to-br from-primary-800 via-primary-900 to-primary-950 text-white dark:border-primary-800">
      <div className="pointer-events-none absolute -top-16 -left-14 h-44 w-44 rounded-full bg-gold-400/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-20 -right-10 h-40 w-40 rounded-full bg-primary-400/20 blur-3xl" aria-hidden="true" />

      <div className="flex items-center gap-4">
        <ProgressRing
          progress={progress}
          size={104}
          stroke={9}
          trackClass="stroke-white/15"
          fillClass={isComplete ? 'stroke-emerald-400' : 'stroke-gold-400'}
        >
          <div className="text-center leading-none">
            {isComplete ? (
              <>
                <CheckCircle size={26} className="mx-auto text-emerald-400" />
                <span className="mt-1 block text-[10px] font-bold text-emerald-300">اكتمل</span>
              </>
            ) : (
              <span className="text-2xl font-bold">
                {toArabicNumber(percent)}<span className="text-sm text-primary-200">٪</span>
              </span>
            )}
          </div>
        </ProgressRing>

        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{greeting}</p>
          <p className="mt-1 text-sm text-primary-100">
            {toArabicNumber(completed)} من {toArabicNumber(total)} ذكر اليوم
          </p>
          <p className="mt-1.5 text-xs leading-5 text-primary-200">
            {isComplete ? 'أتممت الأذكار المسجلة، تقبل الله.' : 'تقدّمك يُحفظ تلقائياً ويبدأ من جديد مع يوم جديد.'}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-bold text-primary-100">آخر {toArabicNumber(7)} أيام</p>
          <p className="text-[11px] text-primary-200">
            {toArabicNumber(completedDays.length)} يوماً مكتملاً
          </p>
        </div>
        <div className="mt-2 flex items-center justify-between gap-1">
          {last7.map((key) => {
            const [year, month, day] = key.split('-').map(Number);
            const done = completedDays.includes(key);
            const isToday = key === currentDay;
            return (
              <div key={key} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[10px] text-primary-200">{getDayNameShort(new Date(year, month - 1, day).getDay())}</span>
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                    done
                      ? 'bg-emerald-400 text-gray-950'
                      : isToday
                        ? 'bg-white/15 text-white ring-2 ring-gold-400'
                        : 'bg-white/10 text-primary-200'
                  }`}
                >
                  {done ? <Check size={13} strokeWidth={3} /> : toArabicNumber(day)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/**
 * The collection's own header: its gradient, a ring with the share of
 * adhkar counted so far, and the two controls that live only here —
 * resetting this collection and its haptic toggle.
 */
function CategoryProgress({
  category,
  counts,
  onReset,
  haptics,
  onHapticsChange,
}: {
  category: AdhkarCategory;
  counts: Record<string, number>;
  onReset: () => void;
  haptics: boolean;
  onHapticsChange: (enabled: boolean) => void;
}) {
  const style = styleOf(category.id);
  const completed = category.items.filter((item) => (counts[item.id] ?? 0) >= item.count).length;
  const progress = completed / category.items.length;
  const isComplete = completed === category.items.length;
  return (
    <Card className={`relative overflow-hidden border-primary-700 bg-linear-to-bl ${style.hero} text-white dark:border-primary-800`}>
      <div className="pointer-events-none absolute -top-14 -left-14 h-40 w-40 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
      <div className="flex items-center gap-4">
        <ProgressRing
          progress={progress}
          size={88}
          stroke={8}
          trackClass="stroke-white/20"
          fillClass={isComplete ? 'stroke-emerald-300' : 'stroke-white'}
        >
          <div className="text-center leading-none">
            <span className="text-lg font-bold">{toArabicNumber(Math.round(progress * 100))}</span>
            <span className="block text-[10px] text-white/70">٪</span>
          </div>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{category.title}</h1>
          <p className="mt-1 text-sm text-white/85">
            {toArabicNumber(completed)} من {toArabicNumber(category.items.length)} أذكار مكتملة
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => onHapticsChange(!haptics)}
              aria-pressed={haptics}
              aria-label={haptics ? 'إيقاف الاهتزاز عند العد' : 'تفعيل الاهتزاز عند العد'}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-smooth ${haptics ? 'bg-white/25' : 'bg-white/10'}`}
            >
              <Vibrate size={17} />
            </button>
            <button
              onClick={onReset}
              className="inline-flex h-10 items-center gap-1 rounded-lg bg-white/10 px-3 text-xs font-medium text-white transition-smooth hover:bg-white/20"
            >
              <RotateCcw size={13} />
              تصفير الفئة
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-xs text-white/75">
        {isComplete ? 'أتممت هذه الفئة، تقبل الله.' : 'اضغط على زر العد بعد قراءة الذكر.'}
      </p>
    </Card>
  );
}

/**
 * One collection on the home grid: gradient tile, the share counted so far
 * as a bar with its percentage, and a check seal once every dhikr in it is
 * done. `counts` only ever advances inside the daily routine, so occasion
 * cards sit at zero until they are opened — the card reports that honestly
 * rather than pretending the reader is behind.
 */
function CategoryCard({
  category,
  counts,
  index,
  onOpen,
}: {
  category: AdhkarCategory;
  counts: Record<string, number>;
  index: number;
  onOpen: () => void;
}) {
  const style = styleOf(category.id);
  const Icon = ICONS[category.icon] ?? Heart;
  const done = category.items.filter((item) => (counts[item.id] ?? 0) >= item.count).length;
  const progress = category.items.length ? done / category.items.length : 0;
  const isComplete = done === category.items.length;
  return (
    <div className="animate-stagger-in" style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}>
      <Card onClick={onOpen} className="group relative overflow-hidden transition-smooth hover:-translate-y-0.5">
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-linear-to-r ${style.icon}`} aria-hidden="true" />
        <div className="flex items-center gap-3 pt-0.5">
          <div className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br ${style.icon} shadow-sm`}>
            <Icon size={22} className="text-white drop-shadow-sm" />
            {isComplete && (
              <span className="absolute -bottom-1.5 -left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-success-500 text-white ring-2 ring-panel dark:ring-raised">
                <Check size={12} strokeWidth={3} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-bold text-primary-800 dark:text-primary-100">{category.title}</p>
              <span className="shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400">
                {toArabicNumber(done)} / {toArabicNumber(category.items.length)}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${style.bar}`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-[10px] font-bold text-gray-400 dark:text-gray-500">
                {toArabicNumber(Math.round(progress * 100))}٪
              </span>
            </div>
          </div>
          <ChevronLeft
            size={19}
            className="shrink-0 text-gray-300 transition-smooth group-hover:-translate-x-0.5 dark:text-gray-600"
          />
        </div>
      </Card>
    </div>
  );
}

function DhikrCard({
  dhikr,
  index,
  count,
  fontSize,
  favorite,
  accent = DEFAULT_CATEGORY_STYLE,
  onTap,
  onUndo,
  onReset,
  onFavorite,
  onCopy,
}: {
  dhikr: Dhikr;
  index: number;
  count: number;
  fontSize: number;
  favorite: boolean;
  accent?: CategoryStyle;
  onTap: () => void;
  onUndo: () => void;
  onReset: () => void;
  onFavorite: () => void;
  onCopy: () => void;
}) {
  const isDone = count >= dhikr.count;
  const progress = Math.min(count / dhikr.count, 1);
  return (
    <Card className={`transition-smooth ${isDone ? 'border-success-300 bg-success-50/30 dark:border-success-700 dark:bg-success-900/10' : ''}`}>
      <div className="flex items-start gap-3">
        <ProgressRing
          progress={progress}
          size={46}
          stroke={4}
          trackClass="stroke-gray-200 dark:stroke-gray-700"
          fillClass={isDone ? 'stroke-success-500' : accent.ring}
        >
          <span
            className={`flex items-center justify-center text-sm font-bold ${
              isDone ? 'text-success-600 dark:text-success-400' : 'text-primary-800 dark:text-primary-200'
            }`}
          >
            {isDone ? <Check size={18} strokeWidth={3} /> : toArabicNumber(index + 1)}
          </span>
        </ProgressRing>
        <p
          className="quran-text flex-1 whitespace-pre-line leading-[2.1] text-primary-900 dark:text-primary-50 md:max-w-[48ch]"
          style={{ fontSize }}
        >
          {dhikr.text}
        </p>
      </div>

      <div className="mt-3 rounded-xl bg-primary-100/70 px-3 py-2.5 dark:bg-primary-800/30">
        {dhikr.virtue && (
          <p className="text-sm leading-6 text-gold-800 dark:text-gold-300">
            <span className="font-semibold">الفضل المذكور:</span> {dhikr.virtue}
          </p>
        )}
        <p className="mt-1.5">
          <span className={`inline-block rounded-md px-2 py-1 text-[11px] font-semibold ${accent.chip}`}>
            {dhikr.reference}
          </span>
        </p>
        {dhikr.note && (
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{dhikr.note}</p>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onTap}
          disabled={isDone}
          aria-label={dhikr.countIsSpecified === false
            ? `تسجيل قراءة الدعاء ${dhikr.id}${isDone ? ': تمت القراءة' : ''}`
            : `تسبيح ${dhikr.id}: ${toArabicNumber(count)} من ${toArabicNumber(dhikr.count)}`}
          className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl font-semibold transition-smooth active:scale-[0.99] md:mx-auto md:w-72 md:max-w-sm md:flex-none ${
            isDone
              ? 'cursor-default bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {isDone ? <CheckCircle size={18} /> : <span>{dhikr.countIsSpecified === false ? 'تسجيل القراءة' : 'اضغط للعد'}</span>}
          {dhikr.countIsSpecified === false ? (
            <span className="text-sm">{isDone ? 'تمت القراءة' : 'لم تُسجّل بعد'}</span>
          ) : (
            <>
              <span className="text-lg">{toArabicNumber(count)}</span>
              <span className="text-sm opacity-75">/ {toArabicNumber(dhikr.count)}</span>
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onUndo}
          disabled={count === 0}
          aria-label="تراجع عن آخر عدّة"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <Minus size={18} />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500">
          {dhikr.countIsSpecified === false
            ? (isDone ? 'تمت القراءة' : 'دون عدد محدد')
            : `${toArabicNumber(count)} / ${toArabicNumber(dhikr.count)}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
            aria-pressed={favorite}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-rose-100 hover:text-rose-500 dark:hover:bg-rose-900/20 md:h-11 md:w-11"
          >
            <Heart size={17} className={favorite ? 'fill-rose-500 text-rose-500' : ''} />
          </button>
          <button
            type="button"
            onClick={onCopy}
            aria-label="نسخ الذكر ومرجعه"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-800/40 md:h-11 md:w-11"
          >
            <Copy size={16} />
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={count === 0}
            aria-label="تصفير عدّاد الذكر"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800 md:h-11 md:w-11"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
    </Card>
  );
}
