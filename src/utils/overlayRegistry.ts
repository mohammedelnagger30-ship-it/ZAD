/**
 * Open-overlay registry for the Android back button.
 *
 * The native back handler lives in App and cannot know about every overlay
 * surface the app draws. Before this existed, pressing back with a sheet or
 * dialog open navigated the screen underneath it, and back during the adhan
 * page exited the app entirely — mid-call.
 *
 * Every overlay registers its own dismiss action while it is open (newest
 * last); the back handler dismisses the newest one and falls through to screen
 * navigation only when nothing is open.
 */

const openOverlays: Array<() => void> = [];

/**
 * Register a dismiss callback for as long as an overlay is open. Returns the
 * unregister function — call it from the same effect's cleanup so closing the
 * overlay removes it from the stack.
 */
export function registerOverlay(dismiss: () => void): () => void {
  openOverlays.push(dismiss);
  return () => {
    const index = openOverlays.lastIndexOf(dismiss);
    if (index !== -1) openOverlays.splice(index, 1);
  };
}

/**
 * Dismiss the most recently opened overlay. Returns false when no overlay is
 * open, so the caller can carry on with its own back behaviour (navigate, or
 * exit on the home screen).
 */
export function dismissTopOverlay(): boolean {
  const dismiss = openOverlays[openOverlays.length - 1];
  if (!dismiss) return false;
  dismiss();
  return true;
}
