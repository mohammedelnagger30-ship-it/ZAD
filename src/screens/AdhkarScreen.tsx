import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle,
  ChevronLeft,
  Copy,
  BookOpen,
  Droplets,
  Flower2,
  Heart,
  HeartHandshake,
  Home,
  Landmark,
  Minus,
  Moon,
  Plane,
  RotateCcw,
  Search,
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
import { todayKey } from '@/utils/dateUtils';
import { normalizeArabic } from '@/utils/arabic';

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
};

interface AdhkarState {
  day: string;
  counts: Record<string, number>;
  favorites: string[];
  fontSize: number;
  haptics: boolean;
}

const DEFAULT_STATE: AdhkarState = {
  day: todayKey(),
  counts: {},
  favorites: [],
  fontSize: 22,
  haptics: false,
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

export function AdhkarScreen() {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [initialState] = useState(loadState);
  const [state, setState] = useState<AdhkarState>(initialState.state);
  const [storageError, setStorageError] = useState<string | null>(initialState.error);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
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
    return matchesQuery && (!favoritesOnly || state.favorites.includes(dhikr.id));
  }) ?? [];

  const visibleCategories = useMemo(() => {
    const search = normalizeArabic(query);
    return ADHKAR_CATEGORIES.map((category) => ({
      category,
      items: category.items.filter((item) => {
        if (favoritesOnly && !state.favorites.includes(item.id)) return false;
        if (!search) return true;
        return normalizeArabic(`${item.text} ${item.reference} ${item.virtue ?? ''} ${item.note ?? ''}`).includes(search);
      }),
    })).filter(({ items }) => items.length > 0);
  }, [query, favoritesOnly, state.favorites]);

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
    return (
      <div className="space-y-4 pb-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              setActiveCategory(null);
              setQuery('');
              setFavoritesOnly(false);
            }}
            className="inline-flex items-center gap-1 rounded-lg py-2 text-sm font-medium text-primary-600 dark:text-gold-400"
          >
            <ChevronLeft size={19} className="rotate-180" />
            كل الأذكار
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setState((previous) => ({ ...previous, fontSize: Math.max(18, previous.fontSize - 2) }))}
              aria-label="تصغير الخط"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-200"
            >
              <span className="text-sm font-bold">أ−</span>
            </button>
            <button
              onClick={() => setState((previous) => ({ ...previous, fontSize: Math.min(32, previous.fontSize + 2) }))}
              aria-label="تكبير الخط"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-200"
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
            className="w-full rounded-xl border border-primary-100 bg-white py-2.5 pr-10 pl-10 text-sm text-primary-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="مسح البحث" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X size={16} />
            </button>
          )}
        </div>

        <div className="space-y-3">
          {activeItems.map((dhikr, index) => (
              <DhikrCard
                key={dhikr.id}
                dhikr={dhikr}
                index={index}
                count={state.counts[dhikr.id] ?? 0}
                fontSize={state.fontSize}
                favorite={state.favorites.includes(dhikr.id)}
                onTap={() => updateCount(dhikr, 1)}
                onUndo={() => updateCount(dhikr, -1)}
                onReset={() => resetDhikr(dhikr.id)}
                onFavorite={() => toggleFavorite(dhikr.id)}
                onCopy={() => void copyDhikr(dhikr)}
              />
            ))}
          {activeItems.length === 0 && (
            <Card className="py-8 text-center">
              <p className="font-semibold text-primary-800 dark:text-primary-100">لا توجد أذكار مطابقة</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">غيّر عبارة البحث أو أوقف تصفية المفضلة.</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">الأذكار</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">أذكارك وأدعيتك، مع حفظ تقدمك على الجهاز</p>
        </div>
        <button
          onClick={() => setState((previous) => ({ ...previous, haptics: !previous.haptics }))}
          aria-pressed={state.haptics}
          aria-label={state.haptics ? 'إيقاف الاهتزاز عند العد' : 'تفعيل الاهتزاز عند العد'}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-smooth ${
            state.haptics
              ? 'bg-primary-600 text-white'
              : 'bg-primary-50 text-primary-600 dark:bg-primary-800 dark:text-gold-400'
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

      <Card className="overflow-hidden border-primary-700 bg-gradient-to-bl from-primary-700 to-primary-950 text-white dark:border-primary-800">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-primary-100">إنجاز الأذكار اليومية</p>
            <p className="mt-1 text-3xl font-bold">
              {toArabicNumber(completedItems)}
              <span className="text-base font-medium text-primary-200"> / {toArabicNumber(allItems.length)} ذكر</span>
            </p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <CheckCircle size={23} className={overallProgress === 1 ? 'text-emerald-300' : 'text-gold-300'} />
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
          <div className="h-full rounded-full bg-gold-300 transition-all duration-300" style={{ width: `${overallProgress * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-primary-100">
          {overallProgress === 1 ? 'أتممت الأذكار المسجلة، تقبل الله.' : 'تقدّمك يُحفظ تلقائياً ويبدأ من جديد مع يوم جديد.'}
        </p>
      </Card>

      <div className="relative">
        <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في نص الذكر أو المرجع..."
          aria-label="البحث في كل الأذكار"
          className="w-full rounded-xl border border-primary-100 bg-white py-2.5 pr-10 pl-10 text-sm text-primary-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-none dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="مسح البحث" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <X size={16} />
          </button>
        )}
      </div>

      <button
        onClick={() => setFavoritesOnly((value) => !value)}
        aria-pressed={favoritesOnly}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-smooth ${
          favoritesOnly
            ? 'bg-rose-500 text-white'
            : 'bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-200'
        }`}
      >
        <Heart size={16} className={favoritesOnly ? 'fill-white' : ''} />
        {favoritesOnly ? 'عرض كل الأذكار' : `المفضلة (${toArabicNumber(state.favorites.length)})`}
      </button>

      {query || favoritesOnly ? (
        <div className="space-y-4">
          {visibleCategories.map(({ category, items }) => (
            <section key={category.id} className="space-y-2">
              <h2 className="text-sm font-semibold text-primary-700 dark:text-primary-200">{category.title}</h2>
              {items.map((dhikr, index) => (
                <DhikrCard
                  key={dhikr.id}
                  dhikr={dhikr}
                  index={index}
                  count={state.counts[dhikr.id] ?? 0}
                  fontSize={state.fontSize}
                  favorite={state.favorites.includes(dhikr.id)}
                  onTap={() => updateCount(dhikr, 1)}
                  onUndo={() => updateCount(dhikr, -1)}
                  onReset={() => resetDhikr(dhikr.id)}
                  onFavorite={() => toggleFavorite(dhikr.id)}
                  onCopy={() => void copyDhikr(dhikr)}
                />
              ))}
            </section>
          ))}
          {visibleCategories.length === 0 && (
            <Card className="py-8 text-center">
              <p className="font-semibold text-primary-800 dark:text-primary-100">لا توجد أذكار مطابقة</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">جرّب بحثاً آخر أو أزل تصفية المفضلة.</p>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {ADHKAR_CATEGORIES.map((category) => {
            const Icon = ICONS[category.icon] ?? Heart;
            const done = category.items.filter((item) => (state.counts[item.id] ?? 0) >= item.count).length;
            const progress = done / category.items.length;
            return (
              <Card
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className="flex items-center gap-3 transition-smooth hover:border-primary-300"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
                  <Icon size={23} className="text-primary-600 dark:text-gold-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-primary-800 dark:text-primary-100">{category.title}</p>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {toArabicNumber(done)} / {toArabicNumber(category.items.length)}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full rounded-full bg-primary-500 transition-all dark:bg-gold-400" style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
                <ChevronLeft size={19} className="shrink-0 text-gray-300 dark:text-gray-600" />
              </Card>
            );
          })}
        </div>
      )}

      <Card className="border-dashed bg-gray-50 dark:bg-gray-800/20">
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
          الأدعية القرآنية معروضة بنص الآيات ومرجعها، دون تحديد عدد للتكرار. أما الأذكار الأخرى فتُعرض بمراجع بياناتها الحالية.
        </p>
      </Card>

      {notice && (
        <div role="status" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-primary-900 px-4 py-2.5 text-sm text-white shadow-lg">
          {notice}
        </div>
      )}
    </div>
  );
}

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
  const completed = category.items.filter((item) => (counts[item.id] ?? 0) >= item.count).length;
  const progress = completed / category.items.length;
  const isComplete = completed === category.items.length;
  return (
    <Card className="overflow-hidden border-primary-700 bg-gradient-to-bl from-primary-700 to-primary-950 text-white dark:border-primary-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{category.title}</h1>
          <p className="mt-1 text-sm text-primary-100">
            {toArabicNumber(completed)} من {toArabicNumber(category.items.length)} أذكار مكتملة
          </p>
        </div>
        <button
          onClick={() => onHapticsChange(!haptics)}
          aria-pressed={haptics}
          aria-label={haptics ? 'إيقاف الاهتزاز عند العد' : 'تفعيل الاهتزاز عند العد'}
          className={`flex h-9 w-9 items-center justify-center rounded-lg ${haptics ? 'bg-white/25' : 'bg-white/10'}`}
        >
          <Vibrate size={17} />
        </button>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-gold-300 transition-all duration-300" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-primary-100">
          {isComplete ? 'أتممت هذه الفئة، تقبل الله.' : 'اضغط على زر العد بعد قراءة الذكر.'}
        </p>
        <button
          onClick={onReset}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white hover:bg-white/20"
        >
          <RotateCcw size={13} />
          تصفير الفئة
        </button>
      </div>
    </Card>
  );
}

function DhikrCard({
  dhikr,
  index,
  count,
  fontSize,
  favorite,
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
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
          isDone ? 'bg-success-500 text-white' : 'bg-primary-100 text-primary-600 dark:bg-primary-800 dark:text-primary-300'
        }`}>
          {isDone ? <Check size={17} /> : toArabicNumber(index + 1)}
        </div>
        <p
          className="quran-text flex-1 whitespace-pre-line leading-[2.1] text-primary-900 dark:text-primary-50"
          style={{ fontSize }}
        >
          {dhikr.text}
        </p>
      </div>

      <div className="mt-3 rounded-xl bg-primary-50/70 px-3 py-2.5 dark:bg-primary-800/30">
        {dhikr.virtue && (
          <p className="text-sm leading-6 text-gold-700 dark:text-gold-300">
            <span className="font-semibold">الفضل المذكور:</span> {dhikr.virtue}
          </p>
        )}
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{dhikr.reference}</p>
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
          className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl font-semibold transition-smooth active:scale-[0.99] ${
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

      <div className="mt-2 flex items-center justify-between">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div className={`h-full rounded-full transition-all duration-300 ${isDone ? 'bg-success-500' : 'bg-primary-500'}`} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="mr-2 flex items-center gap-1">
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
            aria-pressed={favorite}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-900/20"
          >
            <Heart size={17} className={favorite ? 'fill-rose-500 text-rose-500' : ''} />
          </button>
          <button
            type="button"
            onClick={onCopy}
            aria-label="نسخ الذكر ومرجعه"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-800"
          >
            <Copy size={16} />
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={count === 0}
            aria-label="تصفير عدّاد الذكر"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-gray-800"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
    </Card>
  );
}
