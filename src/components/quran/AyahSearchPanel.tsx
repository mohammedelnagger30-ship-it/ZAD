import { Search, X, ChevronLeft } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import { type AyahSearchOutcome } from '@/utils/ayahSearch';

interface AyahSearchPanelProps {
  ayahQuery: string;
  setAyahQuery: (query: string) => void;
  ayahSearch: AyahSearchOutcome;
  openAyahFromSearch: (surahId: number, ayahNumber: number) => void;
}

export function AyahSearchPanel({ ayahQuery, setAyahQuery, ayahSearch, openAyahFromSearch }: AyahSearchPanelProps) {
  return (
    <>
      {/* Search inside the ayah text */}
            {/* Search inside the ayah text */}
            <div className="relative group">
              <div className="absolute inset-0 rounded-3xl bg-linear-to-r from-primary-500 to-primary-600 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-lg" />
              <Search size={20} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-primary-500 dark:text-primary-300 transition-colors group-focus-within:text-primary-600" />
              <input
                type="text"
                value={ayahQuery}
                onChange={(e) => setAyahQuery(e.target.value)}
                placeholder="ابحث في نص القرآن الكريم..."
                aria-label="ابحث في الآيات"
                className="relative min-h-14 w-full rounded-3xl border-2 border-primary-200 bg-white py-3.5 pl-12 pr-12 text-base text-primary-800 shadow-lg outline-hidden transition-all duration-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100/70 placeholder:text-gray-400 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100 dark:focus:ring-primary-900/60"
              />
              {ayahQuery && (
                <button
                  onClick={() => setAyahQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-2xl text-gray-400 transition-all hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-100"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {!ayahQuery.trim() ? (
              <div className="rounded-3xl border-2 border-dashed border-primary-300 bg-linear-to-br from-white/50 to-primary-50/50 px-6 py-12 text-center shadow-inner dark:border-primary-800 dark:from-primary-950/50 dark:to-primary-900/50">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-800">
                  <Search size={32} className="text-primary-400 dark:text-primary-500" />
                </div>
                <p className="text-lg font-bold text-primary-800 dark:text-primary-100">ابحث عن آية بكلمات تذكرها</p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  لا يهم التشكيل ولا ترتيب الكلمات ولا اختلاف كتابة الحروف — اكتب ما تتذكره وسيطابقه البحث مع النص.
                </p>
              </div>
            ) : ayahSearch.results.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-primary-300 bg-linear-to-br from-white/50 to-primary-50/50 px-6 py-12 text-center shadow-inner dark:border-primary-800 dark:from-primary-950/50 dark:to-primary-900/50">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-800">
                  <Search size={32} className="text-primary-400 dark:text-primary-500" />
                </div>
                <p className="text-lg font-bold text-primary-800 dark:text-primary-100">لا توجد آية مطابقة</p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">جرّب كلمات أقصر أو صيغة أخرى</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-end">
                  <div className="flex items-center gap-2 rounded-2xl bg-primary-100/80 px-4 py-2 dark:bg-primary-900/40">
                    <span className="text-xs text-gray-600 dark:text-gray-400">النتائج:</span>
                    <span className="text-sm font-bold text-primary-700 dark:text-primary-200">
                      {toArabicNumber(ayahSearch.total)}
                    </span>
                    {ayahSearch.total > ayahSearch.results.length && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-400">
                        (أول {toArabicNumber(ayahSearch.results.length)})
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  {ayahSearch.results.map((result) => (
                    <button
                      key={`${result.surahId}:${result.ayahNumber}`}
                      type="button"
                      onClick={() => openAyahFromSearch(result.surahId, result.ayahNumber)}
                      className="group w-full rounded-3xl border-2 border-primary-100 bg-white p-5 text-right shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md dark:border-primary-800/60 dark:bg-primary-900/30 dark:hover:border-primary-700"
                    >
                      <p className="quran-text text-lg text-primary-900 dark:text-primary-50" dir="rtl">
                        {result.text}
                      </p>
                      <p className="mt-3 flex items-center justify-between text-xs text-primary-600 dark:text-primary-300">
                        <span>
                          سورة {result.surahName} — الآية {toArabicNumber(result.ayahNumber)}
                        </span>
                        <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          افتح في القارئ <ChevronLeft size={14} />
                        </span>
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
    </>
  );
}
