import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Search, Eye, EyeOff, ChevronLeft, ChevronRight, Type, BookOpen, Layers, BookText, Pause, Play, X } from 'lucide-react';
import { Card, Button, Badge } from '@/components/ui';
import { SURAHS, JUZ_INFO, TOTAL_QURAN_PAGES, getSurah, toArabicNumber, type SurahMeta } from '@/data/surahs';
import { getAyahs, hasFullText, type AyahText } from '@/data/quranText';
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
      <div className="space-y-5 pb-6">
        <section className="relative isolate overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-primary-700 via-primary-800 to-primary-950 px-5 py-5 text-white shadow-lg sm:px-7 sm:py-7">
          <div className="pointer-events-none absolute -left-8 -top-12 -z-10 h-48 w-48 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -left-1 top-0 -z-10 h-32 w-32 rounded-full border border-white/10" />
          <BookOpen className="pointer-events-none absolute -left-5 bottom-0 -z-10 h-36 w-36 -rotate-12 text-white/[0.07] sm:left-5 sm:h-44 sm:w-44" />

          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="mb-2 text-xs font-semibold tracking-wide text-primary-100/80">زَادٌ لِقَلْبِكَ وَيَوْمِكَ</p>
              <h1 className="text-2xl font-bold leading-tight sm:text-3xl">القرآن الكريم</h1>
              <p className="mt-2 max-w-sm text-sm leading-6 text-white/75">
                اقرأ، واستمع، وتابع رحلتك مع كتاب الله
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-inner backdrop-blur-sm sm:h-14 sm:w-14">
              <BookOpen size={27} strokeWidth={1.7} />
            </div>
          </div>

          <div className="relative mt-5 flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => { setMushafPage(1); setViewMode('mushaf'); }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-primary-800 shadow-sm transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <BookText size={17} />
              افتح المصحف
            </button>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/85">
              {toArabicNumber(SURAHS.length)} سورة
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/85">
              {toArabicNumber(JUZ_INFO.length)} جزءًا
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-2 text-xs text-white/85">
              {toArabicNumber(TOTAL_QURAN_PAGES)} صفحة
            </span>
          </div>
        </section>

        {/* Browse mode tabs */}
        <div className="flex gap-1.5 rounded-2xl border border-primary-100/80 bg-white/75 p-1.5 shadow-sm dark:border-primary-800/60 dark:bg-primary-950/45">
          {([
            { mode: 'surah' as const, label: 'السور', icon: BookOpen },
            { mode: 'juz' as const, label: 'الأجزاء', icon: Layers },
            { mode: 'page' as const, label: 'الصفحات', icon: BookText },
          ]).map((tab) => (
            <button
              key={tab.mode}
              onClick={() => setBrowseMode(tab.mode)}
              aria-pressed={browseMode === tab.mode}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition-all ${
                browseMode === tab.mode
                  ? 'bg-primary-700 text-white shadow-sm dark:bg-primary-600'
                  : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700 dark:text-gray-400 dark:hover:bg-primary-900/60 dark:hover:text-primary-100'
              }`}
            >
              <tab.icon size={16} strokeWidth={2} />
              {tab.label}
            </button>
          ))}
        </div>

        {browseMode === 'surah' && (
          <>
            <div className="relative">
              <Search size={18} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-primary-500 dark:text-primary-300" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث باسم السورة أو رقمها..."
                aria-label="ابحث عن سورة"
                className="min-h-12 w-full rounded-2xl border border-primary-100 bg-white py-3 pl-11 pr-11 text-sm text-primary-800 shadow-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100/70 placeholder:text-gray-400 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100 dark:focus:ring-primary-900/60"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="مسح البحث"
                  className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition hover:bg-primary-50 hover:text-primary-700 dark:hover:bg-primary-800 dark:hover:text-primary-100"
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 rounded-xl bg-primary-50/80 p-1 dark:bg-primary-900/35">
                {([
                  { value: 'all' as const, label: 'الكل' },
                  { value: 'meccan' as const, label: 'مكية' },
                  { value: 'medinan' as const, label: 'مدنية' },
                ]).map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setRevelationFilter(filter.value)}
                    aria-pressed={revelationFilter === filter.value}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                      revelationFilter === filter.value
                        ? 'bg-white text-primary-700 shadow-sm dark:bg-primary-800 dark:text-primary-100'
                        : 'text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-100'
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400" aria-live="polite">
                {toArabicNumber(filteredSurahs.length)} سورة
              </p>
            </div>
            {filteredSurahs.length > 0 ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
              <div className="rounded-2xl border border-dashed border-primary-200 bg-white/60 px-4 py-10 text-center dark:border-primary-800 dark:bg-primary-950/30">
                <Search size={24} className="mx-auto mb-2 text-gray-400" />
                <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">لم نعثر على سورة مطابقة</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">جرّب اسمًا أو رقمًا مختلفًا، أو غيّر نوع السور</p>
              </div>
            )}
          </>
        )}

        {browseMode === 'juz' && (
          <div className="grid grid-cols-2 gap-2">
            {JUZ_INFO.map((juz) => (
              <Card
                key={juz.id}
                onClick={() => openJuz(juz.id)}
                className="!p-3 hover:border-primary-300"
              >
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-700 dark:text-gold-400 font-bold text-lg">
                    {toArabicNumber(juz.id)}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">{juz.name}</p>
                    <p className="text-xs text-gray-500">
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
            <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">مصحف Nour ZAD</h2>
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
          {({ activeAyah, isPlaying, selectedAyah, selectAyah, playSelectedAyah }) => (
            <div
              className="mushaf-page quran-surah-page"
              style={{ '--fs': `${fontSize}px` } as CSSProperties}
            >
              <MushafFrameDecoration />
              <div className="mushaf-margin" aria-hidden="true">
                <span>الجزء {toArabicNumber(selectedSurah.juzStart)}</span>
                <span>{selectedSurah.revelationType === 'meccan' ? 'مكية' : 'مدنية'}</span>
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

              <div className="mushaf-body quran-surah-text" dir="rtl">
                {ayahs.map((ayah) => (
                  <AyahSpan
                    key={`${ayah.surahId}:${ayah.ayahNumber}`}
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
                ))}
              </div>
            </div>
          )}
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
    return <MushafReader settings={settings} initialPage={mushafPage} onClose={() => setViewMode('list')} />;
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

// Surah list item
function SurahListItem({ surah, onOpen, onHifz }: { surah: SurahMeta; onOpen: () => void; onHifz: () => void }) {
  return (
    <Card className="!p-2.5 transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md sm:!p-3">
      <div className="flex items-center gap-2.5">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-right outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400"
        >
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 to-primary-100 dark:border-primary-700 dark:from-primary-800/80 dark:to-primary-900">
            <span className="text-sm font-bold text-primary-700 dark:text-gold-400">
              {toArabicNumber(surah.id)}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-base font-bold text-primary-800 dark:text-primary-100">{surah.name}</h3>
              <Badge variant={surah.revelationType === 'meccan' ? 'gold' : 'primary'}>
                {surah.revelationType === 'meccan' ? 'مكية' : 'مدنية'}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
              {surah.nameLatin} <span className="px-0.5 text-primary-300">·</span>
              {toArabicNumber(surah.ayahCount)} آية <span className="px-0.5 text-primary-300">·</span>
              صفحة {toArabicNumber(surah.pageStart)}
            </p>
          </div>
        </button>
        <button
          onClick={onHifz}
          aria-label={`بدء الحفظ في سورة ${surah.name}`}
          className="flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gold-200 bg-gold-50 px-2.5 text-xs font-semibold text-gold-700 transition hover:bg-gold-100 dark:border-gold-800/60 dark:bg-gold-900/25 dark:text-gold-300 dark:hover:bg-gold-900/50"
          title={`وضع الحفظ - ${surah.name}`}
        >
          <Layers size={15} />
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
