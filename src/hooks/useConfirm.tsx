import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive confirmations paint the confirm button red and warn with an icon. */
  destructive?: boolean;
}

/**
 * An imperative `confirm()` that answers a Promise, drawn in the app's own
 * dialog instead of the browser's.
 *
 * `ConfirmDialog` is declarative — it needs `open`, a `title`, and two
 * callbacks, which means every call site that today reads
 *
 *     if (!confirm('حذف هذا؟')) return;
 *
 * would have to grow a piece of state, a pending-request field, and a callback
 * just to keep saying the same thing. This hook keeps the call site as it is
 * and moves the state here: `confirm()` returns a promise the handler can
 * `await`, and the dialog element comes back alongside it for the screen to
 * render once.
 *
 * The promises are always answered. A prompt left open when its screen unmounts
 * resolves `false`, and a second prompt raised before the first was answered
 * settles the first as cancelled — otherwise a handler awaiting it would hang
 * forever with nothing to wake it.
 */
export function useConfirm(): {
  /** Shows the dialog and resolves once the person answers it. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this once, anywhere in the screen's returned tree. */
  dialog: React.ReactNode;
} {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    // A prompt can only be waiting for one answer. If a previous one is still
    // open — two buttons pressed inside a frame of each other — it is not
    // answered by the new one, so cancel it first rather than orphan it.
    resolverRef.current?.(false);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOptions(next);
    });
  }, []);

  useEffect(
    () => () => {
      // The screen went away with the dialog still open: the handler waiting
      // on it is gone too, and the polite answer to an unseen question is no.
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  return {
    confirm,
    dialog: (
      <ConfirmDialog
        open={options !== null}
        title={options?.title ?? ''}
        description={options?.description}
        confirmLabel={options?.confirmLabel}
        cancelLabel={options?.cancelLabel}
        destructive={options?.destructive}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    ),
  };
}
