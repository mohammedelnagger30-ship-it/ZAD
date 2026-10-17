import { useEffect, useMemo, useState } from 'react';
import { BookOpen, BookText, ChevronLeft, Heart, Loader2, ScrollText, Search, X } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import type { ScreenName } from '@/hooks/useApp';
import {
  PER_SOURCE_LIMIT,
  UNIFIED_SOURCE_LABELS,
  UNIFIED_SOURCE_ORDER,
  mergeUnifiedResults,
  searchUnifiedCore,
  searchUnifiedTafsir,
  type UnifiedResult,
  type UnifiedSource,
} from '@/utils/unifiedSearch';

/**
 * The one box that asks four corpora the same question.
 *
 * The screen's whole job is to stay still while answers arrive. Three sources
 * come back from an index and land together; the commentary is folded file by
 * file and lands afterwards, which is why `unifiedSearch` puts tafsir last in
 * the merged list — so nothing already on screen can move when it does. What
 * is drawn in the meantime is a line saying it is still looking, not a
 * skeleton: the results above it are real and tappable while it runs.
 */

interface SearchScreenProps {
  navigate: (screen: ScreenName, params?: Record<string, unknown>) => void;
}

/** The same pause the hadith screen uses: folding Arabic strings per keystroke stutters. */
const DEBOUNCE_MS = 220;

const SOURCE_ICONS: Record<UnifiedSource, typeof BookOpen> = {
  quran: BookOpen,
  hadith: BookText,
  adhkar: Heart,
  tafsir: ScrollText,
};

/** One neutral pill for all four. The icon and the word carry the difference;
 *  a colour code would be a fifth thing for the reader to learn. */
const SOURCE_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[0.6875rem] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300';

export function SearchScreen({ navigate }: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<Partial<Record<UnifiedSource, UnifiedResult[]>>>({});
  const [searching, setSearching] = useState(false);
  const [scanningTafsir, setScanningTafsir] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSections({});
      setSearching(false);
      setScanningTafsir(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);

    const run = async () => {
      try {
        const core = await searchUnifiedCore(trimmed, controller.signal);
        if (cancelled) return;
        setSections(core);
        setSearching(false);

        setScanningTafsir(true);
        const tafsir = await searchUnifiedTafsir(trimmed, controller.signal);
        if (cancelled) return;
        setSections(tafsir.length > 0 ? { ...core, tafsir } : core);
      } catch {
        if (!cancelled) setSections({});
      } finally {
        if (!cancelled) {
          setSearching(false);
          setScanningTafsir(false);
        }
      }
    };

    const timer = setTimeout(run, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const results = useMemo(() => mergeUnifiedResults(sections, PER_SOURCE_LIMIT), [sections]);
  const counts = useMemo(
    () =>
      UNIFIED_SOURCE_ORDER.map((source) => ({
        source,
        count: Math.min(sections[source]?.length ?? 0, PER_SOURCE_LIMIT),
      })).filter(({ count }) => count > 0),
    [sections],
  );

  const hasQuery = query.trim().length > 0;
  const waiting = searching || scanningTafsir;
  const settled = hasQuery && !waiting;

  const open = (result: UnifiedResult) => {
    if (result.target) navigate(result.target.screen, result.target.params ?? {});
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-primary-900 dark:text-primary-50">البحث الشامل</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          آيةٌ أو حديثٌ أو ذكرٌ أو تفسير — في نتيجة واحدة.
        </p>
      </div>

      <div className="relative group">
        <div className="absolute inset-0 rounded-3xl bg-linear-to-r from-primary-500 to-primary-600 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-lg" />
        <Search
          size={20}
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-primary-500 dark:text-primary-300 transition-colors group-focus-within:text-primary-600"
        />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث في القرآن والحديث والأذكار والتفسير…"
          aria-label="البحث الشامل"
          className="relative min-h-14 w-full rounded-3xl border-2 border-primary-200 bg-white py-3.5 pl-12 pr-12 text-base text-primary-800 shadow-lg outline-hidden transition-all duration-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100/70 placeholder:text-gray-400 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100 dark:focus:ring-primary-900/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="مسح البحث"
            className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-2xl text-gray-400 transition-all hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-100"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {!hasQuery ? (
        <div className="rounded-3xl border-2 border-dashed border-primary-300 bg-linear-to-br from-white/50 to-primary-50/50 px-6 py-12 text-center shadow-inner dark:border-primary-800 dark:from-primary-950/50 dark:to-primary-900/50">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-800">
            <Search size={32} className="text-primary-400 dark:text-primary-500" />
          </div>
          <p className="text-lg font-bold text-primary-800 dark:text-primary-100">
            اكتب ما تتذكره من آية أو حديث أو ذكر
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            لا يهم التشكيل ولا ترتيب الكلمات ولا اختلاف كتابة الحروف — والبحث يمرّ على الأربعة
            كلّها في مرّة واحدة.
          </p>
        </div>
      ) : results.length === 0 && !settled ? (
        <div className="flex items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-primary-300 px-6 py-10 text-primary-700 dark:border-primary-800 dark:text-primary-200">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm font-bold">جارٍ البحث…</span>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-primary-300 bg-linear-to-br from-white/50 to-primary-50/50 px-6 py-12 text-center shadow-inner dark:border-primary-800 dark:from-primary-950/50 dark:to-primary-900/50">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-800">
            <Search size={32} className="text-primary-400 dark:text-primary-500" />
          </div>
          <p className="text-lg font-bold text-primary-800 dark:text-primary-100">لا نتائج مطابقة</p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">جرّب كلمات أقصر أو صيغة أخرى</p>
        </div>
      ) : (
        <>
          {/* `justify-start` under `dir="rtl"` is the right-hand edge: the counts sit
              above the first card, at the edge the reader's eye starts from. */}
          <div className="flex flex-wrap items-center justify-start gap-2">
            {counts.map(({ source, count }) => (
              <span
                key={source}
                className="rounded-2xl bg-primary-100/80 px-3 py-1.5 text-xs text-gray-600 dark:bg-primary-900/40 dark:text-gray-300"
              >
                {UNIFIED_SOURCE_LABELS[source]}:{' '}
                <span className="font-bold text-primary-700 dark:text-primary-200">
                  {toArabicNumber(count)}
                </span>
              </span>
            ))}
          </div>

          <div className="space-y-3 md:max-w-3xl">
            {results.map((result) => {
              const Icon = SOURCE_ICONS[result.source];
              const isQuran = result.source === 'quran';
              return (
                <button
                  key={result.key}
                  type="button"
                  onClick={() => open(result)}
                  className="group w-full rounded-3xl border-2 border-primary-100 bg-white p-5 text-right shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-primary-800/60 dark:bg-primary-900/30 dark:hover:border-primary-700"
                >
                  <span className={SOURCE_PILL}>
                    <Icon size={13} strokeWidth={2.4} />
                    {UNIFIED_SOURCE_LABELS[result.source]}
                  </span>
                  <p
                    className={`mt-3 text-primary-900 dark:text-primary-50 ${
                      isQuran ? 'quran-text text-lg' : 'text-base leading-7'
                    }`}
                    dir="rtl"
                  >
                    {result.text}
                  </p>
                  <p className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-primary-600 dark:text-primary-300">
                    <span>
                      {result.reference}
                      {result.detail ? ` · ${result.detail}` : ''}
                    </span>
                    {result.target && (
                      <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        افتح <ChevronLeft size={14} />
                      </span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>

          {scanningTafsir && (
            <p className="flex items-center justify-center gap-2 py-1 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 size={14} className="animate-spin" />
              جارٍ البحث في التفسير المحمَّل…
            </p>
          )}
        </>
      )}
    </div>
  );
}
