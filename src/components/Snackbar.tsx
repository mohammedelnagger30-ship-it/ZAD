import { Undo2, X } from 'lucide-react';

export interface SnackbarAction {
  label: string;
  onAction: () => void;
}

interface SnackbarProps {
  open: boolean;
  message: string;
  action?: SnackbarAction;
  onAction: () => void;
  onDismiss: () => void;
}

/**
 * The bar that reports a finished action and offers to undo it.
 *
 * It sits at the bottom, inside thumb reach, announced politely so a screen
 * reader hears «حُذفت العلامة» and then the button that takes it back — and
 * it is the reason a deletion needs no «أنت متأكد؟» first. A question costs a
 * tap on every deletion and still cannot be answered correctly after the
 * fact; an undo costs nothing until it is wanted, and then it is the right
 * answer.
 *
 * The `key` lives on the element in `useSnackbar`, not here: a second
 * deletion replaces one already on screen, and re-mounting the bar is what
 * replays the entrance animation instead of silently rewording it.
 */
export function Snackbar({ open, message, action, onAction, onDismiss }: SnackbarProps) {
  if (!open) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-primary-700 bg-primary-900 px-3.5 py-2.5 text-sm text-primary-50 shadow-2xl animate-slide-up dark:border-primary-700 dark:bg-primary-900"
      >
        <p className="min-w-0 flex-1 leading-relaxed">{message}</p>
        {action && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-gold-300 transition-colors hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            <Undo2 size={15} aria-hidden="true" />
            {action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق التنبيه"
          className="shrink-0 rounded-lg p-1.5 text-primary-400 transition-colors hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
