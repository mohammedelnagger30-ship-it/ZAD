import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Snackbar, type SnackbarAction } from '@/components/Snackbar';

export interface SnackbarOptions {
  message: string;
  /**
   * Present only while what just happened can still be taken back. A bar that
   * appears after something is gone for good has nothing to offer but the
   * news, and bad news with a button on it invites a tap that does nothing.
   */
  action?: SnackbarAction;
  /** Overrides the default, which is longer when there is a button to reach. */
  durationMs?: number;
}

/** Long enough to read a sentence and reach the button, short enough not to nag. */
const DEFAULT_WITH_ACTION_MS = 6000;
const DEFAULT_MS = 3500;

/**
 * Holds one message at a time and lets it time itself out.
 *
 * It is returned as an element rather than as props so a screen can keep its
 * own bar without a provider above it: only one screen is mounted at a time,
 * and a bar that outlived its screen would be offering to undo something that
 * screen no longer has. The timer is cleared on unmount for the same reason —
 * a callback firing into a component that is gone is precisely the failure
 * this whole unit exists to avoid.
 */
export function useSnackbar(): {
  /** Shows the bar until it times out, is dismissed, or is replaced. */
  show: (options: SnackbarOptions) => void;
  dismiss: () => void;
  /** Render this once, anywhere in the screen's returned tree. */
  snackbar: ReactNode;
} {
  const [current, setCurrent] = useState<(SnackbarOptions & { id: number }) | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setCurrent(null);
  }, [clearTimer]);

  const show = useCallback(
    (options: SnackbarOptions) => {
      clearTimer();
      // A fresh id remounts the bar, so the next deletion animates in rather
      // than quietly rewriting one that is already on screen.
      idRef.current += 1;
      const durationMs = options.durationMs ?? (options.action ? DEFAULT_WITH_ACTION_MS : DEFAULT_MS);
      setCurrent({ ...options, id: idRef.current });
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setCurrent(null);
      }, durationMs);
    },
    [clearTimer],
  );

  // A timer left running past unmount would fire into a screen that is gone.
  useEffect(() => clearTimer, [clearTimer]);

  const handleAction = useCallback(() => {
    // Take the callback out before clearing the bar: it usually re-renders
    // the screen that owns it, and the message it replaces must already be
    // dismissed so the two never overlap.
    const action = current?.action;
    clearTimer();
    setCurrent(null);
    action?.onAction();
  }, [current, clearTimer]);

  return {
    show,
    dismiss,
    snackbar: (
      <Snackbar
        key={current?.id}
        open={current !== null}
        message={current?.message ?? ''}
        action={current?.action}
        onAction={handleAction}
        onDismiss={dismiss}
      />
    ),
  };
}
