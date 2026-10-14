/**
 * The recitation playback engine — audio that outlives the screen that started it.
 *
 * A memoriser listens while doing something else in the app: they open the home
 * screen to mark a prayer, come back, and expect the surah still running. The
 * player used to own an `<audio>` element in its own JSX together with a
 * `useEffect` cleanup that called `stop()` — so every trip out of the reader
 * destroyed both and silenced the recitation. Lock-screen playback worked only
 * because the reader happened to stay mounted.
 *
 * Everything that must survive a screen change lives here, at module scope: the
 * element itself, the prepared source and its object URL, the verse-timing
 * pointers, the repeat counters and the Media Session. React owns presentation
 * only — the reader component subscribes with `useSyncExternalStore` and calls
 * the actions below. The element is created once and never destroyed, so
 * playback and the lock-screen card simply continue while the reader is
 * unmounted.
 *
 * Changing the track *is* a reason to stop: `setTrack` is a no-op when the
 * track is the one already held (the reader remounting over live audio) and
 * tears the old one down otherwise — a different surah or reciter has no
 * business inheriting the previous one's sound.
 */
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { loadSurahAudio, type SurahAudioSource, type VerseTiming } from '@/utils/quranAudio';
import {
  clearMediaSession,
  setMediaPlaybackState,
  setMediaSession,
  updateMediaPosition,
} from '@/utils/mediaSession';

export interface RecitationState {
  /** The surah held by the engine; null until the reader first mounts. */
  surahId: number | null;
  surahName: string | null;
  reciterId: string | null;
  /** The ayah currently sounding (or the last one, when paused). */
  activeAyah: number | null;
  /** The ayah picked in the reader — drives «استمع للآية». */
  selectedAyah: number | null;
  isPlaying: boolean;
  sourceLoading: boolean;
  /** True for a recording without verse timings (children's repetition muallim). */
  wholeFile: boolean;
  error: string | null;
  playbackRate: number;
  repeatCount: number;
}

const INITIAL_STATE: RecitationState = {
  surahId: null,
  surahName: null,
  reciterId: null,
  activeAyah: null,
  selectedAyah: 1,
  isPlaying: false,
  sourceLoading: false,
  wholeFile: false,
  error: null,
  playbackRate: 1,
  repeatCount: 3,
};

let state: RecitationState = INITIAL_STATE;
const listeners = new Set<() => void>();

/** Subscribe to engine state; returns the unsubscribe function. */
export function subscribeRecitation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current snapshot — a stable reference between changes, as useSyncExternalStore requires. */
export function getRecitationState(): RecitationState {
  return state;
}

function patch(next: Partial<RecitationState>): void {
  const keys = Object.keys(next) as (keyof RecitationState)[];
  if (keys.every((key) => next[key] === state[key])) return;
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
  syncMediaSession();
}

// ---------------------------------------------------------------------------
// Engine-owned playback pointers.
//
// These are the values that used to be refs inside the component. They are the
// reason playback could not survive navigation: a closed-over ref dies with its
// component, and `handleTimeUpdate` with it — after which a still-playing
// element would never advance to the next ayah.
// ---------------------------------------------------------------------------
let audioElement: HTMLAudioElement | null = null;
let sourceRef: SurahAudioSource | null = null;
let sourceUrlRef: string | null = null;
let loadInFlightRef: Promise<SurahAudioSource | null> | null = null;
let loadControllerRef: AbortController | null = null;
let activeAyahRef: number | null = null;
let continuousRef = false;
let verseEndRef: number | null = null;
let repeatRemainingRef = 1;
let currentTimingRef: VerseTiming | null = null;

/**
 * The one audio element, created lazily and never torn down.
 *
 * Appended to `document.body` rather than left detached: the Media Session is
 * driven by the page's media playback, and an element the document does not
 * hold is exactly the kind of thing a WebView is entitled to treat as not
 * part of it. It has no `controls`, so it renders nothing.
 */
function audioEl(): HTMLAudioElement {
  if (audioElement) return audioElement;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('timeupdate', handleTimeUpdate);
  audio.addEventListener('ended', handleEnded);
  audio.addEventListener('error', handleAudioError);
  if (typeof document !== 'undefined') document.body.appendChild(audio);
  audioElement = audio;
  return audio;
}

// ---------------------------------------------------------------------------
// Media events
// ---------------------------------------------------------------------------

// Seamless real-time timeupdate handler
function handleTimeUpdate(): void {
  const audio = audioElement;
  const prepared = sourceRef;
  if (!audio || !prepared) return;
  // Keep the lock-screen position bar in step with the element.
  updateMediaPosition(audio);
  // A whole-file recording has no ayah boundaries to track: the `ended`
  // event stops it.
  if (prepared.verseTimings.length === 0) return;

  const currentMs = audio.currentTime * 1000;

  // 1. Continuous Surah Playback mode (Seamless stream, no pauses between verses!)
  if (continuousRef) {
    const currentVerse = prepared.verseTimings.find(
      (v) => currentMs >= v.startMs && currentMs < v.endMs
    );

    if (currentVerse && currentVerse.ayah !== activeAyahRef) {
      activeAyahRef = currentVerse.ayah;
      patch({ activeAyah: currentVerse.ayah, selectedAyah: currentVerse.ayah });
    }

    // Check if we've reached the end of the last verse
    const lastVerse = prepared.verseTimings[prepared.verseTimings.length - 1];
    if (currentMs >= lastVerse.endMs) {
      stop();
    }
    return;
  }

  // 2. Single Ayah repeat mode.
  //
  // `repeatRemainingRef` counts the plays left; 0 is the «مستمر» option and means
  // "no end in sight" — loop the ayah until stopped. The old `> 1` treated 0 as
  // "no plays left", so «مستمر» played exactly once and stopped at the verse end.
  if (verseEndRef !== null && audio.currentTime >= verseEndRef) {
    const remaining = repeatRemainingRef;
    if (remaining === 0 || remaining > 1) {
      if (remaining > 1) repeatRemainingRef = remaining - 1;
      if (currentTimingRef) {
        audio.currentTime = currentTimingRef.startMs / 1000;
      }
    } else {
      stop();
    }
  }
}

function handleEnded(): void {
  const prepared = sourceRef;
  // A whole-file recording simply stops at its end; only a timed
  // continuous play walks on to the next ayah by itself.
  if (!continuousRef || !prepared || prepared.verseTimings.length === 0) {
    stop();
    return;
  }
  // In continuous mode, stop playback only if we've reached the last verse
  if (activeAyahRef === prepared.verseTimings[prepared.verseTimings.length - 1].ayah) {
    stop();
  } else {
    // If playback ended unexpectedly in continuous mode, try to continue
    // This handles cases where the audio file might have buffering issues
    const nextAyah = activeAyahRef ? activeAyahRef + 1 : 1;
    if (nextAyah <= prepared.verseTimings.length) {
      playAyah(nextAyah, true);
    } else {
      stop();
    }
  }
}

function handleAudioError(): void {
  const prepared = sourceRef;
  if (continuousRef && state.isPlaying && prepared) {
    // Try to recover from errors in continuous mode
    const nextAyah = activeAyahRef ? activeAyahRef + 1 : 1;
    if (nextAyah <= prepared.verseTimings.length) {
      playAyah(nextAyah, true);
    } else {
      stop();
    }
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Stop playback completely. */
export function stop(): void {
  audioElement?.pause();
  activeAyahRef = null;
  continuousRef = false;
  verseEndRef = null;
  currentTimingRef = null;
  repeatRemainingRef = 1;
  patch({ activeAyah: null, isPlaying: false });
}

/** Select an Ayah without playing */
export function selectAyah(ayah: number): void {
  patch({ selectedAyah: ayah });
}

export function updatePlaybackRate(rate: number): void {
  patch({ playbackRate: rate });
  if (audioElement) audioElement.playbackRate = rate;
}

export function updateRepeatCount(count: number): void {
  patch({ repeatCount: count });
  repeatRemainingRef = count;
}

function abortLoad(): void {
  loadControllerRef?.abort();
  loadControllerRef = null;
  loadInFlightRef = null;
}

/** Drops the prepared source, releasing its object URL if it had one. */
function releaseSource(): void {
  if (sourceUrlRef?.startsWith('blob:')) {
    URL.revokeObjectURL(sourceUrlRef);
  }
  sourceUrlRef = null;
  sourceRef = null;
}

/**
 * Fetch the surah's recitation on first request.
 *
 * The old version loaded it the moment a surah was opened: every opened surah
 * downloaded the whole recitation, and offline that landed a red
 * «تعذّر تجهيز التلاوة» banner on a reader who had only come to read. Deferred,
 * the fetch happens behind «جار تجهيز التلاوة...» and a failure can only appear
 * after the person pressed play themselves.
 */
export function ensureSource(): Promise<SurahAudioSource | null> {
  if (sourceRef) return Promise.resolve(sourceRef);
  if (loadInFlightRef) return loadInFlightRef;

  const { surahId, reciterId } = state;
  if (surahId === null || !reciterId) return Promise.resolve(null);

  const controller = new AbortController();
  loadControllerRef = controller;
  patch({ sourceLoading: true });

  const load = (async (): Promise<SurahAudioSource | null> => {
    try {
      const nextSource = await loadSurahAudio(reciterId, surahId, controller.signal);
      if (controller.signal.aborted || loadControllerRef !== controller) {
        // The surah or reciter changed while this fetch was running.
        if (nextSource.blob) URL.revokeObjectURL(nextSource.url);
        return null;
      }
      if (sourceUrlRef?.startsWith('blob:')) {
        URL.revokeObjectURL(sourceUrlRef);
      }
      sourceUrlRef = nextSource.blob ? nextSource.url : null;
      sourceRef = nextSource;
      patch({
        wholeFile: nextSource.verseTimings.length === 0,
        error: null,
      });
      return nextSource;
    } catch (cause: unknown) {
      if (!(cause instanceof Error && cause.name === 'AbortError')) {
        patch({ error: cause instanceof Error ? cause.message : 'تعذّر تجهيز التلاوة' });
      }
      return null;
    } finally {
      // Only the load that still owns the slot may release it: a reciter/surah
      // change aborts this controller and starts the next load, whose slot this
      // stale finally must not clear.
      if (loadControllerRef === controller) {
        loadControllerRef = null;
        loadInFlightRef = null;
        patch({ sourceLoading: false });
      }
    }
  })();

  loadInFlightRef = load;
  return load;
}

/** Core function to start or seek playback to a specific Ayah */
export function playAyah(ayah: number, continuous = false): void {
  const prepared = sourceRef;
  const audio = audioElement;
  if (!prepared || !audio) return;

  // A recording with no verse timings (the children-repetition muallim)
  // plays as one whole surah file: any ayah press starts it from the top.
  if (prepared.verseTimings.length === 0) {
    activeAyahRef = null;
    continuousRef = true;
    currentTimingRef = null;
    verseEndRef = null;
    if (audio.src !== prepared.url) {
      audio.src = prepared.url;
    }
    audio.currentTime = 0;
    audio.playbackRate = state.playbackRate;
    patch({ activeAyah: null, selectedAyah: ayah, error: null });
    audio
      .play()
      .then(() => {
        patch({ isPlaying: true });
      })
      .catch((cause: unknown) => {
        patch({
          isPlaying: false,
          error: cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة',
        });
      });
    return;
  }

  const timing = prepared.verseTimings.find((item) => item.ayah === ayah);
  if (!timing) {
    patch({ error: `توقيت الآية ${ayah} غير متاح` });
    return;
  }

  activeAyahRef = ayah;
  continuousRef = continuous;
  currentTimingRef = timing;

  // In single-ayah repeat mode, record the end time for looping/stopping
  if (!continuous) {
    verseEndRef = timing.endMs / 1000;
  } else {
    verseEndRef = null;
  }

  // Ensure audio source URL is set
  if (audio.src !== prepared.url) {
    audio.src = prepared.url;
  }

  audio.currentTime = timing.startMs / 1000;
  audio.playbackRate = state.playbackRate;

  patch({ activeAyah: ayah, selectedAyah: ayah, error: null });

  audio
    .play()
    .then(() => {
      patch({ isPlaying: true });
    })
    .catch((cause: unknown) => {
      patch({
        isPlaying: false,
        error: cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة',
      });
    });
}

/** Prepare the audio if needed, then hand over to `playAyah`; null aborts silently. */
export async function playAyahEnsured(ayah: number, continuous = false): Promise<void> {
  const prepared = await ensureSource();
  if (!prepared) return;
  playAyah(ayah, continuous);
}

export async function startSelectedAyah(): Promise<void> {
  const ayah = state.selectedAyah;
  if (ayah === null) return;
  const audio = audioEl();

  if (activeAyahRef === ayah && state.isPlaying) {
    audio.pause();
    patch({ isPlaying: false });
    return;
  }

  const prepared = await ensureSource();
  if (!prepared) return;
  repeatRemainingRef = state.repeatCount;
  playAyah(ayah, false);
}

export async function replayAyah(): Promise<void> {
  const ayah = activeAyahRef ?? state.selectedAyah;
  if (ayah === null) return;
  const prepared = await ensureSource();
  if (!prepared) return;
  repeatRemainingRef = state.repeatCount;
  playAyah(ayah, false);
}

export async function toggleSurah(): Promise<void> {
  const audio = audioEl();

  if (state.isPlaying) {
    audio.pause();
    patch({ isPlaying: false });
    return;
  }

  if (activeAyahRef !== null && continuousRef) {
    audio
      .play()
      .then(() => patch({ isPlaying: true }))
      .catch(() => patch({ isPlaying: false }));
    return;
  }

  const prepared = await ensureSource();
  if (!prepared) return;
  repeatRemainingRef = 1;
  playAyah(state.selectedAyah || 1, true);
}

/**
 * Bind the engine to a track.
 *
 * Called by the reader on every mount and whenever its surah/reciter props
 * change — and deliberately *not* on unmount, which is the whole point: the
 * reader leaving is not a reason to stop listening.
 */
export function setTrack(track: {
  surahId: number;
  surahName: string;
  reciterId: string;
}): void {
  if (state.surahId === track.surahId && state.reciterId === track.reciterId) {
    // Remounting the reader over the track that is already loaded: the engine
    // is the state that survived, so nothing here may reset it.
    return;
  }
  abortLoad();
  stop();
  releaseSource();
  patch({
    surahId: track.surahId,
    surahName: track.surahName,
    reciterId: track.reciterId,
    error: null,
    wholeFile: false,
    sourceLoading: false,
    selectedAyah: 1,
  });
  audioEl().setAttribute('aria-label', `تلاوة سورة ${track.surahName}`);
}

// ---------------------------------------------------------------------------
// Media Session
// ---------------------------------------------------------------------------

/**
 * Publish the playing recitation as a system media session.
 *
 * While sound is playing, the lock screen, Bluetooth headphones and the OS
 * media controls show the surah and reciter and can drive the same element.
 * Re-run after every state change so a track change or a reciter change is
 * reflected without waiting for the next play.
 */
function syncMediaSession(): void {
  if (!audioElement) return;
  if (state.isPlaying) {
    const reciter = state.reciterId
      ? AUDIO_RECITERS.find((item) => item.id === state.reciterId)
      : undefined;
    setMediaSession(
      {
        title: state.surahName ? `سورة ${state.surahName}` : 'تلاوة قرآنية',
        artist: reciter?.name ?? 'القرآن الكريم',
        album: 'قُرّة — تلاوة وحفظ',
        artworkUrl: '/icons/icon-512.png',
      },
      {
        onPlay: resumeFromSession,
        onPause: pausePlayback,
        onStop: stop,
      },
    );
    setMediaPlaybackState('playing');
    return;
  }
  // Nothing sounding: drop the session when nothing is loaded either, otherwise
  // leave only the paused hint (the original effect's behaviour — handlers are
  // re-registered the moment playback resumes).
  clearMediaSession();
  if (state.activeAyah !== null || audioElement.src) {
    setMediaPlaybackState('paused');
  }
}

/** The lock screen's play button drives the exact same code path as an on-screen tap. */
function resumeFromSession(): void {
  const audio = audioElement;
  if (!audio || !audio.src) return;
  audio
    .play()
    .then(() => patch({ isPlaying: true }))
    .catch(() => patch({ isPlaying: false }));
}

/** The lock screen's pause button. */
function pausePlayback(): void {
  const audio = audioElement;
  if (audio && !audio.paused) audio.pause();
  patch({ isPlaying: false });
}
