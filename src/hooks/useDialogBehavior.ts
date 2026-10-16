import { useEffect, type RefObject } from 'react';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';

/**
 * The contract a dialog owes the keyboard, the screen reader and the Android
 * back button.
 *
 * Every surface in the app is free to hand-roll this, and mostly did — which is
 * how the app ended up with `role="dialog"` on some sheets and nothing at all on
 * others, Escape on three surfaces out of ten, and no focus trap anywhere. Two
 * of the screen-level dialogs (the prayer screen's location picker and iqamah
 * editor) were not in the overlay registry either, so the Android back button
 * fell through to screen navigation and unmounted the whole screen from behind
 * a dialog the user thought they were dismissing.
 *
 * One hook gives all of it at once:
 *   * back closes the dialog, not the screen (newest overlay wins);
 *   * Escape closes it from anywhere, including when focus has escaped;
 *   * focus moves into the dialog on open and returns where it came from;
 *   * Tab cannot walk out of the dialog into the page behind it.
 *
 * `containerRef` must point at the focusable panel — the element with
 * `role="dialog"` — not the backdrop.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useDialogBehavior(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
): void {
  // Back navigation belongs to the dialog while it is open. The dismiss callback
  // goes through a ref inside `useOverlayDismiss`, so a re-render cannot reshuffle
  // which overlay sits on top.
  useOverlayDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move focus in without stealing it from an input the user is already typing
    // in — the picker's search field, for instance.
    if (previouslyFocused?.tagName !== 'INPUT') {
      containerRef.current?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [open, onClose, containerRef]);
}
