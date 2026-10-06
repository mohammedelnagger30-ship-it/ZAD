import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Bookmark,
  X,
  ZoomIn,
  ZoomOut,
  Moon,
  Sun,
  List,
  BookOpen,
  ScrollText,
} from 'lucide-react';
import { MushafPage } from '@/components/mushaf/MushafPage';
import { TafsirBottomSheet } from '@/components/TafsirBottomSheet';
import { AudioRecitationPlayer } from '@/components/AudioRecitationPlayer';
import {
  SURAHS,
  JUZ_INFO,
  getSurah,
  getAyahPage,
  getJuzForPage,
  getSurahsForPage,
  toArabicNumber,
} from '@/data/surahs';
import { getTotalPages, HIZB_INFO, getHizbForPage } from '@/data/mushafPages';
import { loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { db, type Settings } from '@/db/database';

interface MushafReaderProps {
  settings: Settings;
  initialPage?: number;
  onClose: () => void;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2;
/** Pages are the smallest useful jump target; below this the text stops being readable. */
const PAGE_KEYBOARD_STEP = 10;

export function MushafReader({ settings, initialPage = 1, onClose }: MushafReaderProps) {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [readingScale, setReadingScale] = useState(1);
  const [lineSpacing, setLineSpacing] = useState(1);
  const [wordSpacing, setWordSpacing] = useState(0);
  const [readingMode, setReadingMode] = useState(false);
  const [nightMode, setNightMode] = useState(false);
  const [paperMode, setPaperMode] = useState(false);
  const [showJumpTo, setShowJumpTo] = useState(false);
  const [jumpTarget, setJumpTarget] = useState<'page' | 'surah' | 'juz' | 'hizb'>('page');
  const [bookmarkedPages, setBookmarkedPages] = useState<Set<number>>(new Set());
  const [selectedReadingAyah, setSelectedReadingAyah] = useState<{ surahId: number; ayahNumber: number } | null>(null);
  const [tafsirAyah, setTafsirAyah] = useState<{ surahId: number; ayahNumber: number } | null>(null);
  const [reciterId, setReciterId] = useState(loadPreferredReciter);

  const totalPages = getTotalPages();

  // Touch swipe handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchEndRef = useRef<{ x: number; y: number } | null>(null);

  const minSwipeDistance = 50;

  // Load persisted page bookmarks. Component state would lose them on every close.
  useEffect(() => {
    let cancelled = false;
    db.pageBookmarks
      .toArray()
      .then((rows) => {
        if (!cancelled) setBookmarkedPages(new Set(rows.map((r) => r.page)));
      })
      .catch(() => {
        /* A failed read only costs the bookmark marks, so it must not break the reader. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      if (page >= 1 && page <= totalPages) {
        setCurrentPage(page);
        setShowJumpTo(false);
      }
    },
    [totalPages],
  );

  // Page turns are the primary interaction here, so bind them to the keyboard as well.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showJumpTo) return;
      // In an RTL layout the left arrow advances, matching the on-screen button order.
      if (e.key === 'ArrowLeft') goToPage(currentPage + (e.shiftKey ? PAGE_KEYBOARD_STEP : 1));
      else if (e.key === 'ArrowRight') goToPage(currentPage - (e.shiftKey ? PAGE_KEYBOARD_STEP : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, goToPage, showJumpTo]);

  // Touch swipe handling for page navigation
  useEffect(() => {
    const onTouchStart = (e: Event) => {
      const touchEvent = e as TouchEvent;
      touchEndRef.current = null;
      touchStartRef.current = {
        x: touchEvent.changedTouches[0].screenX,
        y: touchEvent.changedTouches[0].screenY,
      };
    };

    const onTouchMove = (e: Event) => {
      const touchEvent = e as TouchEvent;
      touchEndRef.current = {
        x: touchEvent.changedTouches[0].screenX,
        y: touchEvent.changedTouches[0].screenY,
      };
    };

    const onTouchEnd = () => {
      if (!touchStartRef.current || !touchEndRef.current) return;

      const deltaX = touchStartRef.current.x - touchEndRef.current.x;
      const deltaY = Math.abs(touchStartRef.current.y - touchEndRef.current.y);

      // Only handle horizontal swipes (ignore vertical scrolls)
      if (deltaY > minSwipeDistance) return;

      if (deltaX > minSwipeDistance) {
        // Swipe left -> next page (RTL: left swipe moves forward)
        goToPage(currentPage + 1);
      } else if (deltaX < -minSwipeDistance) {
        // Swipe right -> previous page
        goToPage(currentPage - 1);
      }

      touchStartRef.current = null;
      touchEndRef.current = null;
    };

    const container = document.querySelector('.mushaf-page');
    if (container) {
      container.addEventListener('touchstart', onTouchStart, { passive: true });
      container.addEventListener('touchmove', onTouchMove, { passive: true });
      container.addEventListener('touchend', onTouchEnd);
    }

    return () => {
      if (container) {
        container.removeEventListener('touchstart', onTouchStart);
        container.removeEventListener('touchmove', onTouchMove);
        container.removeEventListener('touchend', onTouchEnd);
      }
    };
  }, [currentPage, goToPage]);

  const toggleBookmark = useCallback((page: number) => {
    setBookmarkedPages((prev) => {
      const updated = new Set(prev);
      if (updated.has(page)) {
        updated.delete(page);
        void db.pageBookmarks.delete(page).catch(() => {});
      } else {
        updated.add(page);
        void db.pageBookmarks.put({ page, createdAt: Date.now() }).catch(() => {});
      }
      return updated;
    });
  }, []);

  /** Step the open tafsir sheet to a neighbouring ayah, crossing surah and page breaks. */
  const stepTafsirAyah = useCallback(
    (delta: number) => {
      if (!tafsirAyah) return;
      const current = getSurah(tafsirAyah.surahId);
      if (!current) return;

      let surahId = current.id;
      let ayahNumber = tafsirAyah.ayahNumber + delta;

      if (ayahNumber < 1) {
        const prev = getSurah(current.id - 1);
        if (!prev) return; // already at 1:1
        surahId = prev.id;
        ayahNumber = prev.ayahCount;
      } else if (ayahNumber > current.ayahCount) {
        const next = getSurah(current.id + 1);
        if (!next) return; // already at the last ayah
        surahId = next.id;
        ayahNumber = 1;
      }

      const target = getSurah(surahId);
      if (!target) return;
      setTafsirAyah({ surahId, ayahNumber });
      // Follow the reader to the page the ayah is actually printed on.
      goToPage(getAyahPage(target, ayahNumber));
    },
    [tafsirAyah, goToPage],
  );

  // `getSurahsForPage` is the authority on which surahs a page carries; the estimate in
  // the old header (ayahs/15 pages per surah) disagreed with it, so the header could name
  // a surah that was not printed on the page being read.
  const surahsOnPage = useMemo(() => getSurahsForPage(currentPage), [currentPage]);
  const currentJuz = useMemo(() => getJuzForPage(currentPage), [currentPage]);
  const currentHizb = useMemo(() => getHizbForPage(currentPage), [currentPage]);
  const primarySurah = useMemo(() => {
    if (selectedReadingAyah) return getSurah(selectedReadingAyah.surahId);
    return surahsOnPage[0] ?? getSurah(1) ?? null;
  }, [selectedReadingAyah, surahsOnPage]);

  const isBookmarked = bookmarkedPages.has(currentPage);
  const zoomPercent = Math.round(zoom * 100);
  const effectiveFontSize = Math.round(settings.fontSize * zoom * readingScale);

  return (
    <div className={`fixed inset-0 z-[60] flex flex-col ${nightMode ? 'bg-[#0b0906]' : 'bg-surface-light dark:bg-surface-dark'}`}>
      {/* Top bar */}
      <div className={`flex items-center justify-between px-3 py-2.5 border-b ${nightMode ? 'border-[#2a2317] bg-[#0b0906]' : 'border-primary-100 dark:border-primary-800 bg-white dark:bg-primary-900'}`}>
        <button
          onClick={onClose}
          aria-label="إغلاق المصحف"
          className={`w-9 h-9 rounded-lg flex items-center justify-center ${nightMode ? 'text-primary-300' : 'text-primary-600 dark:text-gold-400'}`}
        >
          <X size={20} />
        </button>

        <div className="text-center min-w-0 px-2">
          <p className={`text-sm font-bold truncate ${nightMode ? 'text-[#e7dcc0]' : 'text-primary-800 dark:text-primary-100'}`}>
            {surahsOnPage.length > 0
              ? surahsOnPage.map((s) => s.name).join(' · ')
              : `الجزء ${toArabicNumber(1 + Math.floor((currentPage - 1) / 20))}`}
          </p>
          <p className={`text-[11px] ${nightMode ? 'text-[#a89877]' : 'text-gray-500 dark:text-gray-400'}`}>
            الصفحة {toArabicNumber(currentPage)} من {toArabicNumber(totalPages)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setReadingMode(!readingMode)}
            aria-label={readingMode ? 'إغلاق القراءة الهادئة' : 'فتح القراءة الهادئة'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${readingMode ? 'bg-[#d8c79d] text-[#4f3a18]' : nightMode ? 'bg-[#241d12] text-primary-300' : 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'}`}
          >
            <BookOpen size={16} />
          </button>
          <button
            onClick={() => setPaperMode(!paperMode)}
            aria-label={paperMode ? 'إيقاف الوضع الورقي' : 'تفعيل الوضع الورقي'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${paperMode ? 'bg-[#d8c79d] text-[#4f3a18]' : nightMode ? 'bg-[#241d12] text-primary-300' : 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'}`}
          >
            <ScrollText size={16} />
          </button>
          <button
            onClick={() => toggleBookmark(currentPage)}
            aria-label={isBookmarked ? 'إزالة العلامة من هذه الصفحة' : 'حفظ هذه الصفحة'}
            aria-pressed={isBookmarked}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${isBookmarked ? 'bg-gold-500 text-white' : nightMode ? 'bg-[#241d12] text-primary-300' : 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'}`}
          >
            <Bookmark size={16} className={isBookmarked ? 'fill-current' : ''} />
          </button>
          <button
            onClick={() => setNightMode(!nightMode)}
            aria-label={nightMode ? 'الوضع النهاري' : 'الوضع الليلي'}
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${nightMode ? 'bg-[#241d12] text-gold-400' : 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'}`}
          >
            {nightMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>

      <div className="border-b px-3 py-2.5">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2 text-[11px] sm:text-xs">
          <div className={`rounded-xl px-2.5 py-1.5 ${nightMode ? 'bg-[#17120d] text-[#d8c69d]' : 'bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-100'}`}>
            <span className="opacity-70">الجزء</span>
            <span className="mr-1 font-semibold">{toArabicNumber(currentJuz)}</span>
          </div>
          <div className={`rounded-xl px-2.5 py-1.5 ${nightMode ? 'bg-[#17120d] text-[#d8c69d]' : 'bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-100'}`}>
            <span className="opacity-70">الحزب</span>
            <span className="mr-1 font-semibold">{toArabicNumber(currentHizb)}</span>
          </div>
          <div className={`rounded-xl px-2.5 py-1.5 ${nightMode ? 'bg-[#17120d] text-[#d8c69d]' : 'bg-primary-50 text-primary-700 dark:bg-primary-800 dark:text-primary-100'}`}>
            <span className="opacity-70">الصفحة</span>
            <span className="mr-1 font-semibold">{toArabicNumber(currentPage)}</span>
          </div>
        </div>
      </div>

      {/* Page */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 touch-pan-y">
        {/* Paper mode sizes the sheet itself, so it must not be clamped to the reading
            column — at zoom 1 the sheet already fits, and above that the reader scrolls. */}
        <div className={paperMode ? 'mx-auto overflow-x-auto' : 'mx-auto max-w-2xl'}>
          <MushafPage
            page={currentPage}
            fontSize={effectiveFontSize}
            night={nightMode}
            paper={paperMode}
            paperZoom={zoom}
            lineHeight={1.9 + (lineSpacing - 1) * 0.55}
            letterSpacing={0.01 + Math.max(0, lineSpacing - 1) * 0.01}
            wordSpacing={wordSpacing}
            onAyahPress={(surahId, ayahNumber) => {
              setSelectedReadingAyah({ surahId, ayahNumber });
              setTafsirAyah({ surahId, ayahNumber });
            }}
            activeAyah={tafsirAyah}
          />
        </div>
      </div>

      {/* Zoom + tools */}
      <div className={`shrink-0 border-t px-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-2.5 ${
        nightMode ? 'border-[#2a2317] bg-[#0b0906]' : 'border-primary-100 dark:border-primary-800 bg-white dark:bg-primary-900'
      }`}>
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-all disabled:opacity-35 ${
              nightMode ? 'bg-[#241d12] text-primary-200 hover:bg-[#302718]' : 'bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
            }`}
          >
            التالية <ChevronLeft size={17} />
          </button>
          <span className={`min-w-[4.75rem] rounded-xl px-2 py-2 text-center text-xs font-semibold tabular-nums ${
            nightMode ? 'bg-[#161208] text-[#d6c7a5]' : 'bg-gray-50 text-gray-600 dark:bg-primary-950 dark:text-gray-300'
          }`}>
            {toArabicNumber(currentPage)} / {toArabicNumber(totalPages)}
          </span>
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className={`inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-all disabled:opacity-35 ${
              nightMode ? 'bg-[#241d12] text-primary-200 hover:bg-[#302718]' : 'bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
            }`}
          >
            <ChevronRight size={17} /> السابقة
          </button>
        </div>

        <div className="mx-auto mt-2 flex max-w-xl items-center justify-between gap-2">
          <div className={`inline-flex items-center gap-1 rounded-xl p-1 ${
            nightMode ? 'bg-[#161208]' : 'bg-gray-50 dark:bg-primary-950'
          }`}>
            <button
              onClick={() => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10))}
              disabled={zoom <= ZOOM_MIN}
              aria-label="تصغير الخط"
              className={`flex h-8 w-9 items-center justify-center rounded-lg disabled:opacity-35 ${
                nightMode ? 'text-primary-300 hover:bg-[#241d12]' : 'text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-800'
              }`}
            >
              <ZoomOut size={16} />
            </button>
            <span className={`min-w-10 text-center text-[11px] font-medium tabular-nums ${
              nightMode ? 'text-[#a89877]' : 'text-gray-500 dark:text-gray-400'
            }`}>
              {toArabicNumber(zoomPercent)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10))}
              disabled={zoom >= ZOOM_MAX}
              aria-label="تكبير الخط"
              className={`flex h-8 w-9 items-center justify-center rounded-lg disabled:opacity-35 ${
                nightMode ? 'text-primary-300 hover:bg-[#241d12]' : 'text-primary-700 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-800'
              }`}
            >
              <ZoomIn size={16} />
            </button>
          </div>
          <button
            onClick={() => setShowJumpTo(!showJumpTo)}
            aria-expanded={showJumpTo}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-all ${
              showJumpTo
                ? 'bg-primary-600 text-white shadow-sm'
                : nightMode
                  ? 'bg-[#241d12] text-primary-200 hover:bg-[#302718]'
                  : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
            }`}
          >
            <List size={16} /> انتقال إلى
          </button>
        </div>
      </div>

      {readingMode && primarySurah && (
        <div className={`absolute inset-x-3 bottom-24 z-40 rounded-3xl border p-4 shadow-2xl backdrop-blur-sm ${nightMode ? 'border-[#2a2317] bg-[#161208]/95 text-primary-100' : 'border-primary-100 bg-white/95 text-primary-900 dark:border-primary-800 dark:bg-primary-950/90 dark:text-primary-100'}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-primary-400">قراءة هادئة</p>
              <h3 className="text-sm font-bold">{primarySurah.name}</h3>
            </div>
            <button
              onClick={() => setReadingMode(false)}
              className="rounded-lg bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 dark:bg-primary-800 dark:text-primary-200"
            >
              إغلاق
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <span>حجم الخط</span>
              <input
                type="range"
                min={0.85}
                max={1.35}
                step={0.05}
                value={readingScale}
                onChange={(e) => setReadingScale(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
            </label>
            <label className="space-y-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <span>تباعد السطور</span>
              <input
                type="range"
                min={0.9}
                max={1.35}
                step={0.05}
                value={lineSpacing}
                onChange={(e) => setLineSpacing(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
            </label>
            <label className="space-y-1 text-[11px] font-medium text-gray-600 dark:text-gray-300">
              <span>مسافة الكلمات</span>
              <input
                type="range"
                min={0}
                max={0.3}
                step={0.02}
                value={wordSpacing}
                onChange={(e) => setWordSpacing(Number(e.target.value))}
                className="w-full accent-primary-600"
              />
            </label>
          </div>

          <div className="mt-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-3 dark:border-primary-800 dark:bg-primary-900/40">
            <AudioRecitationPlayer
              surah={primarySurah}
              reciterId={reciterId}
              onReciterChange={(nextReciterId) => {
                setReciterId(nextReciterId);
                savePreferredReciter(nextReciterId);
              }}
              onShowTafsir={(ayahNumber) => setTafsirAyah({ surahId: primarySurah.id, ayahNumber })}
            >
              {({ selectedAyah, isPlaying, selectAyah, playSelectedAyah }) => (
                <div className="flex flex-col gap-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (selectedAyah !== null) {
                          const target = Math.max(1, selectedAyah - 1);
                          selectAyah(target);
                        }
                      }}
                      className="rounded-lg border border-primary-200 bg-white px-2 py-1.5 text-primary-700 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-200"
                    >
                      الآية السابقة
                    </button>
                    <button
                      onClick={() => {
                        if (selectedAyah !== null) {
                          const target = Math.min(primarySurah.ayahCount, selectedAyah + 1);
                          selectAyah(target);
                        }
                      }}
                      className="rounded-lg border border-primary-200 bg-white px-2 py-1.5 text-primary-700 dark:border-primary-700 dark:bg-primary-800 dark:text-primary-200"
                    >
                      الآية التالية
                    </button>
                  </div>

                  <button
                    onClick={playSelectedAyah}
                    className="rounded-xl bg-primary-600 px-3 py-2 font-semibold text-white"
                  >
                    {isPlaying ? 'إيقاف/متابعة' : `استمع: ${selectedAyah ? toArabicNumber(selectedAyah) : 'الآية الحالية'}`}
                  </button>
                </div>
              )}
            </AudioRecitationPlayer>
          </div>
        </div>
      )}

      {/* Jump-to panel */}
      {showJumpTo && (
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl shadow-xl p-5 max-h-[70vh] overflow-y-auto ${nightMode ? 'bg-[#161208] text-primary-100' : 'bg-white dark:bg-primary-900'}`}
          dir="rtl"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-primary-800 dark:text-primary-100">انتقال إلى</h3>
            <button onClick={() => setShowJumpTo(false)} aria-label="إغلاق" className="text-gray-400">
              <X size={20} />
            </button>
          </div>

          <div className="flex gap-2 mb-4">
            {(['page', 'surah', 'juz', 'hizb'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setJumpTarget(t)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                  jumpTarget === t
                    ? 'bg-primary-600 text-white'
                    : 'bg-primary-50 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
                }`}
              >
                {t === 'page' ? 'صفحة' : t === 'surah' ? 'سورة' : t === 'juz' ? 'جزء' : 'حزب'}
              </button>
            ))}
          </div>

          {jumpTarget === 'page' && (
            <div className="grid grid-cols-8 gap-1.5">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  aria-label={`الصفحة ${toArabicNumber(p)}`}
                  className={`relative aspect-square rounded-lg text-xs font-medium tabular-nums ${
                    p === currentPage
                      ? 'bg-primary-600 text-white'
                      : 'bg-primary-50 dark:bg-primary-800 text-primary-700 dark:text-primary-200'
                  }`}
                >
                  {toArabicNumber(p)}
                  {bookmarkedPages.has(p) && (
                    <span className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-gold-500" />
                  )}
                </button>
              ))}
            </div>
          )}

          {jumpTarget === 'surah' && (
            <div className="grid grid-cols-3 gap-2">
              {SURAHS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => goToPage(s.pageStart)}
                  className={`p-2 rounded-lg text-center ${nightMode ? 'bg-[#241d12] hover:bg-[#2f2617]' : 'bg-primary-50 dark:bg-primary-800 hover:bg-primary-100 dark:hover:bg-primary-700'}`}
                >
                  <p className="text-sm font-medium text-primary-800 dark:text-primary-100">{s.name}</p>
                  <p className="text-xs text-gray-400">صفحة {toArabicNumber(s.pageStart)}</p>
                </button>
              ))}
            </div>
          )}

          {jumpTarget === 'juz' && (
            <div className="grid grid-cols-3 gap-2">
              {JUZ_INFO.map((j) => (
                <button
                  key={j.id}
                  onClick={() => goToPage(j.startPage)}
                  className={`p-2 rounded-lg text-center ${nightMode ? 'bg-[#241d12] hover:bg-[#2f2617]' : 'bg-primary-50 dark:bg-primary-800 hover:bg-primary-100 dark:hover:bg-primary-700'}`}
                >
                  <p className="text-sm font-medium text-primary-800 dark:text-primary-100">{j.name}</p>
                  <p className="text-xs text-gray-400">صفحة {toArabicNumber(j.startPage)}</p>
                </button>
              ))}
            </div>
          )}

          {jumpTarget === 'hizb' && (
            <div className="grid grid-cols-3 gap-2">
              {HIZB_INFO.map((h) => (
                <button
                  key={h.id}
                  onClick={() => goToPage(h.startPage)}
                  className={`p-2 rounded-lg text-center ${nightMode ? 'bg-[#241d12] hover:bg-[#2f2617]' : 'bg-primary-50 dark:bg-primary-800 hover:bg-primary-100 dark:hover:bg-primary-700'}`}
                >
                  <p className="text-sm font-medium text-primary-800 dark:text-primary-100">{h.name}</p>
                  <p className="text-xs text-gray-400">صفحة {toArabicNumber(h.startPage)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tafsirAyah && (
        <TafsirBottomSheet
          surahId={tafsirAyah.surahId}
          ayahNumber={tafsirAyah.ayahNumber}
          onClose={() => setTafsirAyah(null)}
          onNavigateAyah={stepTafsirAyah}
        />
      )}
    </div>
  );
}
