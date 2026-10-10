import { Bookmark, Moon, SlidersHorizontal, Sun, X } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import { type MushafPrefs, type SheetName } from '@/components/mushaf/readerConfig';

interface MushafHeaderProps {
  onClose: () => void;
  surahsOnPage: { name: string }[];
  currentJuz: number;
  currentHizb: number;
  currentPage: number;
  isBookmarked: boolean;
  toggleBookmark: (page: number) => void;
  mode: MushafPrefs['mode'];
  updatePrefs: (patch: Partial<MushafPrefs>) => void;
  sheet: SheetName | null;
  setSheet: (sheet: SheetName | null) => void;
}

export function MushafHeader({
  onClose,
  surahsOnPage,
  currentJuz,
  currentHizb,
  currentPage,
  isBookmarked,
  toggleBookmark,
  mode,
  updatePrefs,
  sheet,
  setSheet,
}: MushafHeaderProps) {
  return (
    <>
      {/* ── Above the page: who you are reading ─────────────────────────── */}
      <header className="mushaf-topbar">
        <button className="mushaf-iconbtn" onClick={onClose} aria-label="إغلاق المصحف">
          <X size={20} />
        </button>

        <div className="mushaf-heading">
          <p className="mushaf-heading__title">
            {surahsOnPage.length > 0 ? surahsOnPage.map((s) => s.name).join(' · ') : `الجزء ${toArabicNumber(currentJuz)}`}
          </p>
          <p className="mushaf-heading__meta">
            الجزء {toArabicNumber(currentJuz)} · الحزب {toArabicNumber(currentHizb)}
          </p>
        </div>

        <div className="mushaf-actions">
          <button
            className="mushaf-iconbtn mushaf-iconbtn--gold"
            onClick={() => toggleBookmark(currentPage)}
            aria-label={isBookmarked ? 'إزالة العلامة من هذه الصفحة' : 'حفظ هذه الصفحة'}
            aria-pressed={isBookmarked}
          >
            <Bookmark size={17} className={isBookmarked ? 'fill-current' : ''} />
          </button>
          <button
            className="mushaf-iconbtn"
            onClick={() => updatePrefs({ mode: mode === 'night' ? 'day' : 'night' })}
            aria-label={mode === 'night' ? 'الوضع النهاري' : 'الوضع الليلي'}
            aria-pressed={mode === 'night'}
          >
            {mode === 'night' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="mushaf-iconbtn"
            onClick={() => setSheet(sheet === 'options' ? null : 'options')}
            aria-label="خيارات القراءة"
            aria-expanded={sheet === 'options'}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>
    </>
  );
}
