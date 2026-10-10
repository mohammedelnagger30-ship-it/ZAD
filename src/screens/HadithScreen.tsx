import { useState, useEffect, useCallback } from 'react';
import { Search, Heart, BookText, X, ChevronLeft, ChevronRight, Filter, AlertTriangle, Library, Loader2, Download, Copy } from 'lucide-react';
import { Card, Badge, EmptyState } from '@/components/ui';
import { ContentLibrary } from '@/screens/ContentLibrary';
import {
  GRADE_INFO,
  getHadithCollection,
  installedCollections,
  searchInstalledHadiths,
  type HadithCollection,
  type HadithRecord,
} from '@/data/hadiths';
import { HADITH_BOOKS, HADITH_OF_DAY_BOOK, getHadithBook } from '@/data/contentCatalog';
import type { HadithGrade } from '@/data/hadithCollections';
import { toArabicNumber } from '@/data/surahs';
import { db } from '@/db/database';

type ViewMode = 'search' | 'browse' | 'detail' | 'manager';
const SEARCH_PAGE_SIZE = 50;
const BROWSE_PAGE_SIZE = 30;
const HADITH_CATEGORIES = [
  { title: 'الكتب الستة', ids: ['sahih_bukhari', 'sahih_muslim', 'sunan_abi_dawud', 'jami_tirmidhi', 'sunan_nasai', 'sunan_ibn_majah'] },
  { title: 'الموطأ', ids: ['muwatta_malik'] },
  { title: 'المتون المختصرة', ids: ['arbaeen_nawawi', 'forty_qudsi'] },
];

interface HadithScreenProps {
  /** Optional navigation params, e.g. `{ hadithId }` to deep-link into a hadith. */
  params?: Record<string, unknown>;
}

export function HadithScreen({ params }: HadithScreenProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('search');
  const [managerReturnView, setManagerReturnView] = useState<ViewMode>('search');
  const [query, setQuery] = useState('');
  const [sahihOnly, setSahihOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<HadithRecord | null>(null);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [installed, setInstalled] = useState<string[]>([]);

  // Browse state: collection -> section
  const [browseCollection, setBrowseCollection] = useState<string | null>(null);
  const [browseSection, setBrowseSection] = useState<number | null>(null);
  const [browseSectionQuery, setBrowseSectionQuery] = useState('');
  const [browseHadithPage, setBrowseHadithPage] = useState(1);
  const [browseData, setBrowseData] = useState<HadithCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const loadFavorites = useCallback(async () => {
    const favs = await db.hadithFavorites.toArray();
    setFavorites(new Set(favs.map((f) => f.hadithId)));
  }, []);

  const refreshInstalled = useCallback(async () => {
    setInstalled([...(await installedCollections())]);
  }, []);

  useEffect(() => {
    void loadFavorites();
    void refreshInstalled();
  }, [loadFavorites, refreshInstalled]);

  const toggleFavorite = async (hadithId: string) => {
    if (favorites.has(hadithId)) {
      const fav = await db.hadithFavorites.where('hadithId').equals(hadithId).first();
      if (fav) await db.hadithFavorites.delete(fav.id!);
    } else {
      const collectionId = hadithId.split(':')[0];
      await db.hadithFavorites.add({ hadithId, collection: collectionId, createdAt: Date.now() });
    }
    void loadFavorites();
  };

  // ---- results ----
  //
  // Search runs against whatever is on the device. It is debounced because folding tens of
  // thousands of Arabic strings on every keystroke visibly stutters on a phone.
  const [hits, setHits] = useState<HadithRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copiedHadithId, setCopiedHadithId] = useState<string | null>(null);
  const [detailReturnView, setDetailReturnView] = useState<ViewMode>('search');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const found = await searchInstalledHadiths(query, {
          limit: SEARCH_PAGE_SIZE * searchPage + 1,
          ...(showFavoritesOnly ? { hadithIds: favorites } : {}),
          ...(sahihOnly ? { sahihOnly: true } : {}),
          ...(collectionFilter !== 'all' ? { collectionId: collectionFilter } : {}),
        });
        if (cancelled) return;
        setHasMore(found.length > SEARCH_PAGE_SIZE * searchPage);
        setHits(found.slice(0, SEARCH_PAGE_SIZE * searchPage).map((h) => h.hadith));
      } catch (error) {
        if (!cancelled) {
          setHits([]);
          setHasMore(false);
          setSearchError(error instanceof Error ? error.message : 'تعذّر البحث في كتب الحديث المحمّلة');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    };
    const timer = setTimeout(run, query.trim() ? 220 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, collectionFilter, installed, favorites, showFavoritesOnly, searchPage, sahihOnly]);

  useEffect(() => {
    setSearchPage(1);
  }, [query, collectionFilter, showFavoritesOnly, sahihOnly]);

  const visibleHits = hits;

  // Deep-link support. Depends on the id itself, not on `params`, which gets a fresh
  // identity on every navigate() and kept forcing the detail view open.
  const deepLinkId = typeof params?.hadithId === 'string' ? params.hadithId : null;
  useEffect(() => {
    if (!deepLinkId) return;
    const collectionId = deepLinkId.split(':')[0];
    void (async () => {
      try {
        const collection = await getHadithCollection(collectionId);
        const found = collection.hadiths.find((h) => h.id === deepLinkId);
        if (found) {
          setSelected(found);
          setDetailReturnView('search');
          setViewMode('detail');
        }
      } catch {
        // The collection is not on the device; the empty state explains how to get it.
      }
    })();
  }, [deepLinkId]);

  // ---- browse ----
  const openCollection = useCallback(async (id: string) => {
    setBrowseCollection(id);
    setBrowseSection(null);
    setBrowseSectionQuery('');
    setBrowseHadithPage(1);
    setBrowseError(null);
    setLoading(true);
    try {
      setBrowseData(await getHadithCollection(id));
    } catch (error) {
      setBrowseData(null);
      setBrowseError(error instanceof Error ? error.message : 'تعذّر فتح مجموعة الأحاديث');
    } finally {
      setLoading(false);
    }
  }, []);

  const copyHadith = async (hadith: HadithRecord) => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(hadith.text);
      setCopiedHadithId(hadith.id);
    } catch {
      setCopyError('تعذّر نسخ الحديث. تحقق من إذن الحافظة وحاول مرة أخرى.');
    }
  };

  const openHadith = (hadith: HadithRecord, returnTo: ViewMode) => {
    setSelected(hadith);
    setDetailReturnView(returnTo);
    setCopyError(null);
    setViewMode('detail');
  };

  const openContentManager = () => {
    setManagerReturnView(viewMode);
    setViewMode('manager');
  };

  // ---- detail ----
  if (viewMode === 'detail' && selected) {
    const grade = selected.grades[0] ?? 'unknown';
    const book = getHadithBook(selected.collectionId);
    return (
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between sticky top-0 z-30 bg-surface-light dark:bg-surface-dark/95 backdrop-blur-lg py-2 -mx-4 px-4 border-b border-primary-100 dark:border-primary-800/30">
          <button
            onClick={() => setViewMode(detailReturnView)}
            className="flex items-center gap-1 text-primary-600 dark:text-gold-400"
          >
            <ChevronRight size={20} />
            <span className="text-sm">رجوع</span>
          </button>
          <button
            onClick={() => void toggleFavorite(selected.id)}
            aria-label={favorites.has(selected.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
          >
            {favorites.has(selected.id) ? (
              <Heart size={22} className="text-error-500 fill-error-500" />
            ) : (
              <Heart size={22} className="text-gray-400" />
            )}
          </button>
        </div>

        <Card className="animate-fade-in">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="primary">{selected.collectionTitle}</Badge>
              {selected.grades.map((g) => (
                <span key={g} className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${GRADE_INFO[g].badgeClass}`}>
                  {GRADE_INFO[g].label}
                </span>
              ))}
              {selected.grades.length === 0 && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${GRADE_INFO.unknown.badgeClass}`}>
                  {GRADE_INFO.unknown.label}
                </span>
              )}
              <Badge variant="neutral">رقم {toArabicNumber(selected.arabicNumber)}</Badge>
            </div>

            {(grade === 'daif' || grade === 'mawdu') && (
              <div className="flex items-start gap-2 bg-error-50 dark:bg-error-900/20 rounded-xl p-3 border border-error-200 dark:border-error-800/40">
                <AlertTriangle size={18} className="text-error-500 shrink-0 mt-0.5" />
                <p className="text-xs text-error-700 dark:text-error-300 leading-relaxed">
                  تنبيه: درجة هذا الحديث في المصدر {GRADE_INFO[grade].label}، فلا يُحتجّ به في
                  الأحكام الشرعية.
                </p>
              </div>
            )}

            {grade === 'unknown' && (
              <div className="bg-gray-50 dark:bg-gray-800/20 rounded-xl p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  المصدر لم يذكر درجة لهذا الحديث — لم تُخمَّن ولا تُختلق درجة.
                </p>
              </div>
            )}

            <div>
              <p
                className="quran-text leading-loose text-primary-900 dark:text-primary-50 whitespace-pre-line"
                style={{ fontSize: 21, lineHeight: 2.3 }}
              >
                {selected.text}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-primary-100 pt-3 dark:border-primary-800">
              <button
                onClick={() => void copyHadith(selected)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 dark:bg-primary-800/50 dark:text-primary-200 dark:hover:bg-primary-800"
              >
                <Copy size={16} />
                {copiedHadithId === selected.id ? 'تم النسخ' : 'نسخ نص الحديث'}
              </button>
              {copyError && <p role="alert" className="text-xs text-error-600 dark:text-error-300">{copyError}</p>}
            </div>

            <div className="border-t border-primary-100 dark:border-primary-800 pt-3 space-y-1">
              {selected.sectionTitle && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium">الباب:</span>{' '}
                  <span dir="ltr">{selected.sectionTitle}</span>
                </p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                <span className="font-medium">المصدر:</span> {book?.titleAr} — {book?.authorAr}
              </p>
              {selected.graders.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium">الدرجات من:</span>{' '}
                  <span dir="ltr">{selected.graders.join('، ')}</span>
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ---- browse ----
  if (viewMode === 'browse') {
    const filteredBrowseSections = browseData?.sections.filter((section) =>
      section.title.toLocaleLowerCase().includes(browseSectionQuery.trim().toLocaleLowerCase()),
    ) ?? [];

    if (!browseCollection) {
      return (
        <div className="space-y-4 pb-4">
          <BackBar onBack={() => setViewMode('search')} />
          <div>
            <h2 className="text-xl font-bold text-primary-800 dark:text-primary-100">فهرس كتب الحديث</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              {toArabicNumber(HADITH_BOOKS.length)} مجموعات عربية متاحة، تضم{' '}
              {toArabicNumber(HADITH_BOOKS.reduce((sum, book) => sum + book.count, 0))} حديثاً بحسب بيانات المصدر.
              تظهر المجموعات المحفوظة دون اتصال، ويمكن تنزيل البقية من مكتبة المحتوى.
            </p>
          </div>

          {HADITH_CATEGORIES.map((category) => {
            const books = category.ids
              .map((id) => HADITH_BOOKS.find((book) => book.id === id))
              .filter((book): book is (typeof HADITH_BOOKS)[number] => book !== undefined);
            if (books.length === 0) return null;
            return (
              <section key={category.title} className="space-y-2">
                <h3 className="text-sm font-semibold text-primary-700 dark:text-primary-200">{category.title}</h3>
                {books.map((book) => {
                  const isInstalled = installed.includes(book.id);
                  return (
                    <Card
                      key={book.id}
                      onClick={() => isInstalled ? void openCollection(book.id) : openContentManager()}
                      className="flex items-center gap-3 hover:border-primary-300"
                    >
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                        isInstalled ? 'bg-success-100 dark:bg-success-900/30' : 'bg-primary-100 dark:bg-primary-800'
                      }`}>
                        {isInstalled
                          ? <BookText size={21} className="text-success-600 dark:text-success-400" />
                          : <Download size={20} className="text-primary-600 dark:text-gold-400" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-primary-800 dark:text-primary-100">{book.titleAr}</p>
                        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{book.authorAr}</p>
                        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                          {toArabicNumber(book.count)} حديث · {isInstalled ? 'متاح للتصفح دون إنترنت' : 'اضغط لعرض خيارات التنزيل'}
                        </p>
                      </div>
                      <ChevronLeft size={20} className="text-gray-300 shrink-0" />
                    </Card>
                  );
                })}
              </section>
            );
          })}
        </div>
      );
    }

    if (browseSection === null) {
      return (
        <div className="space-y-3 pb-4">
          <BackBar onBack={() => setBrowseCollection(null)} />
          <h2 className="text-xl font-bold text-primary-800 dark:text-primary-100">
            {getHadithBook(browseCollection)?.titleAr}
          </h2>

          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
              <Loader2 size={18} className="inline animate-spin ml-2" />
              جارٍ فتح الكتاب…
            </p>
          ) : browseError ? (
            <Card className="border-error-200 dark:border-error-800">
              <p className="text-sm text-error-700 dark:text-error-300">{browseError}</p>
              <button onClick={() => void openCollection(browseCollection)} className="mt-3 text-sm font-medium text-primary-600 dark:text-gold-400">
                إعادة المحاولة
              </button>
            </Card>
          ) : !browseData ? (
            <EmptyState icon={<BookText size={40} />} title="تعذّر عرض الكتاب" description="أعد المحاولة أو تحقق من اتصال الإنترنت." />
          ) : (
            <>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {toArabicNumber(browseData.count)} حديث في{' '}
                {toArabicNumber(browseData.sections.length)} باباً. تُعرض عناوين الأبواب بلغتها الأصلية كما وردت في المصدر.
              </p>
              <div className="relative">
                <Search size={17} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={browseSectionQuery}
                  onChange={(event) => setBrowseSectionQuery(event.target.value)}
                  placeholder="ابحث بعنوان الباب (بلغة المصدر)"
                  aria-label="البحث في أبواب الكتاب"
                  dir="auto"
                  className="w-full rounded-xl border border-primary-100 bg-white py-2.5 pr-10 pl-3 text-sm text-primary-800 placeholder:text-gray-400 focus:border-primary-400 focus:outline-hidden dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100"
                />
              </div>
              <div className="space-y-2">
                {filteredBrowseSections.map((section) => (
                  <Card
                    key={section.number}
                    onClick={() => {
                      setBrowseSection(section.number);
                      setBrowseHadithPage(1);
                    }}
                    className="flex items-center justify-between hover:border-primary-300"
                  >
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        الباب {section.number}
                      </p>
                      <p className="font-medium text-primary-800 dark:text-primary-100 text-sm" dir="ltr">
                        {section.title || '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="neutral">{toArabicNumber(section.count)}</Badge>
                      <ChevronLeft size={18} className="text-gray-300" />
                    </div>
                  </Card>
                  ))}
                {filteredBrowseSections.length === 0 && (
                  <EmptyState
                    icon={<Search size={36} />}
                    title="لا توجد أبواب مطابقة"
                    description="جرّب جزءاً آخر من عنوان الباب كما يظهر في المصدر."
                  />
                )}
              </div>
            </>
          )}
        </div>
      );
    }

    const sectionHadiths =
      browseData?.hadiths.filter((h) => h.section === browseSection) ?? [];
    const visibleSectionHadiths = sectionHadiths.slice(0, browseHadithPage * BROWSE_PAGE_SIZE);
    const sectionTitle = browseData?.sections.find((section) => section.number === browseSection)?.title;
    const hasMoreSectionHadiths = visibleSectionHadiths.length < sectionHadiths.length;

    return (
      <div className="space-y-3 pb-4">
        <BackBar onBack={() => {
          setBrowseSection(null);
          setBrowseHadithPage(1);
        }} />
        <div>
          <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">{browseData?.titleAr}</h2>
          {sectionTitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400" dir="ltr">{sectionTitle}</p>}
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            عرض {toArabicNumber(visibleSectionHadiths.length)} من {toArabicNumber(sectionHadiths.length)} حديثاً
          </p>
        </div>
        <div className="space-y-3">
          {visibleSectionHadiths.map((hadith) => (
            <Card
              key={hadith.id}
              onClick={() => {
                openHadith(hadith, 'browse');
              }}
              className="hover:border-primary-300"
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {(hadith.grades.length ? hadith.grades : ['unknown' as HadithGrade]).map((g) => (
                    <span
                      key={g}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${GRADE_INFO[g].badgeClass}`}
                    >
                      {g === 'unknown' ? 'غير مذكور بالمصدر' : GRADE_INFO[g].label}
                    </span>
                  ))}
                  <Badge variant="neutral">رقم {toArabicNumber(hadith.arabicNumber)}</Badge>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFavorite(hadith.id);
                  }}
                  aria-label={favorites.has(hadith.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                  className="shrink-0"
                >
                  <Heart
                    size={18}
                    className={
                      favorites.has(hadith.id)
                        ? 'text-error-500 fill-error-500'
                        : 'text-gray-300 dark:text-gray-600'
                    }
                  />
                </button>
              </div>
              <p className="quran-text rounded-xl border-r-2 border-gold-400 bg-primary-50/60 px-3 py-3 text-[17px] leading-[2.1] text-primary-900 dark:bg-primary-800/30 dark:text-primary-50 line-clamp-4 whitespace-pre-line">
                {hadith.text}
              </p>
            </Card>
          ))}
        </div>
        {hasMoreSectionHadiths && (
          <button
            onClick={() => setBrowseHadithPage((page) => page + 1)}
            className="w-full rounded-xl border border-primary-200 bg-white px-4 py-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-900/50 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            عرض ٣٠ حديثاً أخرى
          </button>
        )}
      </div>
    );
  }

  // ---- library ----
  if (viewMode === 'manager') {
    return (
      <div className="space-y-4 pb-4">
        <BackBar onBack={() => {
          setViewMode(managerReturnView);
          void refreshInstalled();
        }} />
        <ContentLibrary showTitle={false} />
      </div>
    );
  }

  // ---- search (default) ----
  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">
          مكتبة الأحاديث
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('browse')}
            className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-600 dark:text-gold-400"
            title="تصفح"
            aria-label="تصفح كتب الحديث"
          >
            <BookText size={20} />
          </button>
          <button
            onClick={openContentManager}
            className="w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-600 dark:text-gold-400"
            title="مكتبة المحتوى"
            aria-label="مكتبة المحتوى"
          >
            <Library size={20} />
          </button>
        </div>
      </div>

      <Card className="border-primary-100 bg-primary-50/70 dark:border-primary-800 dark:bg-primary-900/50">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600 dark:bg-primary-800 dark:text-gold-400">
            <BookText size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-primary-800 dark:text-primary-100">
              {toArabicNumber(installed.length)} من {toArabicNumber(HADITH_BOOKS.length)} مجموعات محفوظة
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-600 dark:text-gray-300">
              {toArabicNumber(HADITH_BOOKS.filter((book) => installed.includes(book.id)).reduce((sum, book) => sum + book.count, 0))} حديث متاح على جهازك.
              الفهرس يضم المجموعات التسع المنشورة في المصدر المتصل بالتطبيق، وليس حصرًا لكل كتب وروايات الحديث.
            </p>
            <button
              onClick={() => setViewMode('browse')}
              className="mt-2 text-sm font-semibold text-primary-600 hover:text-primary-700 dark:text-gold-400"
            >
              استعراض فهرس الكتب
            </button>
          </div>
        </div>
      </Card>

      <div className="relative">
        <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث في الكتب المحفوظة على جهازك..."
          className="w-full bg-white dark:bg-primary-900/40 border border-primary-100 dark:border-primary-800 rounded-xl py-2.5 pr-10 pl-10 text-sm text-primary-800 dark:text-primary-100 placeholder:text-gray-400 focus:outline-hidden focus:border-primary-400"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="مسح البحث"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setSahihOnly(!sahihOnly)}
          aria-pressed={sahihOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
            sahihOnly
              ? 'bg-success-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
          }`}
        >
          <Filter size={14} />
          وردت له درجة صحيح
        </button>
        <button
          onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
          aria-pressed={showFavoritesOnly}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-smooth ${
            showFavoritesOnly
              ? 'bg-error-500 text-white'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
          }`}
        >
          <Heart size={14} className={showFavoritesOnly ? 'fill-white' : ''} />
          المفضلة
        </button>
      </div>

      {installed.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
          <FilterChip
            label="الكل"
            active={collectionFilter === 'all'}
            onClick={() => setCollectionFilter('all')}
          />
          {/* The default collection's chip leads; the rest follow catalogue order. */}
          {HADITH_BOOKS.filter((b) => installed.includes(b.id) && b.id === HADITH_OF_DAY_BOOK)
            .concat(HADITH_BOOKS.filter((b) => installed.includes(b.id) && b.id !== HADITH_OF_DAY_BOOK))
            .map((book) => (
            <FilterChip
              key={book.id}
              label={book.titleAr}
              active={collectionFilter === book.id}
              onClick={() => setCollectionFilter(book.id)}
            />
          ))}
        </div>
      )}

      {installed.length === 0 ? (
        <EmptyState
          icon={<Library size={48} />}
          title="لم تحمّل أي كتاب حديث بعد"
          description="اختر كتاباً من الفهرس ثم نزّله. بعد التنزيل يمكنك البحث والتصفح دون اتصال."
          action={
            <button
              onClick={openContentManager}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-smooth"
            >
              <Library size={16} />
              فتح مكتبة المحتوى
            </button>
          }
        />
      ) : (
        <>
          {searchError && (
            <Card className="border-error-200 bg-error-50 dark:border-error-800 dark:bg-error-900/20">
              <div className="flex items-start gap-2 text-sm text-error-700 dark:text-error-300">
                <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                <p>{searchError}</p>
              </div>
            </Card>
          )}

          {!query.trim() && !showFavoritesOnly && !searching && (
            <Card className="border-dashed bg-gray-50 dark:bg-gray-800/20">
              <div className="flex items-start gap-3">
                <Search size={19} className="mt-0.5 shrink-0 text-primary-500 dark:text-gold-400" />
                <div>
                  <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">أحاديث الكتب المحفوظة</p>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    تظهر الأحاديث تلقائياً من الكتب المحفوظة. ابحث بكلمة أو اختر كتاباً لتصفية النتائج؛ البحث يتجاهل التشكيل.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {(installed.length > 0 || searching) && (
            <p aria-live="polite" className="text-xs text-gray-400 dark:text-gray-500">
              {searching ? 'جارٍ البحث…' : `${toArabicNumber(visibleHits.length)} نتيجة معروضة${hasMore ? ' — توجد نتائج أخرى' : ''}`}
            </p>
          )}

          {visibleHits.length === 0 && (searching || query.trim() || showFavoritesOnly || installed.length > 0) ? (
            <EmptyState
              icon={searching ? <Loader2 size={40} className="animate-spin" /> : <BookText size={48} />}
              title={searching ? 'جارٍ البحث' : 'لا توجد أحاديث مطابقة'}
              description={
                searching
                  ? 'جارٍ تحميل الأحاديث المحفوظة على هذا الجهاز.'
                  : query.trim()
                  ? 'جرّب كلمات أخرى — البحث لا يتأثر لتشكيل الحروف'
                  : showFavoritesOnly
                    ? 'لا توجد مفضلات في الكتب المحفوظة على هذا الجهاز'
                    : sahihOnly
                      ? 'لم تُسجّل بيانات المصدر درجة صحيح لأحاديث هذا الكتاب.'
                      : 'تعذّر العثور على أحاديث في المجموعة المحددة.'
              }
            />
          ) : visibleHits.length > 0 ? (
            <div className="space-y-3">
              {visibleHits.map((hadith) => (
                <Card
                  key={hadith.id}
                  onClick={() => {
                    openHadith(hadith, 'search');
                  }}
                  className="hover:border-primary-300 transition-smooth animate-slide-up"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="primary">{hadith.collectionTitle}</Badge>
                        {(hadith.grades.length ? hadith.grades : ['unknown' as HadithGrade]).map((g) => (
                          <span key={g} className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${GRADE_INFO[g].badgeClass}`}>
                            {g === 'unknown' ? 'غير مذكور بالمصدر' : GRADE_INFO[g].label}
                          </span>
                        ))}
                      </div>
                      {hadith.sectionTitle && (
                        <p className="text-xs text-gray-500 dark:text-gray-400" dir="ltr">{hadith.sectionTitle}</p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFavorite(hadith.id);
                      }}
                      aria-label={favorites.has(hadith.id) ? 'إزالة من المفضلة' : 'إضافة إلى المفضلة'}
                      className="shrink-0"
                    >
                      <Heart
                        size={18}
                        className={
                          favorites.has(hadith.id)
                            ? 'text-error-500 fill-error-500'
                            : 'text-gray-300 dark:text-gray-600'
                        }
                      />
                    </button>
                  </div>
                  <p className="quran-text rounded-xl border-r-2 border-gold-400 bg-primary-50/60 px-3 py-3 text-[17px] leading-[2.1] text-primary-900 dark:bg-primary-800/30 dark:text-primary-50 line-clamp-4 whitespace-pre-line">
                    {hadith.text}
                  </p>
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    رقم {toArabicNumber(hadith.arabicNumber)} · {hadith.section ? `باب ${toArabicNumber(hadith.section)}` : 'دون تبويب في المصدر'}
                  </p>
                </Card>
              ))}
              {hasMore && (
                <button
                  onClick={() => setSearchPage((page) => page + 1)}
                  disabled={searching}
                  className="w-full rounded-xl border border-primary-200 bg-white px-4 py-3 text-sm font-semibold text-primary-700 transition-smooth hover:bg-primary-50 disabled:opacity-50 dark:border-primary-800 dark:bg-primary-900/50 dark:text-primary-200 dark:hover:bg-primary-800"
                >
                  {searching ? 'جارٍ تحميل المزيد…' : 'عرض ٥٠ نتيجة أخرى'}
                </button>
              )}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center justify-between sticky top-0 z-30 bg-surface-light dark:bg-surface-dark/95 backdrop-blur-lg py-2 -mx-4 px-4 border-b border-primary-100 dark:border-primary-800/30">
      <button onClick={onBack} className="flex items-center gap-1 text-primary-600 dark:text-gold-400">
        <ChevronRight size={20} />
        <span className="text-sm">رجوع</span>
      </button>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-smooth flex-shrink-0 ${
        active
          ? 'bg-primary-600 text-white'
          : 'bg-primary-50 dark:bg-primary-800/40 text-primary-600 dark:text-primary-200'
      }`}
    >
      {label}
    </button>
  );
}