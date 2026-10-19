import { useSyncExternalStore } from 'react';
import {
  getRecitationProgress,
  getRecitationState,
  subscribeRecitation,
  subscribeRecitationProgress,
  type RecitationProgress,
  type RecitationState,
} from '@/utils/recitationEngine';
import {
  isRecitationSheetOpen,
  subscribeRecitationSheet,
} from '@/utils/recitationPlayerUi';

/**
 * The recitation engine's whole state.
 *
 * For the surfaces that render the recitation itself: the expanded player, and the
 * reader's own «تلاوة صوتية» panel. Everything else in the app should use
 * {@link useRecitationVisible} instead — the engine patches on every ayah boundary
 * while a surah sounds, and a component that only needs to know *whether* anything is
 * playing has no business re-rendering at that rate.
 */
export function useRecitation(): RecitationState {
  return useSyncExternalStore(subscribeRecitation, getRecitationState);
}

/**
 * Where the needle is, and how long the recording is.
 *
 * A store of its own so the progress line and the scrubber — and only they — redraw
 * several times a second while a surah plays.
 */
export function useRecitationProgress(): RecitationProgress {
  return useSyncExternalStore(subscribeRecitationProgress, getRecitationProgress);
}

/**
 * Whether a recitation is in flight: started, and not stopped since.
 *
 * A single boolean, so `useSyncExternalStore` bails out of every re-render the engine
 * causes while the answer is unchanged. The mini bar's visibility rides on this.
 */
export function useRecitationVisible(): boolean {
  return useSyncExternalStore(subscribeRecitation, recitationIsVisible);
}

function recitationIsVisible(): boolean {
  const state = getRecitationState();
  return state.sessionOpen && state.surahId !== null;
}

/** Whether the expanded player is showing. */
export function useRecitationSheetOpen(): boolean {
  return useSyncExternalStore(subscribeRecitationSheet, isRecitationSheetOpen);
}
