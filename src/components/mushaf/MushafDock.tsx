import { List, SlidersHorizontal } from 'lucide-react';
import { type SheetName } from '@/components/mushaf/readerConfig';

interface MushafDockProps {
  currentPage: number;
  totalPages: number;
  openJumpSheet: () => void;
  sheet: SheetName | null;
  setSheet: (sheet: SheetName | null) => void;
}

export function MushafDock({
  currentPage,
  totalPages,
  openJumpSheet,
  sheet,
  setSheet,
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
