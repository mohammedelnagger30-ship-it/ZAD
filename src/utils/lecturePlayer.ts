import { hasAudioFocus, registerAudioSource, takeAudioFocus } from '@/utils/audioFocus';
import { resolveLecturePlayUrl } from '@/utils/lectureStore';
import { markLectureComplete, recordLectureProgress } from '@/utils/lectureProgress';
import {
  clearMediaSession,
  reportMediaProgress,
  setMediaPlaybackState,
  setMediaSession,
  updateMediaPosition,
} from '@/utils/mediaSession';
import type { HuwainiLecture } from '@/data/scholarHuwaini';

/**
 * The lecture that is sounding, wherever the listener is.
 *
 * Module-scoped and never torn down, for the same reason the recitation engine is: a
 * lecture runs for an hour while the listener moves around the app, and a player that
 * lived inside a screen would be unmounted the moment they did. The bar is only a view;
 * the sound is here.
 *
 * Two stores, deliberately split. This one changes when the *choice* changes — what is
 * playing, whether it is playing — and the progress store changes on every tick. Only
 * the scrubber and the clock subscribe to the second, so a running lecture does not
 * redraw the whole bar several times a second.
 */

export interface LectureQueueItem {
  lecture: HuwainiLecture;
  /** archive.org item holding the file. */
  item: string;
  /** The card this lecture belongs to, shown as the album on the lock screen. */
  album?: string;
}

export interface LecturePlayerState {
  current: LectureQueueItem | null;
  queue: LectureQueueItem[];
  index: number;
  isPlaying: boolean;
  loading: boolean;
  rate: number;
  error: string | null;
}

export interface LectureProgress {
  positionMs: number;
  durationMs: number;
}

type Listener = () => void;

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;

const ARTIST = 'أبو إسحاق الحويني';
const POSITION_PREFIX = 'huwaini_pos_';

let state: LecturePlayerState = {
  current: null,
  queue: [],
  index: -1,
  isPlaying: false,
  loading: false,
  rate: 1,
  error: null,
};
let progress: LectureProgress = { positionMs: 0, durationMs: 0 };

const stateListeners = new Set<Listener>();
const progressListeners = new Set<Listener>();

function emitState(): void {
  for (const listener of stateListeners) listener();
}

function emitProgress(): void {
  for (const listener of progressListeners) listener();
}

export function subscribeLecturePlayer(listener: Listener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getLecturePlayerState(): LecturePlayerState {
  return state;
}

export function subscribeLectureProgress(listener: Listener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

export function getLectureProgress(): LectureProgress {
  return progress;
}

function patch(next: Partial<LecturePlayerState>): void {
  state = { ...state, ...next };
  emitState();
}

function patchProgress(next: Partial<LectureProgress>): void {
  progress = { ...progress, ...next };
  emitProgress();
}

// ---------------------------------------------------------------------------
// The element
// ---------------------------------------------------------------------------

let audioElement: HTMLAudioElement | null = null;
let lastPositionSave = 0;
/**
 * True while {@link resolveAndPlay} is still working through its retries.
 *
 * The element's `error` listener reports a dead source to the listener, but a failure
 * that is about to be retried under a different URL is not news — it is the mechanism
 * working. Without this the listener would see «تعذّر تشغيل هذه المحاضرة» flash up
 * while a working URL was still being found.
 */
let retryingStream = false;
/**
 * When the clock last reported, for measuring how much of the lecture was genuinely
 * heard. A tick is not a fixed length — the WebView fires `timeupdate` at its own
 * cadence, and a backgrounded tab fires it rarely — so progress is summed from the
 * elapsed time rather than counted in ticks.
 */
let lastTickAt = 0;
/**
 * Listened seconds accumulated since the record was last written.
 *
 * `timeupdate` fires several times a second, and writing the whole progress map on every
 * one of them would re-parse and re-serialise it four times a second for no gain. So the
 * seconds accrue in memory and are folded into the record on a slower cadence — and
 * immediately whenever the moment matters: a pause, a seek, the end of the file.
 */
let pendingListenedSeconds = 0;
let lastProgressFlush = 0;
const PROGRESS_FLUSH_MS = 5000;

function readSavedPosition(id: string): number {
  try {
    const raw = globalThis.localStorage?.getItem(POSITION_PREFIX + id);
    const value = Number(raw);
    return Number.isFinite(value) && value > 5000 ? value : 0;
  } catch {
    return 0;
  }
}

function savePosition(id: string, positionMs: number, force: boolean): void {
  const now = Date.now();
  if (!force && now - lastPositionSave < 5000) return;
  lastPositionSave = now;
  try {
    // A lecture watched to the end should start over, not resume at the last second.
    if (positionMs < 5000) globalThis.localStorage?.removeItem(POSITION_PREFIX + id);
    else globalThis.localStorage?.setItem(POSITION_PREFIX + id, String(Math.round(positionMs)));
  } catch {
    // Private mode, or storage full: remembering the position is a convenience, not a duty.
  }
}

/** Write what has accrued to the listener's record, and start the next batch from zero. */
function flushProgress(id: string, positionMs: number, durationMs: number): void {
  const delta = pendingListenedSeconds;
  pendingListenedSeconds = 0;
  lastProgressFlush = Date.now();
  recordLectureProgress({ id, position: positionMs, duration: durationMs, listenedDelta: delta });
}

function clearSavedPosition(id: string): void {
  try {
    globalThis.localStorage?.removeItem(POSITION_PREFIX + id);
  } catch {
    // Nothing to clear.
  }
}

function syncProgress(): void {
  const audio = audioElement;
  if (!audio) return;
  const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
  const positionMs = Math.round(audio.currentTime * 1000);
  patchProgress({ positionMs, durationMs });
  const current = state.current;
  if (!current || state.loading) {
    lastTickAt = Date.now();
    return;
  }
  // Only time that passed while the audio was actually rolling counts as listening. The
  // cap keeps a sleeping device from crediting an hour it did not play.
  const now = Date.now();
  if (lastTickAt > 0 && !audio.paused) {
    pendingListenedSeconds += Math.min((now - lastTickAt) / 1000, 5);
  }
  lastTickAt = now;
  // The needle's position is cheap to remember and worth keeping current; the accumulated
  // seconds ride along with it on the slower cadence.
  if (now - lastProgressFlush >= PROGRESS_FLUSH_MS) {
    flushProgress(current.lecture.id, positionMs, durationMs);
  }
}

/**
 * Publishes the lecture to the OS.
 *
 * This used to talk to `navigator.mediaSession` directly, which meant the lock-screen
 * card existed only where the WebView implemented that API — and Android's WebView does
 * not. Leaving the app there ended the lecture's presence in the notification tray: the
 * sound kept going with nothing to control it. `@/utils/mediaSession` carries the same
 * metadata to *both* the web API and the app's own Android player card, so one call here
 * now reaches every platform the app ships on.
 *
 * The lecture and the recitation share that one card, and only ever one of them sounds —
 * `audioFocus` silences the other before this runs, so the card is never contested.
 */
function publishMediaSession(item: LectureQueueItem): void {
  // The lecture may have been interrupted a moment ago by a recitation taking the floor.
  // The event that reports the interruption lands on a queued task, so this can still be
  // called after the other player already claimed the shared card — in which case it must
  // not write, or it would repaint the card with a lecture that is no longer sounding.
  if (!hasAudioFocus('lecture')) return;
  setMediaSession(
    {
      title: item.lecture.title,
      artist: ARTIST,
      album: item.album ?? 'الشيخ أبو إسحاق الحويني',
      artworkUrl: '/icons/icon-512.png',
      // At the ends of the queue there is nothing to skip to; the card is told so rather
      // than offered a button that would do nothing.
      hasNext: canPlayNext(),
      hasPrevious: canPlayPrevious(),
    },
    {
      onPlay: () => togglePlay(),
      onPause: () => pauseLecture(),
      onStop: () => pauseLecture(),
      onPrevious: () => playPrevious(),
      onNext: () => playNext(),
      onSeekBack: () => seekLecture(Math.max(0, progress.positionMs - 15000)),
      onSeekForward: () => seekLecture(progress.positionMs + 15000),
      // The system scrubber was dragged: the position is handed straight to the element.
      onSeek: (positionMs) => seekLecture(positionMs),
    },
  );
}

/**
 * The position the system should show — reported on the moments it cannot infer.
 *
 * Like {@link publishMediaSession}, this stays off the shared card once another source
 * has taken the floor: an interrupted lecture reporting a position would repaint the
 * card that now belongs to the recitation.
 */
function reportLectureProgress(): void {
  const audio = audioElement;
  if (!audio || !hasAudioFocus('lecture')) return;
  reportMediaProgress({
    positionMs: progress.positionMs,
    durationMs: progress.durationMs,
    playbackRate: state.rate,
  });
  // The web card also needs the element itself to keep its own scrubber honest.
  updateMediaPosition(audio);
}

/**
 * Playback state, but only while this player still owns the card.
 *
 * The `pause` event is queued rather than fired inline, so when a recitation interrupts a
 * lecture the lecture's own pause handler runs a beat *after* the recitation has claimed
 * the session — and would otherwise stamp it «paused» while it is playing.
 */
function setLecturePlaybackState(next: 'playing' | 'paused'): void {
  if (!hasAudioFocus('lecture')) return;
  setMediaPlaybackState(next);
}

function audioEl(): HTMLAudioElement {
  if (audioElement) return audioElement;
  const audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', () => {
    const current = state.current;
    // Resume where the listener stopped — but only once the length is known, or a seek
    // past the end would be silently clamped to zero.
    if (current) {
      const saved = readSavedPosition(current.lecture.id);
      if (saved > 0 && (!audio.duration || saved < audio.duration * 1000 - 5000)) {
        audio.currentTime = saved / 1000;
      }
    }
    patch({ loading: false });
    syncProgress();
  });
  audio.addEventListener('timeupdate', () => {
    syncProgress();
    const current = state.current;
    if (current) savePosition(current.lecture.id, audio.currentTime * 1000, false);
  });
  audio.addEventListener('play', () => {
    // A fresh baseline, so the pause that preceded this never lands in the listened total.
    lastTickAt = Date.now();
    patch({ isPlaying: true, loading: false });
    // The notification card and the lock screen must follow the element, whichever end
    // the play came from — a headset button as readily as the on-screen one.
    setLecturePlaybackState('playing');
  });
  audio.addEventListener('pause', () => {
    lastTickAt = 0;
    // A pause is exactly when the listener expects their place — and their time — to be
    // safe, so the batch is written now rather than whenever the clock next reaches five
    // seconds.
    const current = state.current;
    if (current) {
      flushProgress(current.lecture.id, Math.round(audio.currentTime * 1000), Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0);
    }
    patch({ isPlaying: false });
    setLecturePlaybackState('paused');
    // The scrubber the OS is showing has just stopped moving on its own; tell it where.
    syncProgress();
    reportLectureProgress();
  });
  audio.addEventListener('ended', () => {
    const current = state.current;
    if (current) {
      // Carried to the end: the one moment completion is beyond doubt, whatever the file
      // claimed its length was.
      flushProgress(current.lecture.id, Math.round(audio.currentTime * 1000), Math.round((audio.duration || 0) * 1000));
      markLectureComplete(current.lecture.id, Math.round((audio.duration || 0) * 1000));
      clearSavedPosition(current.lecture.id);
    }
    lastTickAt = 0;
    if (canPlayNext()) playNext();
    else patch({ isPlaying: false });
  });
  audio.addEventListener('error', () => {
    // While a retry is in flight this failure is a step on the way, not the end — and
    // the listener is told so by the retry itself when it runs out of URLs.
    if (retryingStream) return;
    // A missing file is the one error worth naming; anything else is generic.
    patch({ isPlaying: false, loading: false, error: 'تعذّر تشغيل هذه المحاضرة' });
  });
  if (typeof document !== 'undefined') document.body.appendChild(audio);
  audioElement = audio;
  return audio;
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function loadItem(item: LectureQueueItem): void {
  const audio = audioEl();
  // Whatever the lecture being replaced had accrued belongs to *it*, not to the one about
  // to start: fold it in before the switch, or the seconds land on the wrong record.
  const previous = state.current;
  if (previous && previous.lecture.id !== item.lecture.id) {
    flushProgress(
      previous.lecture.id,
      Math.round(audio.currentTime * 1000),
      Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0,
    );
  } else {
    pendingListenedSeconds = 0;
  }
  patch({ current: item, loading: true, error: null });
  patchProgress({ positionMs: 0, durationMs: item.lecture.seconds * 1000 });
  void resolveAndPlay(item, audio);
}

/**
 * Attempts at opening the stream before the listener is told it failed, including the
 * first. Three is what it takes for the sticky redirect to be asked under enough
 * different URLs that one of them lands on a node that answers.
 */
const STREAM_ATTEMPTS = 3;

/** Delay before the second attempt; it doubles from there. */
const STREAM_RETRY_DELAY_MS = 300;

function streamRetryDelay(attempt: number): number {
  return STREAM_RETRY_DELAY_MS * 2 ** (attempt - 1);
}

async function resolveAndPlay(item: LectureQueueItem, audio: HTMLAudioElement): Promise<void> {
  publishMediaSession(item);
  // Failures during a retry are a step on the way, not the end — the element's own
  // `error` listener must stay quiet until the last URL has had its turn.
  retryingStream = true;
  try {
    for (let attempt = 0; attempt < STREAM_ATTEMPTS; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, streamRetryDelay(attempt)));

      let url: string;
      try {
        url = await resolveLecturePlayUrl(item.lecture, item.item, attempt);
      } catch {
        patch({ loading: false, isPlaying: false, error: 'تعذّر تجهيز المحاضرة' });
        return;
      }
      // A newer choice may have landed while the URL was being resolved.
      if (state.current?.lecture.id !== item.lecture.id) return;

      audio.src = url;
      audio.playbackRate = state.rate;
      try {
        await audio.play();
        patch({ isPlaying: true, loading: false });
        setLecturePlaybackState('playing');
        return;
      } catch (err) {
        const name = (err as Error).name;
        // An abort is the listener changing their mind, not the source refusing.
        if (name === 'AbortError') return;
        // A refusal for want of a gesture has nothing to do with which node answered —
        // another URL would be refused the same way, so do not spend the retries.
        if (name === 'NotAllowedError') {
          patch({ isPlaying: false, loading: false, error: 'تعذّر تشغيل هذه المحاضرة' });
          return;
        }
      }
    }
    patch({ isPlaying: false, loading: false, error: 'تعذّر تشغيل هذه المحاضرة' });
  } finally {
    retryingStream = false;
  }
}

/** Play a lecture, and optionally replace the queue with the card it was tapped in. */
export function playLecture(
  lecture: HuwainiLecture,
  item: string,
  queue?: LectureQueueItem[],
  album?: string,
): void {
  const chosen: LectureQueueItem = { lecture, item, album };
  let nextQueue = state.queue;
  let index = state.index;
  if (queue && queue.length > 0) {
    nextQueue = queue;
    index = queue.findIndex((entry) => entry.lecture.id === lecture.id);
    if (index < 0) {
      nextQueue = [chosen, ...queue];
      index = 0;
    }
  } else if (index < 0 || state.current?.lecture.id !== lecture.id) {
    nextQueue = [chosen];
    index = 0;
  }
  takeAudioFocus('lecture');
  patch({ queue: nextQueue, index });
  loadItem(nextQueue[index]);
}

export function togglePlay(): void {
  const audio = audioElement;
  if (!audio || !state.current) return;
  if (audio.paused) {
    takeAudioFocus('lecture');
    void audio.play().catch(() => patch({ isPlaying: false, error: 'تعذّر تشغيل هذه المحاضرة' }));
  } else {
    audio.pause();
  }
}

export function pauseLecture(): void {
  audioElement?.pause();
}

export function seekLecture(positionMs: number): void {
  const audio = audioElement;
  if (!audio) return;
  const seconds = Math.max(0, positionMs / 1000);
  audio.currentTime = seconds;
  const current = state.current;
  if (current) {
    savePosition(current.lecture.id, seconds * 1000, true);
    // A seek writes the record straight away, so the new high-water mark is on disk before
    // the page can be closed on it.
    flushProgress(
      current.lecture.id,
      seconds * 1000,
      Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0,
    );
  }
  syncProgress();
  // The system extrapolates the position from the rate and elapsed time, so a jump it
  // did not see is the one thing it cannot work out for itself.
  reportLectureProgress();
}

export function setLectureRate(rate: number): void {
  patch({ rate });
  if (audioElement) audioElement.playbackRate = rate;
  // Same reason as a seek: the OS advances the position by the rate it was last told.
  reportLectureProgress();
}

export function nextLectureRate(): number {
  const index = SPEEDS.indexOf(state.rate as (typeof SPEEDS)[number]);
  return SPEEDS[(index + 1) % SPEEDS.length];
}

export function canPlayNext(): boolean {
  return state.index >= 0 && state.index < state.queue.length - 1;
}

export function canPlayPrevious(): boolean {
  return state.index > 0;
}

export function playNext(): void {
  if (!canPlayNext()) return;
  const index = state.index + 1;
  takeAudioFocus('lecture');
  patch({ index });
  loadItem(state.queue[index]);
}

export function playPrevious(): void {
  if (!canPlayPrevious()) return;
  const index = state.index - 1;
  takeAudioFocus('lecture');
  patch({ index });
  loadItem(state.queue[index]);
}

/** Stop and forget — the bar disappears. */
export function stopLecture(): void {
  const audio = audioElement;
  const current = state.current;
  if (audio) {
    // Pausing first fires the pause handler, which folds the accrued listening into the
    // current lecture's record before the source is torn away.
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (current) savePosition(current.lecture.id, audio ? audio.currentTime * 1000 : 0, true);
  pendingListenedSeconds = 0;
  lastTickAt = 0;
  patchProgress({ positionMs: 0, durationMs: 0 });
  patch({ current: null, queue: [], index: -1, isPlaying: false, loading: false, error: null });
  // The lecture is over as far as the system is concerned: drop the card, or the
  // notification lingers offering controls for audio that is no longer there. Only if the
  // card is still this player's — closing the lecture bar while a recitation is sounding
  // must not take the recitation's card down with it.
  if (hasAudioFocus('lecture')) clearMediaSession();
}

/** Play the queue starting at, or containing, this card. */
export function playQueue(queue: LectureQueueItem[], startIndex = 0): void {
  if (queue.length === 0) return;
  const index = Math.max(0, Math.min(startIndex, queue.length - 1));
  takeAudioFocus('lecture');
  patch({ queue, index });
  loadItem(queue[index]);
}

// ---------------------------------------------------------------------------
// The rest of the app
// ---------------------------------------------------------------------------

// A recitation taking the floor silences the lecture rather than clearing it: the
// listener did not ask to lose their place, only to listen to something else.
registerAudioSource('lecture', () => pauseLecture());
