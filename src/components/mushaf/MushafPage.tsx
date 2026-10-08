import { useMemo, type CSSProperties } from 'react';
import { getSurah, getSurahsForPage, getJuzForPage, toArabicNumber } from '@/data/surahs';
import { getPageMeta, getHizbForPage } from '@/data/mushafPages';
import { getAyahs } from '@/data/quranText';
import { splitBasmala } from '@/utils/basmala';

interface PageAyah {
  surahId: number;
  surahName: string;
  ayahNumber: number;
  text: string;
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
  /** Resolved Quran font size in px; the reader's zoom is folded in before this point. */
  fontSize: number;
  night: boolean;
  /** Reader default: its spacing formula at 100%. */
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
  lineHeight = 1.9,
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

  const pageStyle = {
    '--fs': `${fontSize}px`,
    '--lh': `${lineHeight}`,
    '--letter-gap': `${letterSpacing}em`,
    '--word-gap': wordSpacing === 0 ? 'normal' : `${wordSpacing}em`,
  } as CSSProperties;

  return (
    <div className={`mushaf-page${night ? ' mushaf-page--night' : ''}`} style={pageStyle}>
      {/* Ornamental frame. Decorative only, so it is hidden from assistive tech. */}
      <MushafFrameDecoration />

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
              return (
                <span key={`${ayah.surahId}:${ayah.ayahNumber}`}>
                  <span
                    className="mushaf-ayah"
                    role="button"
                    tabIndex={0}
                    title="اضغط لعرض التفسير أو التلاوة"
                    aria-label={`آية ${toArabicNumber(ayah.ayahNumber)} من سورة ${ayah.surahName} — اضغط لعرض التفسير أو التلاوة`}
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
    </div>
  );
}
