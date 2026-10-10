import { List, SlidersHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import { ZOOM_MIN, ZOOM_MAX, type MushafPrefs, type SheetName } from '@/components/mushaf/readerConfig';

interface MushafDockProps {
  currentPage: number;
  totalPages: number;
  openJumpSheet: () => void;
  sheet: SheetName | null;
  setSheet: (sheet: SheetName | null) => void;
  zoomOut: () => void;
  zoomIn: () => void;
  zoomPercent: number;
  prefs: MushafPrefs;
}

export function MushafDock({
  currentPage,
  totalPages,
  openJumpSheet,
  sheet,
  setSheet,
  zoomOut,
  zoomIn,
  zoomPercent,
  prefs,
}: MushafDockProps) {
  return (
    <>
      {/* ── Below the page: where you are going ────────────────────────── */}
      <footer className="mushaf-dock">
        <div className="mushaf-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(1.5, (currentPage / totalPages) * 100)}%` }} />
        </div>

        <div className="mushaf-tools">
          <button className="mushaf-tool" onClick={openJumpSheet} aria-expanded={sheet === 'jump'}>
            <List size={15} aria-hidden="true" /> انتقال إلى
          </button>

          <div className="mushaf-zoom">
            <button onClick={zoomOut} disabled={prefs.zoom <= ZOOM_MIN} aria-label="تصغير الصفحة">
              <ZoomOut size={15} />
            </button>
            <span className="mushaf-zoom__value">{toArabicNumber(zoomPercent)}%</span>
            <button onClick={zoomIn} disabled={prefs.zoom >= ZOOM_MAX} aria-label="تكبير الصفحة">
              <ZoomIn size={15} />
            </button>
          </div>

          <button
            className="mushaf-tool"
            onClick={() => setSheet(sheet === 'options' ? null : 'options')}
            aria-expanded={sheet === 'options'}
          >
            <SlidersHorizontal size={15} aria-hidden="true" /> خيارات القراءة
          </button>
        </div>
      </footer>
    </>
  );
}
