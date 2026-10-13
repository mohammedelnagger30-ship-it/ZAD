import { useCallback, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirmations paint the confirm button red and warn with an icon. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A confirmation dialog in the app's own design language.
 *
 * The app used native `confirm()` for destructive actions (deleting a plan, ending a
 * khatmah, restoring a backup), which breaks the visual language and gives no control
 * over wording or touch targets. This dialog follows the same accessibility contract
 * the other sheets keep: `role="dialog"` + `aria-modal`, Escape and backdrop press
 * cancel, body scroll is locked while it is open, and initial focus lands on the
 * cancel button so a stray tap cannot confirm a destructive action.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelWrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    // Initial focus on cancel: Enter without an explicit choice cancels rather than
    // confirming — the safe default for a destructive dialog.
    cancelWrapRef.current?.querySelector('button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    },
    [onCancel],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-3xl border border-primary-100 bg-white p-5 shadow-2xl animate-scale-in dark:border-primary-800 dark:bg-primary-900"
      >
        <div className="flex items-start gap-3">
          {destructive && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-error-100 text-error-600 dark:bg-error-900/40 dark:text-error-300">
              <AlertTriangle size={20} aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3
              id="confirm-dialog-title"
              className="text-base font-bold text-primary-900 dark:text-primary-50"
            >
              {title}
            </h3>
            {description && (
              <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
                {description}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex gap-2.5">
          <Button
            variant={destructive ? 'error' : 'primary'}
            size="md"
            fullWidth
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
          {/* Button is not a ref-forwarding component; the wrapper carries the focus ref. */}
          <span ref={cancelWrapRef} className="contents">
            <Button variant="secondary" size="md" fullWidth onClick={onCancel}>
              {cancelLabel}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
