import { useMemo, useSyncExternalStore } from 'react';
import {
  getLecturePlayerState,
  getLectureProgress,
  subscribeLecturePlayer,
  subscribeLectureProgress,
  type LecturePlayerState,
  type LectureProgress,
} from '@/utils/lecturePlayer';
import { getLectureStoreSnapshot, subscribeToLectureStore } from '@/utils/lectureStore';
import {
  lectureProgressRevision,
  lectureProgressStats,
  readLectureProgress,
  subscribeLectureProgress as subscribeLectureProgressRecords,
} from '@/utils/lectureProgress';

/**
 * The lecture engine's whole state: what is loaded, what is queued, whether it is running.
 * For the player bar and the cards that show a play button.
 */
export function useLecturePlayer(): LecturePlayerState {
  return useSyncExternalStore(subscribeLecturePlayer, getLecturePlayerState);
}

/**
 * Where the needle is, and how long the recording is. A store of its own so the clock and
 * the scrubber — and only they — redraw while a lecture plays.
 */
export function useLectureProgress(): LectureProgress {
  return useSyncExternalStore(subscribeLectureProgress, getLectureProgress);
}

/** What is on the device, and what is being fetched right now. */
export function useLectureDownloads() {
  return useSyncExternalStore(subscribeToLectureStore, getLectureStoreSnapshot);
}

/**
 * The listener's own record of the الشيخ's library: what has been heard, how far each
 * lesson got, and the figures the progress card is built from. Redraws when a record is
 * written — not on every tick of the clock, which belongs to the scrubber alone.
 */
export function useLectureProgressStats() {
  const revision = useSyncExternalStore(subscribeLectureProgressRecords, lectureProgressRevision);
  return useMemo(() => {
    void revision;
    return {
      stats: lectureProgressStats(),
      records: readLectureProgress(),
    };
  }, [revision]);
}
