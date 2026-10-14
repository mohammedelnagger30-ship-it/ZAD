import { useEffect, useRef } from 'react';
import { registerOverlay } from '@/utils/overlayRegistry';

/**
 * Hands the Android back button to an open overlay: while `active` is true the
 * back press calls `dismiss` — the newest open overlay wins — instead of
 * navigating a screen the user cannot see or exiting the app.
 *
 * `active` is the overlay's open prop, or a literal `true` for overlays that
 * are mounted only while open (conditional render) and unmount on close. The
 * dismiss callback is read through a ref so a re-render of the overlay — which
 * would otherwise reshuffle the registry's order — cannot change which
 * overlay sits on top.
 */
export function useOverlayDismiss(active: boolean, dismiss: () => void): void {
  const dismissRef = useRef(dismiss);
  useEffect(() => {
    dismissRef.current = dismiss;
  }, [dismiss]);
  useEffect(() => {
    if (!active) return;
    return registerOverlay(() => dismissRef.current());
  }, [active]);
}
