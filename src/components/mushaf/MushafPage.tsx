import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Bookmark } from 'lucide-react';
import { getSurah, getSurahsForPage, getJuzForPage, toArabicNumber } from '@/data/surahs';
import { getPageMeta, getHizbForPage } from '@/data/mushafPages';
import { getAyahs } from '@/data/quranText';
import { splitBasmala } from '@/utils/basmala';
import { getSurahWordMeanings } from '@/utils/wordMeaningsService';
import { loadBundledMeaningIndex, type WordMeaningIndex } from '@/utils/wordMeaningIndex';

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

/**
 * The page body is split at every surah opening so a heading can interrupt the flow,
 * the way a heading does on a printed page. Text segments stay one continuous justified
 * block each — justification needs inline content, and a block element per ayah would
 * leave every ayah on its own ragged line.
 */
type Segment =
  | { kind: 'text'; key: string; ayahs: PageAyah[] }
  | { kind: 'heading'; key: string; surahId: number; basmala: string | null };

export interface MushafPageProps {
  page: number;
  readingPosition?: boolean;
  bookmarked?: boolean;
  /** Resolved Quran font size in px; the reader's zoom is folded in before this point. */
  fontSize: number;
  night: boolean;
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

export function MushafPage({
  page,
  readingPosition = false,
  bookmarked = false,
  fontSize,
  night,
  lineHeight = 1.9,
  letterSpacing = 0.01,
  wordSpacing = 0,
  wordMeaningsInstalled = false,
  onAyahPress,
  onWordPress,
  activeAyah,
}: MushafPageProps) {
  const pageMeta = getPageMeta(page);
  const juz = getJuzForPage(page);
  const hizb = getHizbForPage(page);

  const segments = useMemo<Segment[]>(() => {
    const surahs = getSurahsForPage(page);
    const ayahs: PageAyah[] = [];
    for (const surah of surahs) {
      for (const a of getAyahs(surah.id, 1, surah.ayahCount)) {
        if (a.page === page) {
          ayahs.push({
            surahId: surah.id,
            surahName: surah.name,
            ayahNumber: a.ayahNumber,
            text: a.text,
          });
        }
      }
    }

    const out: Segment[] = [];
    let bucket: PageAyah[] = [];
    const flush = () => {
      if (bucket.length) out.push({ kind: 'text', key: `t${out.length}`, ayahs: bucket });
      bucket = [];
    };

    for (const ayah of ayahs) {
      // Tanzil folds the basmala into ayah 1, so every surah opening needs its heading
      // and its basmala lifted out, or the page would show both twice.
      if (ayah.ayahNumber === 1) {
        const { basmala, rest } = splitBasmala(ayah.text);
        // Al-Fatihah's ayah 1 *is* the basmala. Lifting it would leave the page with a
        // header and no text, so keep it inline as the ayah itself.
        const hoisted = basmala !== null && rest.length > 0;
        flush();
        out.push({
          kind: 'heading',
          key: `h${ayah.surahId}`,
          surahId: ayah.surahId,
          basmala: hoisted ? basmala : null,
        });
        bucket.push({ ...ayah, text: hoisted ? rest : ayah.text });
        continue;
      }
      bucket.push(ayah);
    }
    flush();
    return out;
  }, [page]);

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

  const surahIds = useMemo(
    () => [
      ...new Set(
        segments.flatMap((segment) =>
          segment.kind === 'text' ? segment.ayahs.map((ayah) => ayah.surahId) : [],
        ),
      ),
    ],
    [segments],
  );

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

  // Best available answer, unioned: the bundled index for every reader, widened with
  // whatever the installed dump knows that this build's copy does not. The gate on
  // `wordMeaningsInstalled` is gone from here — a reader who has never opened the
  // Content Library still gets every marker, which is the whole reason the index ships
  // with the app. The dump stays in the merge only because it can be newer than the
  // build, and because it is still what supplies the gloss the sheet reads out.
  const meaningWords = useMemo(() => {
    const merged = new Map<string, Set<number>>();
    if (bundledIndex) {
      for (const segment of segments) {
        if (segment.kind !== 'text') continue;
        for (const ayah of segment.ayahs) {
          const key = `${ayah.surahId}:${ayah.ayahNumber}`;
          const hits = bundledIndex[key];
          if (hits && hits.length > 0) merged.set(key, new Set(hits));
        }
      }
    }
    if (wordMeaningsInstalled && loadedMeaningData.page === page) {
      for (const [key, wordIndexes] of loadedMeaningData.words) merged.set(key, wordIndexes);
    }
    return merged;
  }, [bundledIndex, segments, page, loadedMeaningData, wordMeaningsInstalled]);

  const pageStyle = {
    '--fs': `${fontSize}px`,
    '--lh': `${lineHeight}`,
    '--letter-gap': `${letterSpacing}em`,
    '--word-gap': wordSpacing === 0 ? '-0.025em' : `${(wordSpacing - 0.025).toFixed(3)}em`,
  } as CSSProperties;

  return (
    <div className={`mushaf-page${night ? ' mushaf-page--night' : ''}`} style={pageStyle}>
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

      {pageMeta?.isSajdah && <p className="mushaf-sajdah">۩ سجدة</p>}

      {segments.map((segment) => {
        if (segment.kind === 'heading') {
          const surah = getSurah(segment.surahId);
          if (!surah) return null;
          return (
            <div key={segment.key}>
              <div className="mushaf-banner">
                <div className="mushaf-banner__name">سورة {surah.name}</div>
                <div className="mushaf-banner__meta">
                  {surah.revelationType === 'meccan' ? 'مكية' : 'مدنية'} · {toArabicNumber(surah.ayahCount)} آية
                </div>
              </div>
              {segment.basmala && (
                <p className="mushaf-basmala">
                  <span className="mushaf-basmala__rule" aria-hidden="true" />
                  {segment.basmala}
                  <span className="mushaf-basmala__rule" aria-hidden="true" />
                </p>
              )}
            </div>
          );
        }
        return (
          <p className="mushaf-body" key={segment.key}>
            {segment.ayahs.map((ayah) => {
              const isActive =
                activeAyah?.surahId === ayah.surahId && activeAyah?.ayahNumber === ayah.ayahNumber;
              // The last word carries the medallion inside one unbreakable tail, so the
              // two are always cut from the line together.
              const words = ayah.text.split(' ');
              return (
                <span key={`${ayah.surahId}:${ayah.ayahNumber}`}>
                  <span
                    className="mushaf-ayah"
                    style={isActive ? { background: 'var(--wash)' } : undefined}
                  >
                    {words.slice(0, -1).map((word, index) => (
                      <span key={index}>
                        <MushafWordButton
                          ayah={ayah}
                          word={word}
                          wordIndex={index}
                          meaningWords={meaningWords}
                          onWordPress={onWordPress}
                        />{' '}
                      </span>
                    ))}
                    <span className="mushaf-ayah-tail">
                      <MushafWordButton
                        ayah={ayah}
                        word={words[words.length - 1]}
                        wordIndex={words.length - 1}
                        meaningWords={meaningWords}
                        onWordPress={onWordPress}
                      />
                      <button
                        type="button"
                        className="mushaf-ayah-mark"
                        aria-label={`خيارات الآية ${toArabicNumber(ayah.ayahNumber)} من سورة ${ayah.surahName}`}
                        onClick={() => onAyahPress?.(ayah.surahId, ayah.ayahNumber)}
                      >
                        <span className="mushaf-ayah-mark__glyph" aria-hidden="true">
                          {'\u06DD'}{toArabicNumber(ayah.ayahNumber)}
                        </span>
                      </button>
                    </span>
                  </span>{' '}
                </span>
              );
            })}
          </p>
        );
      })}

      {segments.length === 0 && (
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
