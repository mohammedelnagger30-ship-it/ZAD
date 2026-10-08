import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import type { CSSProperties } from 'react';
import { Search, Eye, EyeOff, ChevronLeft, ChevronRight, Type, BookOpen, Layers, BookText, Pause, Play, X } from 'lucide-react';
import { Card, Button, Badge } from '@/components/ui';
import { SURAHS, JUZ_INFO, TOTAL_QURAN_PAGES, getSurah, getAyahPage, getJuzForPage, toArabicNumber, type SurahMeta } from '@/data/surahs';
import { getAyahs, hasFullText, type AyahText } from '@/data/quranText';
import { getHizbForPage, SAJDAH_AYAHS } from '@/data/mushafPages';
import { db, type Bookmark as BookmarkType, type Settings } from '@/db/database';
import { TafsirBottomSheet } from '@/components/TafsirBottomSheet';
import { AudioRecitationPlayer } from '@/components/AudioRecitationPlayer';
import { loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { MushafReader } from '@/screens/MushafReader';
import { MushafFrameDecoration } from '@/components/mushaf/MushafPage';
import { splitBasmala } from '@/utils/basmala';

interface QuranScreenProps {
  settings: Settings;
}

type BrowseMode = 'surah' | 'juz' | 'page';
type ViewMode = 'list' | 'reader' | 'hifz' | 'mushaf';
type RevelationFilter = 'all' | 'meccan' | 'medinan';

const QURAN_READER_STORAGE_KEY = 'zad:quran-reader-state';

function loadSavedReaderState() {
  try {
    const raw = localStorage.getItem(QURAN_READER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      viewMode?: ViewMode;
      surahId?: number;
      fromAyah?: number;
      toAyah?: number | null;
      mushafPage?: number;
    };

    const surah = parsed.surahId ? getSurah(parsed.surahId) : null;
    return {
      viewMode: parsed.viewMode ?? 'list',
      surah,
      fromAyah: parsed.fromAyah ?? 1,
      toAyah: parsed.toAyah ?? null,
      mushafPage: parsed.mushafPage ?? 1,
    };
  } catch {
    return null;
  }
}

export function QuranScreen({ settings }: QuranScreenProps) {
  const savedState = useMemo(loadSavedReaderState, []);
  const [browseMode, setBrowseMode] = useState<BrowseMode>('surah');
  const [revelationFilter, setRevelationFilter] = useState<RevelationFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>(savedState?.viewMode ?? 'list');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSurah, setSelectedSurah] = useState<SurahMeta | null>(savedState?.surah ?? null);
  const [fromAyah, setFromAyah] = useState(savedState?.fromAyah ?? 1);
  const [toAyah, setToAyah] = useState<number | null>(savedState?.toAyah ?? null);
  const [hideText, setHideText] = useState(false);
  const [hideWordByWord, setHideWordByWord] = useState(false);
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [tafsirAyah, setTafsirAyah] = useState<{ surahId: number; ayah: number } | null>(null);
  const [mushafPage, setMushafPage] = useState(savedState?.mushafPage ?? 1);
  const [reciterId, setReciterId] = useState(loadPreferredReciter);

  useEffect(() => {
    try {
      const payload = {
        viewMode,
        surahId: selectedSurah?.id ?? null,
        fromAyah,
        toAyah,
        mushafPage,
      };
      localStorage.setItem(QURAN_READER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // LocalStorage is best-effort and must never break the reader.
    }
  }, [fromAyah, mushafPage, selectedSurah, toAyah, viewMode]);

  const loadBookmarks = useCallback(async () => {
    const bms = await db.bookmarks.toArray();
    setBookmarks(bms);
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const bookmarkedKeys = useMemo(
    () => new Set(bookmarks.map((b) => `${b.surahId}:${b.ayahNumber}`)),
    [bookmarks]
  );

  // Filtered surah list
  const filteredSurahs = useMemo(() => {
    const q = searchQuery.trim().replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    return SURAHS.filter(
      (surah) =>
        (revelationFilter === 'all' || surah.revelationType === revelationFilter) &&
        (!q ||
          surah.name.includes(q) ||
          surah.nameLatin.toLowerCase().includes(q.toLowerCase()) ||
          String(surah.id) === q)
    );
  }, [searchQuery, revelationFilter]);

  const openSurah = (surah: SurahMeta) => {
    setSelectedSurah(surah);
    setFromAyah(1);
    setToAyah(null);
    setTafsirAyah(null);
    setViewMode('reader');
  };

  const openHifzMode = (surah: SurahMeta) => {
    setSelectedSurah(surah);
    setFromAyah(1);
    setToAyah(surah.ayahCount);
    setTafsirAyah(null);
    setViewMode('hifz');
  };

  // Opening a juz means "take me to where this juz starts", i.e. its first page. Resolving
  // by "first surah beginning in the juz" would be wrong: many juz start mid-surah, so that
  // would skip the opening pages (juz 4 starts on page 62, inside Al-Imran, but its first
  // boundary is Al-Nisa on 77). Deriving from the overlap list would be wrong the other way
  // — juz 30 would open Al-Mursalat (page 580, still juz 29) instead of An-Naba (582).
  const openJuz = (juzId: number) => {
    const juz = JUZ_INFO.find((j) => j.id === juzId);
    if (juz) openPage(juz.startPage);
  };

  const openPage = (page: number) => {
    setMushafPage(page);
    setViewMode('mushaf');
  };

  /** Step through ayahs while the tafsir sheet is open, rolling over into the next surah. */
  const stepTafsirAyah = useCallback((delta: number) => {
    setTafsirAyah((prev) => {
      if (!prev) return prev;
      const meta = getSurah(prev.surahId);
      if (!meta) return prev;
      const next = prev.ayah + delta;
      if (next < 1) return prev;
      if (next > meta.ayahCount) {
        const nextSurah = getSurah(prev.surahId + 1);
        return nextSurah ? { surahId: nextSurah.id, ayah: 1 } : prev;
      }
      return { surahId: prev.surahId, ayah: next };
    });
  }, []);

  const toggleBookmark = async (surahId: number, ayahNumber: number) => {
    const key = `${surahId}:${ayahNumber}`;
    const found = bookmarks.find((b) => `${b.surahId}:${b.ayahNumber}` === key);
    if (found) {
      await db.bookmarks.delete(found.id!);
    } else {
      await db.bookmarks.add({ surahId, ayahNumber, createdAt: Date.now() });
    }
    loadBookmarks();
  };

  const changeReciter = (id: string) => {
    setReciterId(id);
    savePreferredReciter(id);
  };

  // ---- LIST VIEW ----
  if (viewMode === 'list') {
    return (
      <div className="space-y-6 pb-6">
        {/* Enhanced Hero Section */}
        <section className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 px-6 py-6 text-white shadow-2xl sm:px-8 sm:py-8">
          {/* Decorative patterns */}
          <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full border-4 border-white/5" />
          <div className="pointer-events-none absolute -right-10 top-10 -z-10 h-40 w-40 rounded-full border-4 border-white/5" />
          <div className="pointer-events-none absolute right-1/3 bottom-0 -z-10 h-48 w-48 rounded-full border-4 border-white/5 opacity-50" />
          <BookOpen className="pointer-events-none absolute -right-8 bottom-0 -z-10 h-40 w-40 rotate-12 text-white/[0.05] sm:right-10 sm:h-52 sm:w-52" />

          <div className="relative flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 backdrop-blur-sm">
                <span className="h-2 w-2 rounded-full bg-gold-400 animate-pulse" />
                <p className="text-xs font-semibold tracking-wide text-white/90">نور وهدى للقلوب</p>
              </div>
              <h1 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl bg-gradient-to-r from-white to-white/80 bg-clip-text">
                القرآن الكريم
              </h1>
              <p className="mt-3 max-w-md text-base leading-relaxed text-white/80 sm:text-lg">
                اقرأ، واستمع، وتتبع تلاوتك مع كتاب الله العزيز
              </p>
            </div>
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl border-2 border-white/20 bg-white/15 shadow-2xl backdrop-blur-md sm:h-20 sm:w-20">
              <BookOpen size={36} strokeWidth={1.5} />
            </div>
          </div>

          {/* Quick Stats & Actions */}
          <div className="relative mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => setViewMode('mushaf')}
              className="group inline-flex min-h-12 items-center gap-2.5 rounded-2xl bg-white px-5 py-3 text-base font-bold text-primary-800 shadow-lg transition-all hover:scale-105 hover:bg-primary-50 hover:shadow-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50"
            >
              <BookText size={20} className="group-hover:scale-110 transition-transform" />
              {mushafPage > 1 ? `متابعة القراءة · الصفحة ${toArabicNumber(mushafPage)}` : 'افتح المصحف'}
            </button>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
                <p className="text-xs text-white/70">السور</p>
                <p className="text-lg font-bold">{toArabicNumber(SURAHS.length)}</p>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
                <p className="text-xs text-white/70">الأجزاء</p>
                <p className="text-lg font-bold">{toArabicNumber(JUZ_INFO.length)}</p>
              </div>
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-sm">
                <p className="text-xs text-white/70">الصفحات</p>
                <p className="text-lg font-bold">{toArabicNumber(TOTAL_QURAN_PAGES)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Enhanced Browse Mode Tabs */}
        <div className="sticky top-0 z-40 rounded-3xl border-2 border-primary-200/80 bg-white/95 p-1.5 shadow-xl backdrop-blur-lg dark:border-primary-800/60 dark:bg-primary-950/90">
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { mode: 'surah' as const, label: 'السور', icon: BookOpen, desc: 'تصفح جميع السور' },
              { mode: 'juz' as const, label: 'الأجزاء', icon: Layers, desc: 'تقسيم 30 جزء' },
              { mode: 'page' as const, label: 'الصفحات', icon: BookText, desc: `${TOTAL_QURAN_PAGES} صفحة` },
            ]).map((tab) => (
              <button
                key={tab.mode}
                onClick={() => setBrowseMode(tab.mode)}
                aria-pressed={browseMode === tab.mode}
                className={`group relative flex flex-col items-center justify-center gap-1.5 rounded-2xl py-3 px-2 transition-all duration-300 ${
                  browseMode === tab.mode
                    ? 'bg-gradient-to-br from-primary-600 to-primary-700 text-white shadow-lg dark:from-primary-700 dark:to-primary-800'
                    : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700 dark:text-gray-400 dark:hover:bg-primary-900/50 dark:hover:text-primary-100'
                }`}
              >
                <tab.icon size={20} strokeWidth={2} className={`transition-transform ${browseMode === tab.mode ? 'scale-110' : 'group-hover:scale-110'}`} />
                <span className="text-sm font-bold">{tab.label}</span>
                <span className="text-[10px] opacity-70">{tab.desc}</span>
                {browseMode === tab.mode && (
                  <div className="absolute bottom-1.5 h-1 w-8 rounded-full bg-white/50" />
                )}
              </button>
            ))}
          </div>
        </div>

        {browseMode === 'surah' && (
          <>
            {/* Enhanced Search */}
            <div className="relative group">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary-500 to-primary-600 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-lg" />
              <Search size={20} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-primary-500 dark:text-primary-300 transition-colors group-focus-within:text-primary-600" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم السورة أو رقمها..."
                aria-label="ابحث عن سورة"
                className="relative min-h-14 w-full rounded-3xl border-2 border-primary-200 bg-white py-3.5 pl-12 pr-12 text-base text-primary-800 shadow-lg outline-none transition-all duration-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-100/70 placeholder:text-gray-400 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100 dark:focus:ring-primary-900/60"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-2xl text-gray-400 transition-all hover:bg-primary-100 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-100"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Enhanced Filter Chips */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 rounded-2xl bg-primary-50/90 p-1.5 shadow-inner dark:bg-primary-900/40">
                {([
                  { value: 'all' as const, label: 'الكل', icon: BookOpen },
                  { value: 'meccan' as const, label: 'مكية', icon: null },
                  { value: 'medinan' as const, label: 'مدنية', icon: null },
                ]).map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setRevelationFilter(filter.value)}
                    aria-pressed={revelationFilter === filter.value}
                    className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                      revelationFilter === filter.value
                        ? 'bg-white text-primary-700 shadow-md dark:bg-primary-800 dark:text-primary-100'
                        : 'text-gray-500 hover:bg-white/70 hover:text-primary-700 dark:text-gray-400 dark:hover:bg-primary-800/70 dark:hover:text-primary-100'
                    }`}
                  >
                    {filter.icon && <filter.icon size={14} />}
                    {filter.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-2xl bg-primary-100/80 px-4 py-2 dark:bg-primary-900/40">
                <span className="text-xs text-gray-600 dark:text-gray-400">النتائج:</span>
                <span className="text-sm font-bold text-primary-700 dark:text-primary-200">{toArabicNumber(filteredSurahs.length)}</span>
              </div>
            </div>

            {/* Enhanced Surah List */}
            {filteredSurahs.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSurahs.map((surah) => (
                  <SurahListItem
                    key={surah.id}
                    surah={surah}
                    onOpen={() => openSurah(surah)}
                    onHifz={() => openHifzMode(surah)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border-2 border-dashed border-primary-300 bg-gradient-to-br from-white/50 to-primary-50/50 px-6 py-12 text-center shadow-inner dark:border-primary-800 dark:from-primary-950/50 dark:to-primary-900/50">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-100 dark:bg-primary-800">
                  <Search size={32} className="text-primary-400 dark:text-primary-500" />
                </div>
                <p className="text-lg font-bold text-primary-800 dark:text-primary-100">لم نعثر على سورة مطابقة</p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">جرّب اسمًا أو رقمًا مختلفًا، أو غيّر نوع السور</p>
              </div>
            )}
          </>
        )}

        {browseMode === 'juz' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {JUZ_INFO.map((juz) => (
              <Card
                key={juz.id}
                onClick={() => openJuz(juz.id)}
                className="!p-4 hover:border-primary-400 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group"
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-800 dark:to-primary-900 shadow-md group-hover:scale-110 transition-transform">
                    <span className="text-xl font-bold text-primary-700 dark:text-gold-400">
                      {toArabicNumber(juz.id)}
                    </span>
                    <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-gold-400 shadow-sm" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-primary-800 dark:text-primary-100 mb-1">{juz.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      صفحة {toArabicNumber(juz.startPage)}-{toArabicNumber(juz.endPage)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {browseMode === 'page' && <PageBrowser onSelectPage={openPage} />}
      </div>
    );
  }

  // ---- READER / HIFZ VIEW ----
  if (viewMode === 'reader' || viewMode === 'hifz') {
    if (!selectedSurah) return null;
    const ayahs = getAyahs(selectedSurah.id, fromAyah, toAyah ?? selectedSurah.ayahCount);
    const isHifz = viewMode === 'hifz';
    const openingAyah = ayahs.find((ayah) => ayah.ayahNumber === 1);
    const opening = openingAyah ? splitBasmala(openingAyah.text) : null;
    const separateBasmala = opening?.basmala && opening.rest ? opening.basmala : null;

    return (
      <>
      <div className="space-y-4 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between sticky top-0 z-30 bg-surface-light dark:bg-surface-dark/95 backdrop-blur-lg py-2 -mx-4 px-4 border-b border-primary-100 dark:border-primary-800/30">
          <button onClick={() => setViewMode('list')} className="flex items-center gap-1 text-primary-600 dark:text-gold-400">
            <ChevronRight size={20} />
            <span className="text-sm">رجوع</span>
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">مصحف Sakinah</h2>
            {isHifz && <p className="text-xs text-gold-600 dark:text-gold-400">وضع الحفظ</p>}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFontSize((s) => Math.max(18, s - 2))}
              className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-700 dark:text-primary-200"
              title="تصغير الخط"
            >
              <Type size={16} />
              <span className="text-xs mr-0.5">-</span>
            </button>
            <button
              onClick={() => setFontSize((s) => Math.min(48, s + 2))}
              className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-700 dark:text-primary-200"
              title="تكبير الخط"
            >
              <Type size={16} />
              <span className="text-xs mr-0.5">+</span>
            </button>
          </div>
        </div>

        {/* Hifz mode controls */}
        {isHifz && (
          <Card className="bg-gold-50 dark:bg-gold-900/20 border-gold-200 dark:border-gold-800/40">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-gold-600 dark:text-gold-400" />
                <p className="text-sm font-semibold text-gold-800 dark:text-gold-300">خيارات الحفظ</p>
              </div>

              {/* Ayah range selection */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-300">من آية:</span>
                <input
                  type="number"
                  min={1}
                  max={selectedSurah.ayahCount}
                  value={fromAyah}
                  onChange={(e) => setFromAyah(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 bg-white dark:bg-primary-900/60 border border-gold-200 dark:border-gold-800 rounded-lg py-1 px-2 text-sm text-center"
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">إلى:</span>
                <input
                  type="number"
                  min={fromAyah}
                  max={selectedSurah.ayahCount}
                  value={toAyah ?? selectedSurah.ayahCount}
                  onChange={(e) => setToAyah(parseInt(e.target.value) || selectedSurah.ayahCount)}
                  className="w-16 bg-white dark:bg-primary-900/60 border border-gold-200 dark:border-gold-800 rounded-lg py-1 px-2 text-sm text-center"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setHideText(!hideText)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-smooth ${
                    hideText
                      ? 'bg-gold-500 text-white'
                      : 'bg-white dark:bg-primary-900/60 text-gray-600 dark:text-gray-300 border border-gold-200 dark:border-gold-800'
                  }`}
                >
                  {hideText ? <EyeOff size={16} /> : <Eye size={16} />}
                  {hideText ? 'إظهار النص' : 'إخفاء النص'}
                </button>
                <button
                  onClick={() => setHideWordByWord(!hideWordByWord)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-smooth ${
                    hideWordByWord
                      ? 'bg-gold-500 text-white'
                      : 'bg-white dark:bg-primary-900/60 text-gray-600 dark:text-gray-300 border border-gold-200 dark:border-gold-800'
                  }`}
                >
                  {hideWordByWord ? <EyeOff size={16} /> : <Eye size={16} />}
                  إخفاء كلمة بكلمة
                </button>
              </div>
            </div>
          </Card>
        )}

        <AudioRecitationPlayer
          key={selectedSurah.id}
          surah={selectedSurah}
          reciterId={reciterId}
          onReciterChange={changeReciter}
          onShowTafsir={(ayah) => setTafsirAyah({ surahId: selectedSurah.id, ayah })}
        >
          {({ activeAyah, isPlaying, selectedAyah, selectAyah, playSelectedAyah }) => {
            // The printed page this reader is standing on: whichever ayah the recitation
            // holds, then whichever one is chosen, then where the surah opens. The margin
            // and the folio both name that one page — as they do on a leaf in the reader.
            const currentAyah = activeAyah || selectedAyah || 1;
            const currentPage = getAyahPage(selectedSurah, currentAyah);
            const sajdahAyahs = SAJDAH_AYAHS.filter((s) => s.surahId === selectedSurah.id);
            return (
              <div className="mushaf-page" style={{ '--fs': `${fontSize}px` } as CSSProperties}>
                <MushafFrameDecoration />
                <div className="mushaf-margin" aria-hidden="true">
                  <span>الجزء {toArabicNumber(getJuzForPage(currentPage))}</span>
                  <span>الحزب {toArabicNumber(getHizbForPage(currentPage))}</span>
                </div>

                <header className="mushaf-banner">
                  <div className="mushaf-banner__name">سورة {selectedSurah.name}</div>
                  <div className="mushaf-banner__meta">
                    {selectedSurah.revelationType === 'meccan' ? 'مكية' : 'مدنية'} · {toArabicNumber(selectedSurah.ayahCount)} آية
                  </div>
                </header>

                {separateBasmala && (
                  <p className="mushaf-basmala">
                    <span className="mushaf-basmala__rule" aria-hidden="true" />
                    {separateBasmala}
                    <span className="mushaf-basmala__rule" aria-hidden="true" />
                  </p>
                )}

                <div className="mushaf-body" dir="rtl">
                  {ayahs.map((ayah) => (
                    <Fragment key={`${ayah.surahId}:${ayah.ayahNumber}`}>
                      {sajdahAyahs.some((s) => s.ayah === ayah.ayahNumber) && (
                        <p className="mushaf-sajdah">۩ سجدة</p>
                      )}
                      <AyahSpan
                        ayah={{
                          ...ayah,
                          text: ayah.ayahNumber === 1 && separateBasmala ? opening!.rest : ayah.text,
                        }}
                        fontSize={fontSize}
                        isHifz={isHifz}
                        bookmarked={bookmarkedKeys.has(`${ayah.surahId}:${ayah.ayahNumber}`)}
                        hideText={hideText}
                        hideWordByWord={hideWordByWord}
                        selected={selectedAyah === ayah.ayahNumber}
                        activeAudio={activeAyah === ayah.ayahNumber}
                        audioPlaying={isPlaying && activeAyah === ayah.ayahNumber}
                        onSelect={() => selectAyah(ayah.ayahNumber)}
                        onPlayAudio={playSelectedAyah}
                        onToggleBookmark={() => toggleBookmark(ayah.surahId, ayah.ayahNumber)}
                        onShowTafsir={() => setTafsirAyah({ surahId: ayah.surahId, ayah: ayah.ayahNumber })}
                      />
                    </Fragment>
                  ))}
                </div>

                <div className="mushaf-folio">{toArabicNumber(currentPage)}</div>
              </div>
            );
          }}
        </AudioRecitationPlayer>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const prevSurah = SURAHS.find((s) => s.id === selectedSurah.id - 1);
              if (prevSurah) openSurah(prevSurah);
            }}
            disabled={selectedSurah.id === 1}
          >
            <ChevronRight size={16} /> السورة السابقة
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const nextSurah = SURAHS.find((s) => s.id === selectedSurah.id + 1);
              if (nextSurah) openSurah(nextSurah);
            }}
            disabled={selectedSurah.id === 114}
          >
            السورة التالية <ChevronLeft size={16} />
          </Button>
        </div>

        {!hasFullText(selectedSurah.id) && (
          <p className="text-xs text-center text-gray-400 dark:text-gray-500 leading-relaxed">
            * نص هذه السورة غير مُضمَّن في التطبيق بعد، لذا تُعرض الآيات دون نص.
            يمكنك تصفّح المصحف للاطلاع على الصفحات المتاحة فقط.
          </p>
        )}

        <p className="text-xs text-center text-gray-400 dark:text-gray-500">
          {isHifz
            ? 'اضغط على الآية لتحديدها أو تعليمها، ثم اضغط علامة التشغيل بجوارها لتكرارها ومراجعة النطق'
            : 'اضغط على آية لتحديدها ثم علامة التشغيل بجوارها للاستماع أو التكرار'}
        </p>
      </div>

      {tafsirAyah && (
        <TafsirBottomSheet
          surahId={tafsirAyah.surahId}
          ayahNumber={tafsirAyah.ayah}
          onClose={() => setTafsirAyah(null)}
          onNavigateAyah={stepTafsirAyah}
        />
      )}
      </>
    );
  }

  // ---- MUSHAF VIEW ----
  if (viewMode === 'mushaf') {
    return (
      <MushafReader
        settings={settings}
        initialPage={mushafPage}
        onClose={() => setViewMode('list')}
        onPageChange={setMushafPage}
      />
    );
  }

  return null;
}

interface AyahSpanProps {
  ayah: AyahText;
  fontSize: number;
  isHifz: boolean;
  bookmarked: boolean;
  hideText: boolean;
  hideWordByWord: boolean;
  selected: boolean;
  activeAudio: boolean;
  audioPlaying: boolean;
  onSelect: () => void;
  onPlayAudio: () => void;
  onToggleBookmark: () => void;
  onShowTafsir: () => void;
}

/**
 * One ayah plus its number marker.
 *
 * Tap = bookmark in hifz mode, tafsir otherwise. Long-press (touch) or right-click
 * always opens the tafsir, which is the only way to reach it in hifz mode.
 */
function AyahSpan({
  ayah,
  fontSize,
  isHifz,
  bookmarked,
  hideText,
  hideWordByWord,
  selected,
  activeAudio,
  audioPlaying,
  onSelect,
  onPlayAudio,
  onToggleBookmark,
  onShowTafsir,
}: AyahSpanProps) {
  const timerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Never leave a timer running after the ayah unmounts.
  useEffect(() => cancelPress, [cancelPress]);

  const startPress = () => {
    longPressFiredRef.current = false;
    cancelPress();
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onShowTafsir();
    }, 500);
  };

  const handleClick = () => {
    cancelPress();
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    onSelect();
    if (isHifz) onToggleBookmark();
  };

  return (
    <span className="quran-surah-ayah">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`تحديد الآية ${toArabicNumber(ayah.ayahNumber)}${activeAudio ? '، تُتلى الآن' : ''}`}
        className={`quran-surah-ayah__text ${
          selected
            ? 'quran-surah-ayah__text--selected'
            : isHifz && bookmarked
              ? 'quran-surah-ayah__text--bookmarked'
              : ''
        } ${hideText ? 'no-select' : ''}`}
        onClick={handleClick}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelPress();
          onShowTafsir();
        }}
        style={{ fontSize }}
      >
        {hideText ? (
          <span className="bg-primary-200 dark:bg-primary-700 rounded px-2 select-none" style={{ opacity: 0 }}>
            {ayah.text}
          </span>
        ) : hideWordByWord ? (
          ayah.text.split(' ').map((word, i) => (
            <span
              key={i}
              className="inline-block hover:bg-gold-100 dark:hover:bg-gold-900/30 rounded cursor-pointer mx-0.5"
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                el.style.opacity = el.style.opacity === '0' ? '1' : '0';
              }}
            >
              {word}
            </span>
          ))
        ) : (
          ayah.text
        )}
      </button>
      <span className="quran-surah-ayah__actions">
        <span className={`mushaf-ayah-mark ${activeAudio ? 'mushaf-ayah-mark--active' : ''}`} aria-hidden="true">
          {toArabicNumber(ayah.ayahNumber)}
        </span>
        {selected && (
          <button
            type="button"
            aria-label={audioPlaying ? 'إيقاف تلاوة الآية مؤقتاً' : `استمع إلى الآية ${toArabicNumber(ayah.ayahNumber)}`}
            title="استمع إلى الآية المحددة"
            onClick={(event) => {
              event.stopPropagation();
              onPlayAudio();
            }}
            className="quran-surah-ayah__play"
          >
            {audioPlaying ? <Pause size={13} /> : <Play size={13} />}
          </button>
        )}
      </span>{' '}
    </span>
  );
}

// Surah list item - Enhanced
function SurahListItem({ surah, onOpen, onHifz }: { surah: SurahMeta; onOpen: () => void; onHifz: () => void }) {
  return (
    <Card className="!p-4 transition-all duration-300 hover:-translate-y-1 hover:border-primary-400 hover:shadow-xl sm:!p-5 group">
      <div className="flex items-center gap-4">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl text-right outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 transition-colors hover:bg-primary-50/50 dark:hover:bg-primary-900/30 -mx-2 px-2 py-2"
        >
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-primary-200 bg-gradient-to-br from-primary-50 to-primary-100 shadow-md dark:border-primary-700 dark:from-primary-800/80 dark:to-primary-900 group-hover:scale-110 transition-transform">
            <span className="text-lg font-bold text-primary-700 dark:text-gold-400">
              {toArabicNumber(surah.id)}
            </span>
            <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-gold-400 shadow-sm" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-1">
              <h3 className="text-lg font-bold text-primary-800 dark:text-primary-100">{surah.name}</h3>
              <Badge variant={surah.revelationType === 'meccan' ? 'gold' : 'primary'}>
                {surah.revelationType === 'meccan' ? 'مكية' : 'مدنية'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {surah.nameLatin}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-400" />
                {toArabicNumber(surah.ayahCount)} آية
              </span>
              <span className="text-primary-300">·</span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                صفحة {toArabicNumber(surah.pageStart)}
              </span>
            </div>
          </div>
        </button>
        <button
          onClick={onHifz}
          aria-label={`بدء الحفظ في سورة ${surah.name}`}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-gold-200 bg-gradient-to-br from-gold-50 to-gold-100 px-3 text-sm font-bold text-gold-700 shadow-md transition-all duration-300 hover:scale-105 hover:border-gold-400 hover:shadow-lg dark:border-gold-800/60 dark:from-gold-900/25 dark:to-gold-900/40 dark:text-gold-300 dark:hover:border-gold-600"
          title={`وضع الحفظ - ${surah.name}`}
        >
          <Layers size={16} />
          <span>حفظ</span>
        </button>
      </div>
    </Card>
  );
}

// Page browser
function PageBrowser({ onSelectPage }: { onSelectPage: (page: number) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: TOTAL_QURAN_PAGES }, (_, i) => i + 1).map((page) => (
        <button
          key={page}
          onClick={() => onSelectPage(page)}
          className="aspect-square rounded-lg bg-white dark:bg-primary-900/40 border border-primary-100 dark:border-primary-800 flex items-center justify-center text-sm font-medium text-primary-700 dark:text-primary-200 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-800/40 transition-smooth"
        >
          {toArabicNumber(page)}
        </button>
      ))}
    </div>
  );
}
