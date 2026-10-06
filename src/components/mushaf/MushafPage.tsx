import { Fragment, useMemo, type CSSProperties } from 'react';
import { getSurah, getSurahsForPage, getJuzForPage, toArabicNumber } from '@/data/surahs';
import { getPageMeta, getHizbForPage } from '@/data/mushafPages';
import { getPageLines } from '@/data/mushafFlow';
import { getSurahWords, type FlowWord } from '@/data/mushafWords';
import { getAyahs } from '@/data/quranText';
import { splitBasmala } from '@/utils/basmala';

interface PageAyah {
  surahId: number;
  surahName: string;
  ayahNumber: number;
  text: string;
}

/**
 * One line of a paper-mode page, as the flow layout fixed it.
 *
 * These are not recomputed: `getPageLines` returns where every line of the mushaf breaks,
 * measured from the real typeface so each line fills the printed column. The reader's job
 * is to draw them, not to decide where they go.
 */
type PaperLine =
  | { kind: 'heading'; key: string; surahId: number }
  | { kind: 'basmala'; key: string; words: FlowWord[] }
  | { kind: 'text'; key: string; surahId: number; words: FlowWord[]; ragged: boolean };

/**
 * The page body is split at every surah opening so a heading can interrupt the flow, the
 * way a heading does on a printed page. Text segments stay one continuous justified
 * block each — justification needs inline content, and a block element per ayah would
 * leave every ayah on its own ragged line.
 */
type Segment =
  | { kind: 'text'; key: string; ayahs: PageAyah[] }
  | { kind: 'heading'; key: string; surahId: number; basmala: string | null };

export interface MushafPageProps {
  page: number;
  /** Resolved Quran font size in px; the reader's zoom is folded in before this point. */
  fontSize: number;
  night: boolean;
  paper?: boolean;
  /**
   * Zoom for paper mode, 1 = the sheet as large as the screen allows.
   *
   * Paper mode scales the *sheet*, not the text: the line breaks were measured against a
   * fixed column in `em`, so a bigger font would need different breaks and there are none.
   * Scaling the whole sheet instead keeps every page identical to every other page of the
   * same number, which is what a printed mushaf is.
   */
  paperZoom?: number;
  lineHeight?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  onAyahPress?: (surahId: number, ayahNumber: number) => void;
  /** The ayah whose tafsir is open, so the page can show which one it is. */
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
  fontSize,
  night,
  paper = false,
  paperZoom = 1,
  lineHeight = 2.05,
  letterSpacing = 0.01,
  wordSpacing = 0,
  onAyahPress,
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

  /**
   * The page's lines, exactly where the flow layout put them.
   *
   * A line is a `from`/`count` slice into its surah's word list. What is left to decide
   * here is only whether a line should be justified: the last line of a surah is not, because
   * in print a line before a heading runs out to the end of the text rather than stretching
   * to the column — stretching it is the single most obvious tell of a fake mushaf page.
   */
  const paperLines = useMemo<PaperLine[]>(() => {
    const flow = getPageLines(page);

    return flow.map((line, index) => {
      const next = flow[index + 1];
      // A surah's last line on the page: either the surah ends here, or the next line
      // belongs to the surah that follows.
      const endsSurah = next === undefined || next.surahId !== line.surahId;

      if (line.kind === 'heading') {
        return { kind: 'heading', key: `h${line.surahId}-${index}`, surahId: line.surahId };
      }

      const words = getSurahWords(line.surahId).slice(line.from, line.from + line.count);
      if (line.kind === 'basmala') {
        return { kind: 'basmala', key: `b${line.surahId}-${index}`, words };
      }
      return { kind: 'text', key: `t${index}`, surahId: line.surahId, words, ragged: endsSurah };
    });
  }, [page]);

  const pageStyle = {
    '--fs': `${fontSize}px`,
    '--lh': `${lineHeight}`,
    '--letter-gap': `${letterSpacing}em`,
    '--word-gap': wordSpacing === 0 ? 'normal' : `${wordSpacing}em`,
    // Paper mode ignores the reader's font size and derives its own from the sheet's width
    // (see `.mushaf-page--paper`), so the column stays exactly as wide as the line breaks
    // were measured against. Only the sheet's scale comes through here.
    '--paper-zoom': `${paperZoom}`,
  } as CSSProperties;

  return (
    <div className={`mushaf-page ${night ? 'mushaf-page--night' : ''} ${paper ? 'mushaf-page--paper' : ''}`} style={pageStyle}>
      {/* Ornamental frame. Decorative only, so it is hidden from assistive tech. */}
      <MushafFrameDecoration />

      <div className="mushaf-margin" aria-hidden="true">
        <span>الجزء {toArabicNumber(juz)}</span>
        <span>الحزب {toArabicNumber(hizb)}</span>
      </div>

      {paper ? (
        <div className="mushaf-paper-content" dir="rtl">
          <div className="mushaf-paper-lines" aria-label={`صفحة ${toArabicNumber(page)} من المصحف`}>
            {paperLines.map((line) => {
              if (line.kind === 'heading') {
                const surah = getSurah(line.surahId);
                if (!surah) return null;
                return (
                  <div className="mushaf-paper-line mushaf-paper-line--heading" key={line.key}>
                    <span className="mushaf-paper-heading-box">
                      سُورَةُ {surah.name}
                    </span>
                  </div>
                );
              }
              if (line.kind === 'basmala') {
                return (
                  <div className="mushaf-paper-line mushaf-paper-line--basmala" key={line.key}>
                    {line.words.map((word, index) => (
                      <span key={`${line.key}w${index}`}>{word.text}</span>
                    ))}
                  </div>
                );
              }

              const surahName = getSurah(line.surahId)?.name ?? '';
              // One target per ayah, not per word.
              //
              // A line holds about nine words and a page fifteen lines, so making each word a
              // button would put a hundred-odd tab stops between the reader and the end of
              // the page, and a screen reader would announce "ayah 4" fourteen times. Ayahs
              // still straddle line and page breaks — that is what print does — so the run of
              // words belonging to one ayah is wrapped in a single inline target instead.
              const runs: { ayah: number; words: FlowWord[] }[] = [];
              for (const word of line.words) {
                const open = runs[runs.length - 1];
                if (open && open.ayah === word.ayah) open.words.push(word);
                else runs.push({ ayah: word.ayah, words: [word] });
              }

              return (
                <div
                  className={`mushaf-paper-line mushaf-paper-line--text${line.ragged ? ' mushaf-paper-line--ragged' : ''}`}
                  key={line.key}
                >
                  {runs.map((run) => {
                    const isActive =
                      line.surahId === activeAyah?.surahId && run.ayah === activeAyah.ayahNumber;
                    return (
                      <span
                        className={isActive ? 'mushaf-paper-ayah mushaf-paper-ayah--active' : 'mushaf-paper-ayah'}
                        key={`${line.key}a${run.ayah}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`آية ${toArabicNumber(run.ayah)} من سورة ${surahName}`}
                        onClick={() => onAyahPress?.(line.surahId, run.ayah)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onAyahPress?.(line.surahId, run.ayah);
                          }
                        }}
                      >
                        {run.words.map((word, index) => (
                          <Fragment key={`${line.key}w${run.ayah}_${index}`}>
                            {word.text}
                            {word.endsAyah && (
                              <span className="mushaf-paper-ayah-mark" aria-hidden="true">
                                {toArabicNumber(word.ayah)}
                              </span>
                            )}
                            {/* A real space, so justification has something to distribute.
                                Without one the whole line reads as a single word to the browser
                                and stretches badly. The last word of a line carries none —
                                trailing space is invisible and would only stretch. */}
                            {index < run.words.length - 1 && ' '}
                          </Fragment>
                        ))}
                        {/* Separator between two ayahs on one line. */}
                        {' '}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="mushaf-paper-folio">
            <span>الجزء {toArabicNumber(juz)}</span>
            <span className="mushaf-paper-folio__page">{toArabicNumber(page)}</span>
            <span>الحزب {toArabicNumber(hizb)}</span>
          </div>
          {pageMeta?.isSajdah && (
            <span className="mushaf-paper-sajdah" aria-label="موضع سجدة">
              ۩
            </span>
          )}
        </div>
      ) : (
        <>
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
              return (
                <span key={`${ayah.surahId}:${ayah.ayahNumber}`}>
                  <span
                    className="mushaf-ayah"
                    role="button"
                    tabIndex={0}
                    title="اضغط لعرض التفسير"
                    aria-label={`آية ${toArabicNumber(ayah.ayahNumber)} من سورة ${ayah.surahName} — اضغط لعرض التفسير`}
                    onClick={() => onAyahPress?.(ayah.surahId, ayah.ayahNumber)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onAyahPress?.(ayah.surahId, ayah.ayahNumber);
                      }
                    }}
                    style={isActive ? { background: 'var(--wash)' } : undefined}
                  >
                    {ayah.text}
                  </span>
                  <span className="mushaf-ayah-mark" aria-hidden="true">
                    {toArabicNumber(ayah.ayahNumber)}
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
          <div className="mushaf-folio">{toArabicNumber(page)}</div>
        </>
      )}
    </div>
  );
}
