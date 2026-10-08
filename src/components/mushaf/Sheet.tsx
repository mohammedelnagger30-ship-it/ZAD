import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';

interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement>;
  /**
   * Puts the app's dark palette on the subtree. Only the reading modes that
   * need it ask for it — the recitation card is the one piece of shared
   * chrome here that still styles itself with `dark:` variants.
   */
  darkSurface?: boolean;
  children: ReactNode;
}

/**
 * The sheet that rises from the foot of the mushaf: a grip, a title, one close
 * button, and whatever the screen underneath has to say. The reader has always
 * asked it its questions — the ayah's own «التفسير / التلاوة», the jump, the
 * settings — and the surah view asks the same question of its own ayahs, so the
 * component lives here, between the two, rather than in either one.
 *
 * Its colours come from the chrome tokens: inside `.mushaf-shell` the reading
 * mode answers them, outside it the app theme does.
 */
export function Sheet({ open, title, onClose, panelRef, darkSurface = false, children }: SheetProps) {
  if (!open) return null;

  return (
    <div className="mushaf-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mushaf-sheet__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className={`mushaf-sheet__panel${darkSurface ? ' dark' : ''}`}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="mushaf-sheet__grip" aria-hidden="true" />
        <div className="mushaf-sheet__head">
          <h2 className="mushaf-sheet__title">{title}</h2>
          <button className="mushaf-iconbtn" onClick={onClose} aria-label="إغلاق">
            <X size={18} />
          </button>
        </div>
        <div className="mushaf-sheet__body">{children}</div>
      </div>
    </div>
  );
}
