/**
 * Whether the expanded recitation player is showing — kept outside React.
 *
 * The system's own player card needs this. Tapping it brings the app forward, and the
 * app should land on the player the listener just tapped for rather than on whatever
 * screen was left behind; that tap arrives as a native event inside
 * `@/utils/recitationEngine`'s media-session layer, which has no component to call
 * into. A module-level store, read with `useSyncExternalStore`, lets the native event
 * open the sheet without threading a callback from the engine up through the whole app.
 */

let sheetOpen = false;
const listeners = new Set<() => void>();

export function subscribeRecitationSheet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isRecitationSheetOpen(): boolean {
  return sheetOpen;
}

export function setRecitationSheetOpen(open: boolean): void {
  if (sheetOpen === open) return;
  sheetOpen = open;
  for (const listener of [...listeners]) listener();
}

export function toggleRecitationSheet(): void {
  setRecitationSheetOpen(!sheetOpen);
}

/** Called when the system card is tapped: bring the expanded player up. */
export function openRecitationPlayer(): void {
  setRecitationSheetOpen(true);
}
