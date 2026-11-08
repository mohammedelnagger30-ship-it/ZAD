import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bookmark } from 'lucide-react';
import { getSurah, getJuzForPage, toArabicNumber } from '@/data/surahs';
import { getHizbForPage, SAJDAH_AYAHS } from '@/data/mushafPages';
import { getPageLines, COLUMN_EM } from '@/data/mushafFlow';
import { getSurahWords } from '@/data/mushafWords';
import { highlightWash } from '@/utils/quran/ayahHighlights';
import { getSurahWordMeanings } from '@/utils/quran/wordMeaningsService';
import { loadBundledMeaningIndex, type WordMeaningIndex } from '@/utils/quran/wordMeaningIndex';
import { isDarkPaper, MAX_LINE_WORD_GAPS, type MushafPaper } from '@/components/mushaf/readerConfig';

/** `${surahId}:${ayah}` for every ayah a printed mushaf sets the prostration sign after. */
const SAJDAH_AYAHS_KEYS = new Set(SAJDAH_AYAHS.map(({ surahId, ayah }) => `${surahId}:${ayah}`));

interface PageAyah {
  surahId: number;
  surahName: string;
  ayahNumber: number;
  text: string;
}

interface MushafWordButtonProps {
  ayah: PageAyah;
  word: string;
  wordIndex: number;
  meaningWords: ReadonlyMap<string, ReadonlySet<number>>;
  onWordPress?: MushafPageProps['onWordPress'];
}

/**
 * One word of the page.
 *
 * A word that carries a gloss is marked, and that is all this component does about it.
 * The gloss itself is never printed here: a mushaf with a sentence set under every
 * unusual word is a glossary, and there are hundreds of such words on a page — the text
 * stops being readable at all. The mark says the meaning exists; the press opens it.
 */
function MushafWordButton({ ayah, word, wordIndex, meaningWords, onWordPress }: MushafWordButtonProps) {
  const key = `${ayah.surahId}:${ayah.ayahNumber}`;
  const hasMeaning = meaningWords.get(key)?.has(wordIndex) ?? false;
  const action = hasMeaning ? 'اضغط لمعرفة معنى الكلمة' : 'اضغط لخيارات الآية';
  return (
    <button
      type="button"
      className={`mushaf-word${hasMeaning ? ' mushaf-word--has-meaning' : ''}`}
      aria-label={`${action}: ${word} في سورة ${ayah.surahName}، الآية ${toArabicNumber(ayah.ayahNumber)}`}
      title={action}
      onClick={() => onWordPress?.(ayah.surahId, ayah.ayahNumber, word, wordIndex + 1, hasMeaning)}
    >
      {word}
    </button>
  );
}

export interface MushafPageProps {
  page: number;
  readingPosition?: boolean;
  bookmarked?: boolean;
  /** Resolved Quran font size in px; the reader's zoom is folded in before this point. */
  fontSize: number;
  /** Which sheet to print on. Defaults to white. */
  paper?: MushafPaper;
  /**
   * The legacy light/dark switch, kept for the callers that predate the paper
   * picker. When `paper` is given it wins; otherwise night prints the black sheet.
   */
  night?: boolean;
  /** Reader default: its spacing formula at 100%. */
  lineHeight?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  wordMeaningsInstalled?: boolean;
  onAyahPress?: (surahId: number, ayahNumber: number) => void;
  /**
   * A word has been pressed. `hasMeaning` is the page's own answer — it comes from the
   * index that ships with the app, so the reader is told at once that this word was
   * worth pressing rather than having to query the downloaded dump before it can decide
   * what the tap was for. That query is what used to turn a press on a marked word into
   * the ayah's options sheet for any reader who had never been to the content library.
   */
  onWordPress?: (
    surahId: number,
    ayahNumber: number,
    word: string,
    wordPosition: number,
    hasMeaning: boolean,
  ) => void;
  /** The ayah currently selected in the reader, so the page can highlight it. */
  activeAyah?: { surahId: number; ayahNumber: number } | null;
  /** Saved highlight ids keyed by `surahId:ayahNumber`. */
  ayahHighlights?: ReadonlyMap<string, string>;
}

/** An eight-pointed illuminated rosette used to finish the page-frame corners. */
function Rosette({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={0.9} aria-hidden="true">
      <path
        d="M12 1.5 14.4 8.1 20.5 3.5 15.9 9.6 22.5 12 15.9 14.4 20.5 20.5 14.4 15.9 12 22.5 9.6 15.9 3.5 20.5 8.1 14.4 1.5 12 8.1 9.6 3.5 3.5 9.6 8.1Z"
        fill="currentColor"
        fillOpacity={0.12}
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" fillOpacity={0.18} />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MushafFrameDecoration() {
  return (
    <div className="mushaf-frame" aria-hidden="true">
      <Rosette className="mushaf-corner mushaf-corner--tr" />
      <Rosette className="mushaf-corner mushaf-corner--tl" />
      <Rosette className="mushaf-corner mushaf-corner--br" />
      <Rosette className="mushaf-corner mushaf-corner--bl" />
    </div>
  );
}

/**
 * A printed mushaf page is a fixed object: fifteen lines, each holding the exact words
 * the flow table measured for it. Rendering the page from `getPageLines` (rather than
 * dumping every ayah into one paragraph and letting the browser wrap) is what keeps the
 * line breaks — and therefore the gaps between words — identical to the printed page.
 * The browser only has a few percent of slack left to distribute, which is why the text
 * fills the column evenly instead of stretching a handful of words across it.
 */
export function MushafPage({
  page,
  readingPosition = false,
  bookmarked = false,
  fontSize,
  paper,
  night = false,
  lineHeight = 1.9,
  letterSpacing = 0,
  wordSpacing = 0,
  wordMeaningsInstalled = false,
  onAyahPress,
  onWordPress,
  activeAyah,
  ayahHighlights,
}: MushafPageProps) {
  const juz = getJuzForPage(page);
  const hizb = getHizbForPage(page);

  const lines = useMemo(() => getPageLines(page), [page]);

  const surahIds = useMemo(
    () => [...new Set(lines.map((line) => line.surahId))],
    [lines],
  );

  // Word offset into its surah's list → index of the word inside its own ayah. The
  // meaning index is stored against that per-ayah position, so a word drawn from the
  // flow table still finds its gloss.
  const wordIndexBySurah = useMemo(() => {
    const map = new Map<number, number[]>();
    for (const surahId of surahIds) {
      const words = getSurahWords(surahId);
      const indexes = new Array<number>(words.length);
      let ayah = -1;
      let run = 0;
      for (let i = 0; i < words.length; i++) {
        if (words[i].ayah !== ayah) {
          ayah = words[i].ayah;
          run = 0;
        }
        indexes[i] = run++;
      }
      map.set(surahId, indexes);
    }
    return map;
  }, [surahIds]);

  const [loadedMeaningData, setLoadedMeaningData] = useState<{
    page: number;
    words: Map<string, Set<number>>;
  }>({ page: 0, words: new Map() });

  // The bundled index is the marker source that does not depend on `wordMeaningsInstalled`,
  // so it is asked for on every mount regardless of what the reader has downloaded. Later
  // mounts join the same request, and a mount after it lands starts with the answer
  // already in hand.
  const [bundledIndex, setBundledIndex] = useState<WordMeaningIndex | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadBundledMeaningIndex().then((index) => {
      if (cancelled) return;
      setBundledIndex(index);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!wordMeaningsInstalled) return;
    let cancelled = false;
    void Promise.all(
      surahIds.map(async (surahId) => [surahId, await getSurahWordMeanings(surahId)] as const),
    ).then((surahs) => {
      if (cancelled) return;
      const next = new Map<string, Set<number>>();
      for (const [surahId, ayahs] of surahs) {
        for (const [ayahNumber, hits] of ayahs) {
          const wordIndexes = new Set(hits.map((hit) => hit.wordIndex));
          if (wordIndexes.size > 0) next.set(`${surahId}:${ayahNumber}`, wordIndexes);
        }
      }
      setLoadedMeaningData({ page, words: next });
    }).catch((cause: unknown) => {
      if (cancelled) return;
      console.error('Unable to load word-meaning markers for mushaf page:', cause);
      setLoadedMeaningData({ page, words: new Map() });
    });
    return () => {
      cancelled = true;
    };
  }, [page, surahIds, wordMeaningsInstalled]);

  /** Every `surahId:ayah` that actually appears on this page's lines. */
  const ayahKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const line of lines) {
      if (line.kind !== 'text') continue;
      const words = getSurahWords(line.surahId).slice(line.from, line.from + line.count);
      for (const word of words) {
        if (word.ayah > 0) keys.add(`${line.surahId}:${word.ayah}`);
      }
    }
    return [...keys];
  }, [lines]);

  // Best available answer, unioned: the bundled index for every reader, widened with
  // whatever the installed dump knows that this build's copy does not. The gate on
  // `wordMeaningsInstalled` is gone from here — a reader who has never opened the
  // Content Library still gets every marker, which is the whole reason the index ships
  // with the app. The dump stays in the merge only because it can be newer than the
  // build, and because it is still what supplies the gloss the sheet reads out.
  const meaningWords = useMemo(() => {
    const merged = new Map<string, Set<number>>();
    if (bundledIndex) {
      for (const key of ayahKeys) {
        const hits = bundledIndex[key];
        if (hits && hits.length > 0) merged.set(key, new Set(hits));
      }
    }
    if (wordMeaningsInstalled && loadedMeaningData.page === page) {
      for (const [key, wordIndexes] of loadedMeaningData.words) merged.set(key, wordIndexes);
    }
    return merged;
  }, [bundledIndex, ayahKeys, page, loadedMeaningData, wordMeaningsInstalled]);

  const pageStyle = {
    '--fs': `${fontSize}px`,
    '--lh': `${lineHeight}`,
    /* The measure the flow table broke every line against. Taking it from the same
       constant means the CSS column and the line breaks can never drift apart. */
    '--mushaf-column': `${COLUMN_EM}em`,
    '--letter-gap': `${letterSpacing}em`,
    /*
     * Word spacing under a fixed measure is normally invisible: justification removes
     * exactly what `word-spacing` adds. So the reader's choice also widens the measure by
     * the most gaps any line can hold, which lets the extra space survive justification.
     * Negative choices stay a no-op — narrowing the measure would re-wrap the fixed lines.
     */
    '--word-gap': `${Math.max(0, wordSpacing)}em`,
    '--word-extra': `${Math.max(0, wordSpacing) * MAX_LINE_WORD_GAPS}em`,
  } as CSSProperties;

  const resolvedPaper: MushafPaper = paper ?? (night ? 'black' : 'white');
  const paperClass = ` mushaf-page--${resolvedPaper}${
    isDarkPaper(resolvedPaper) ? ' mushaf-page--night' : ''
  }`;

  return (
    <div className={`mushaf-page${paperClass}`} style={pageStyle}>
      {/* Ornamental frame. Decorative only, so it is hidden from assistive tech. */}
      <MushafFrameDecoration />
      {readingPosition && (
        <span
          className="mushaf-ribbon mushaf-ribbon--resume"
          role="img"
          aria-label="موضع القراءة الحالي"
          title="موضع القراءة الحالي"
        />
      )}
      {bookmarked && (
        <span
          className="mushaf-page-bookmark"
          role="img"
          aria-label={`صفحة ${toArabicNumber(page)} محفوظة في العلامات`}
          title="صفحة محفوظة"
        >
          <Bookmark size={15} fill="currentColor" strokeWidth={1.8} aria-hidden="true" />
        </span>
      )}

      <div className="mushaf-margin" aria-hidden="true">
        <span>الجزء {toArabicNumber(juz)}</span>
        <span>الحزب {toArabicNumber(hizb)}</span>
      </div>

      {lines.map((line, lineIndex) => {
        if (line.kind === 'heading') {
          const surah = getSurah(line.surahId);
          if (!surah) return null;
          return (
            <div key={`heading-${lineIndex}`} className="mushaf-banner">
              <div className="mushaf-banner__name">سورة {surah.name}</div>
              <div className="mushaf-banner__meta">
                {surah.revelationType === 'meccan' ? 'مكية' : 'مدنية'} ·{' '}
                {toArabicNumber(surah.ayahCount)} آية
              </div>
            </div>
          );
        }

        if (line.kind === 'basmala') {
          const words = getSurahWords(line.surahId).slice(line.from, line.from + line.count);
          return (
            <p key={`basmala-${lineIndex}`} className="mushaf-basmala">
              <span className="mushaf-basmala__rule" aria-hidden="true" />
              {words.map((word) => word.text).join(' ')}
              <span className="mushaf-basmala__rule" aria-hidden="true" />
            </p>
          );
        }

        const surah = getSurah(line.surahId);
        const surahName = surah?.name ?? '';
        const surahWords = getSurahWords(line.surahId);
        const words = surahWords.slice(line.from, line.from + line.count);
        const indexes = wordIndexBySurah.get(line.surahId);
        const endsSurah = line.from + line.count >= surahWords.length;

        // Consecutive words of the same ayah are drawn as one run so the highlight wash
        // covers the spaces between them, the way the old whole-ayah span did.
        const runs: { ayah: number; items: { text: string; globalIndex: number; endsAyah: boolean }[] }[] = [];
        for (let i = 0; i < words.length; i++) {
          const globalIndex = line.from + i;
          const word = words[i];
          const last = runs[runs.length - 1];
          const item = { text: word.text, globalIndex, endsAyah: word.endsAyah };
          if (last && last.ayah === word.ayah) last.items.push(item);
          else runs.push({ ayah: word.ayah, items: [item] });
        }

        return (
          <p className={`mushaf-line${endsSurah ? ' mushaf-line--surah-end' : ''}`} key={`line-${lineIndex}`}>
            {runs.map((run, runIndex) => {
              const key = `${line.surahId}:${run.ayah}`;
              const isActive =
                activeAyah?.surahId === line.surahId && activeAyah?.ayahNumber === run.ayah;
              const highlightColor = ayahHighlights?.get(key);
              const highlight = highlightWash(highlightColor);
              const ayahStyle = highlight
                ? { background: `linear-gradient(to bottom, transparent 24%, ${highlight} 24%)` }
                : isActive
                  ? { background: 'linear-gradient(to bottom, transparent 24%, var(--wash) 24%)' }
                  : undefined;
              const isLastRun = runIndex === runs.length - 1;
              return (
                <span className="mushaf-ayah" style={ayahStyle} key={`${key}-${runIndex}`}>
                  {run.items.map(({ text, globalIndex, endsAyah }, itemIndex) => {
                    const isLastItemOfLine = isLastRun && itemIndex === run.items.length - 1;
                    const wordIndex = indexes?.[globalIndex] ?? 0;
                    const ayah: PageAyah = {
                      surahId: line.surahId,
                      surahName,
                      ayahNumber: run.ayah,
                      text: '',
                    };
                    return (
                      <span key={globalIndex} className={endsAyah ? 'mushaf-ayah-tail' : undefined}>
                        <MushafWordButton
                          ayah={ayah}
                          word={text}
                          wordIndex={wordIndex}
                          meaningWords={meaningWords}
                          onWordPress={onWordPress}
                        />
                        {endsAyah && run.ayah > 0 && (
                          <>
                            <button
                              type="button"
                              className="mushaf-ayah-mark"
                              aria-label={`خيارات الآية ${toArabicNumber(run.ayah)} من سورة ${surahName}`}
                              onClick={() => onAyahPress?.(line.surahId, run.ayah)}
                            >
                              <span className="mushaf-ayah-mark__glyph" aria-hidden="true">
                                {'\u06DD'}
                                {toArabicNumber(run.ayah)}
                              </span>
                            </button>
                            {SAJDAH_AYAHS_KEYS.has(`${line.surahId}:${run.ayah}`) && (
                              <span className="mushaf-sajdah" role="img" aria-label="آية السجدة">
                                ۩
                              </span>
                            )}
                          </>
                        )}
                        {!isLastItemOfLine && ' '}
                      </span>
                    );
                  })}
                </span>
              );
            })}
          </p>
        );
      })}

      {lines.length === 0 && (
        <p className="mushaf-body" style={{ textAlign: 'center' }}>
          نص الصفحة غير متوفر حالياً
        </p>
      )}

      <div className="mushaf-folio" role="note" aria-label={`رقم الصفحة ${toArabicNumber(page)}`}>
        {toArabicNumber(page)}
      </div>
    </div>
  );
}
