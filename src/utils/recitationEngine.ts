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
  /**
   * The system took the sound — an incoming call, audio-focus loss, a headset
   * unplugged — instead of the listener pressing pause.
   */
  interrupted: boolean;
  /**
   * A recitation has been started and not stopped: the Media Session stays
   * registered (in the paused state) so the lock screen can bring it back.
   * Distinct from `interrupted`, which says *why* it is paused.
   */
  sessionOpen: boolean;
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
  interrupted: false,
  sessionOpen: false,
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
/** What the system was last told, so a state change that alters nothing is not re-published. */
let sessionSignature = '';

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
  audio.addEventListener('pause', handleSystemPause);
  audio.addEventListener('play', handleSystemPlay);
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
// Interruptions — a call takes the sound, the call gives it back
// ---------------------------------------------------------------------------

/**
 * A pause this app did not ask for.
 *
 * Every deliberate pause here flips the intent (`isPlaying`) synchronously in
 * the same tick as `audio.pause()`, and the element's `pause` event is queued
 * as a task — so by the time this runs, an intent still marked "playing" can
 * only mean someone else stopped the audio: a phone call, focus loss, a
 * disconnected headset. `ended` is excluded because a recording that ran out
 * is not an interruption, and resuming it would replay what has finished.
 *
 * The listener is told to stop showing «تُتلى الآن», but nothing is torn down:
 * the source, the ayah and the Media Session all stay, so the recitation can
 * pick up where it was.
 */
function handleSystemPause(): void {
  const audio = audioElement;
  if (!audio || audio.ended) return;
  if (!state.isPlaying) return;
  patch({ isPlaying: false, interrupted: true });
}

/** A play nobody here requested: the system handed the audio back (or we resumed). */
function handleSystemPlay(): void {
  if (state.interrupted) patch({ isPlaying: true, interrupted: false });
}

/**
 * Resume an interrupted recitation, if there is anything to resume.
 *
 * Wired to the two signals a phone actually gives a WebView when a call ends:
 * the page coming back to the foreground, and it regaining focus as the dialer
 * closes. Both are checked rather than assumed — an interruption the OS never
 * lifts (the listener deliberately left it paused) must not be resurrected by
 * an unrelated focus event, and `interrupted` is the guard that says so.
 */
function resumeAfterInterruption(): void {
  if (!state.interrupted) return;
  const audio = audioElement;
  if (!audio || !audio.src || audio.ended) {
    patch({ interrupted: false });
    return;
  }
  if (!audio.paused) {
    patch({ isPlaying: true, interrupted: false });
    return;
  }
  audio
    .play()
    .then(() => patch({ isPlaying: true, interrupted: false }))
    .catch(() => {
      // Still refused (an autoplay policy, say): the play button and the lock
      // screen both remain, so the listener starts it by hand.
    });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAfterInterruption();
  });
}
if (typeof window !== 'undefined') {
  window.addEventListener('focus', resumeAfterInterruption);
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
  // Stopping ends the session, unlike pausing it: the lock screen must not
  // offer to resume a recitation the listener explicitly finished.
  patch({ activeAyah: null, isPlaying: false, interrupted: false, sessionOpen: false });
}

/** Playback genuinely started — the moment the Media Session becomes real. */
function markPlaying(): void {
  patch({ isPlaying: true, sessionOpen: true });
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
        markPlaying();
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
      markPlaying();
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

  if (activeAyahRef === ayah && state.isPlaying) {
    pausePlayback();
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
    pausePlayback();
    return;
  }

  if (activeAyahRef !== null && continuousRef) {
    audio
      .play()
      .then(() => markPlaying())
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
 * Publish the recitation as a system media session.
 *
 * While sound is playing, the lock screen, Bluetooth headphones and the OS
 * media controls show the surah and reciter and can drive the same element.
 * The card is kept alive while a recitation is merely *paused* — not just
 * while it sounds — because that is exactly when it is needed: an interrupted
 * one must be resumable the moment the call ends, without the listener
 * unlocking the phone and finding the reader.
 *
 * The signature guard keeps a session that is already correct untouched: a
 * reader tapping through ayahs patches state far more often than anything the
 * system needs to hear about.
 */
function syncMediaSession(): void {
  if (!audioElement) return;
  const signature = `${state.surahId}|${state.reciterId}|${
    state.isPlaying ? 'playing' : state.sessionOpen ? 'paused' : 'none'
  }`;
  if (signature === sessionSignature) return;
  sessionSignature = signature;

  if (state.isPlaying || state.sessionOpen) {
    registerSession();
    setMediaPlaybackState(state.isPlaying ? 'playing' : 'paused');
    return;
  }
  clearMediaSession();
}

function registerSession(): void {
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
      // «السابق/التالي» on a headset or a car dashboard — the memoriser's
      // hands are on the wheel or the mushaf, not on the screen.
      onSeekBack: () => stepAyah(-1),
      onSeekForward: () => stepAyah(1),
    },
  );
}

/**
 * Move one ayah forward or back without leaving the screen.
 *
 * A skip while sounding reuses `playAyah`, so the repeat mode, the continuous
 * walk and the highlight all follow. A skip while *paused* only moves the
 * needle: pressing «التالي» on a headset must not start making sound the
 * listener had put a stop to.
 */
function stepAyah(delta: number): void {
  const prepared = sourceRef;
  if (!prepared || prepared.verseTimings.length === 0) return;

  const firstAyah = prepared.verseTimings[0].ayah;
  const lastAyah = prepared.verseTimings[prepared.verseTimings.length - 1].ayah;
  const current = activeAyahRef ?? state.selectedAyah ?? firstAyah;
  const next = Math.min(lastAyah, Math.max(firstAyah, current + delta));
  if (next === current) return;

  if (state.isPlaying) {
    playAyah(next, continuousRef);
    return;
  }

  const timing = prepared.verseTimings.find((item) => item.ayah === next);
  const audio = audioElement;
  if (!timing || !audio) return;
  if (audio.src !== prepared.url) audio.src = prepared.url;
  audio.currentTime = timing.startMs / 1000;
  activeAyahRef = next;
  currentTimingRef = timing;
  if (!continuousRef) verseEndRef = timing.endMs / 1000;
  patch({ activeAyah: next, selectedAyah: next });
}

/** The lock screen's play button drives the exact same code path as an on-screen tap. */
function resumeFromSession(): void {
  const audio = audioElement;
  if (!audio || !audio.src) return;
  audio
    .play()
    .then(() => markPlaying())
    .catch(() => patch({ isPlaying: false }));
}

/**
 * The listener paused it — on screen or from the lock screen.
 *
 * Not an interruption: the session stays open (so the card survives with its
 * handlers intact) and the intent is cleared so the element's own `pause`
 * event, which arrives a tick later, is recognised as ours.
 */
function pausePlayback(): void {
  const audio = audioElement;
  if (audio && !audio.paused) audio.pause();
  patch({ isPlaying: false, interrupted: false });
}
