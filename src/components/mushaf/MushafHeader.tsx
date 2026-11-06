import { Bookmark, Layers, Moon, SlidersHorizontal, Sun, X } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import { type MushafPrefs, type SheetName } from '@/components/mushaf/readerConfig';

interface MushafHeaderProps {
  onClose: () => void;
  surahsOnPage: { name: string }[];
  currentJuz: number;
  currentHizb: number;
  currentPage: number;
  openJuzPicker: () => void;
  isBookmarked: boolean;
  toggleBookmark: (page: number) => void;
  mode: MushafPrefs['mode'];
  updatePrefs: (patch: Partial<MushafPrefs>) => void;
  sheet: SheetName | null;
  setSheet: (sheet: SheetName | null) => void;
  // Optional progress information string to display reading progress
  progressInfo?: string;
}

export function MushafHeader({
  onClose,
  surahsOnPage,
  currentJuz,
  currentHizb,
  currentPage,
  openJuzPicker,
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
          <div className="mushaf-heading__meta flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={openJuzPicker}
              aria-label={`الانتقال إلى الجزء ${toArabicNumber(currentJuz)}`}
              title="اختر جزءًا للقراءة"
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-800"
            >
              <Layers size={12} aria-hidden="true" />
              الجزء {toArabicNumber(currentJuz)}
            </button>
            <span aria-hidden="true">·</span>
            <span>الحزب {toArabicNumber(currentHizb)}</span>
          </div>
        </div>

        <div className="mushaf-actions">
          <button
            className="mushaf-iconbtn mushaf-iconbtn--gold"
            onClick={() => toggleBookmark(currentPage)}
            aria-label={isBookmarked ? 'إلغاء حفظ هذه الصفحة' : 'حفظ هذه الصفحة'}
            title={isBookmarked ? 'الصفحة محفوظة في العلامات' : 'إضافة الصفحة إلى العلامات المحفوظة'}
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
