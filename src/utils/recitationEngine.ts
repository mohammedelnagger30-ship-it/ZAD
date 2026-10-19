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
 *
 * Walking *on* to the next surah is not: `advanceToNextSurah` and
 * `playNextSurah`/`playPreviousSurah` change the track in place, keep the session
 * open so the notification card survives the switch, and honour the play/pause
 * intent the listener last expressed — «التالي» while paused moves the selection
 * without starting to make sound.
 */
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { getSurah } from '@/data/surahs';
import { loadSurahAudio, type SurahAudioSource, type VerseTiming } from '@/utils/quranAudio';
import {
  clearMediaSession,
  reportMediaProgress,
  setMediaPlaybackState,
  setMediaSession,
  updateMediaPosition,
} from '@/utils/mediaSession';
import { openRecitationPlayer, setRecitationSheetOpen } from '@/utils/recitationPlayerUi';

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

// ---------------------------------------------------------------------------
// Position / duration — a store of their own.
//
// These change several times a second while a surah plays, and they are needed by
// exactly two small surfaces: the progress line on the mini bar and the scrubber in
// the expanded player. Putting them into `RecitationState` would re-render every
// subscriber four times a second — including the reader's whole ayah list, which the
// reader component hands down as `children`. Keeping them apart means the ayah list
// renders when the *ayah* changes and the progress bar renders when the *position*
// does, which is what each of them is actually watching.
// ---------------------------------------------------------------------------

export interface RecitationProgress {
  /** Milliseconds into the recording the engine currently holds. */
  positionMs: number;
  /** Total length in milliseconds; 0 until the recording's metadata arrives. */
  durationMs: number;
}

let progress: RecitationProgress = { positionMs: 0, durationMs: 0 };
const progressListeners = new Set<() => void>();

export function subscribeRecitationProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function getRecitationProgress(): RecitationProgress {
  return progress;
}

function patchProgress(next: RecitationProgress): void {
  // Integer milliseconds: an unchanged value must not wake a subscriber, and the
  // element reports fractional seconds.
  const positionMs = Math.max(0, Math.round(next.positionMs));
  const durationMs = Math.max(0, Math.round(next.durationMs));
  if (positionMs === progress.positionMs && durationMs === progress.durationMs) return;
  progress = { positionMs, durationMs };
  for (const listener of [...progressListeners]) listener();
}

/** Read the element and push its position into the UI bar. */
function syncProgressFromAudio(audio: HTMLAudioElement): void {
  patchProgress({
    positionMs: audio.currentTime * 1000,
    durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0,
  });
}

/**
 * Read the element and report its position to the system session.
 *
 * Called only where the platform cannot work the position out on its own: a new
 * surah, a seek, a pause, a speed change, the metadata arriving. Not from
 * `timeupdate` — see `reportMediaProgress`.
 */
function reportProgressFromAudio(): void {
  const audio = audioElement;
  if (!audio) return;
  reportMediaProgress({
    positionMs: Math.max(0, audio.currentTime * 1000),
    durationMs: Number.isFinite(audio.duration) ? audio.duration * 1000 : 0,
    playbackRate: audio.playbackRate || 1,
  });
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
 * True while the engine is between two surahs — the previous one has ended and the
 * next one is still being fetched. It is a re-entry guard, not a flag the UI reads:
 * `ended` and the last `timeupdate` both notice a surah finishing, and each of them
 * would otherwise start the next surah on its own.
 */
let surahTransitionRef = false;

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
  // The recording's length is only known once its metadata arrives, and a streamed
  // surah can revise it later — the scrubber must not stay stuck at zero.
  audio.addEventListener('loadedmetadata', () => {
    syncProgressFromAudio(audio);
    reportProgressFromAudio();
  });
  audio.addEventListener('durationchange', () => syncProgressFromAudio(audio));
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
  // The progress line on the mini bar and the scrubber in the expanded player.
  syncProgressFromAudio(audio);
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

    // The end of the last verse is the end of the surah — and a recitation that
    // runs off the end of a surah carries on into the next one, the way it would
    // in a real sitting.
    const lastVerse = prepared.verseTimings[prepared.verseTimings.length - 1];
    if (currentMs >= lastVerse.endMs) {
      advanceToNextSurah();
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

  const timings = prepared.verseTimings;
  const lastAyah = timings[timings.length - 1].ayah;
  if (activeAyahRef === lastAyah) {
    // The surah is over: the next one starts, or سورة الناس ends the recitation.
    advanceToNextSurah();
    return;
  }

  // The file ended before its own last verse — a stream that dropped, a partial
  // download. Walk on from where it stopped rather than abandoning the surah.
  const nextAyah = activeAyahRef ? activeAyahRef + 1 : timings[0].ayah;
  if (nextAyah <= lastAyah) {
    playAyah(nextAyah, true);
  } else {
    advanceToNextSurah();
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
  surahTransitionRef = false;
  patchProgress({ positionMs: 0, durationMs: progress.durationMs });
  // Stopping ends the session, unlike pausing it: the lock screen must not
  // offer to resume a recitation the listener explicitly finished.
  patch({ activeAyah: null, isPlaying: false, interrupted: false, sessionOpen: false });
  // The session is over, so the expanded player has nothing left to show. Closing it
  // here — and not only when its own «إيقاف» is tapped — is what stops it from springing
  // back open the next time a surah is started, since it outlives the bar it opened from.
  setRecitationSheetOpen(false);
}

/** Playback genuinely started — the moment the Media Session becomes real. */
function markPlaying(): void {
  patch({ isPlaying: true, sessionOpen: true });
  // Freeze the system's idea of where this started: it takes it from here by
  // extrapolating with the speed, and a stale position would drift the lock-screen
  // bar by however long the app was last silent.
  reportProgressFromAudio();
}

/** Select an Ayah without playing */
export function selectAyah(ayah: number): void {
  patch({ selectedAyah: ayah });
}

export function updatePlaybackRate(rate: number): void {
  patch({ playbackRate: rate });
  if (audioElement) audioElement.playbackRate = rate;
  // A speed change is one of the few moments the platform cannot work the position
  // out for itself: it knows the *old* speed and would drift from here on.
  reportProgressFromAudio();
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
    syncProgressFromAudio(audio);
    reportProgressFromAudio();
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
  syncProgressFromAudio(audio);
  reportProgressFromAudio();

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
  patchProgress({ positionMs: 0, durationMs: 0 });
  surahTransitionRef = false;
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
// Surah to surah
//
// «التالي» and «السابق» move between **surahs** — on the notification card, on a
// Bluetooth headset, on the lock screen and on the expanded player alike. The
// ayah-level step lives in `stepAyah` and stays inside the reader's own controls,
// because somebody driving a recitation from a car or a pocket wants the mus'haf's
// own unit of movement, not a single verse.
// ---------------------------------------------------------------------------

const FIRST_SURAH_ID = 1;
const LAST_SURAH_ID = 114;
/** Seconds into a surah after which «السابق» restarts it instead of skipping back. */
const RESTART_THRESHOLD_SECONDS = 3;

interface SurahTrack {
  surahId: number;
  surahName: string;
  reciterId: string;
}

/** The track for one particular surah, or null at the ends of the mus'haf. */
function trackFor(surahId: number): SurahTrack | null {
  if (!state.reciterId) return null;
  const surah = getSurah(surahId);
  if (!surah) return null;
  return { surahId: surah.id, surahName: surah.name, reciterId: state.reciterId };
}

/** Whether a surah follows this one — what the system's «التالي» is told. */
export function canPlayNextSurah(): boolean {
  return state.surahId !== null && state.surahId < LAST_SURAH_ID;
}

/** Whether a surah precedes this one — what the system's «السابق» is told. */
export function canPlayPreviousSurah(): boolean {
  return state.surahId !== null && state.surahId > FIRST_SURAH_ID;
}

// ---------------------------------------------------------------------------
// Telling the reader that the player moved
//
// The reader holds its own `selectedSurah` and hands it to the engine through
// `setTrack`. When the *player* changes the surah instead — the end of a surah
// walking on to the next one, or «التالي/السابق» from the notification card, a
// headset or the expanded player — the reader would otherwise sit on a surah nobody
// is reciting.
//
// Only `changeSurah` raises this. `setTrack` deliberately does not: that call comes
// *from* the reader, and echoing it back would drag a reader that opened at آية ٥٠
// to the first ayah of the surah it had just handed over.
// ---------------------------------------------------------------------------

type SurahChangeListener = (surahId: number) => void;
const surahChangeListeners = new Set<SurahChangeListener>();

export function subscribeSurahChange(listener: SurahChangeListener): () => void {
  surahChangeListeners.add(listener);
  return () => {
    surahChangeListeners.delete(listener);
  };
}

function notifySurahChanged(surahId: number): void {
  for (const listener of [...surahChangeListeners]) listener(surahId);
}

/**
 * Move to another surah — the engine's own `setTrack`, with two differences that
 * matter for a recitation running with the screen off:
 *
 *  - the session stays open, so the notification card survives the switch instead of
 *    blinking away between surahs, and
 *  - the play/pause *intent* is carried across in `autoplay` rather than reset:
 *    «التالي» on a paused player must move the selection without starting to make
 *    sound the listener had put a stop to.
 */
async function changeSurah(track: SurahTrack, autoplay: boolean): Promise<void> {
  surahTransitionRef = true;
  abortLoad();
  // Silence the outgoing surah in the same synchronous block that clears the intent:
  // the element's own `pause` event arrives a tick later, and with the intent still
  // marked "playing" it would be read as an interruption (see handleSystemPause).
  audioElement?.pause();
  releaseSource();
  activeAyahRef = null;
  continuousRef = false;
  currentTimingRef = null;
  verseEndRef = null;
  repeatRemainingRef = 1;
  patchProgress({ positionMs: 0, durationMs: 0 });
  patch({
    surahId: track.surahId,
    surahName: track.surahName,
    reciterId: track.reciterId,
    activeAyah: null,
    selectedAyah: 1,
    isPlaying: false,
    interrupted: false,
    wholeFile: false,
    error: null,
    sessionOpen: true,
  });
  audioElement?.setAttribute('aria-label', `تلاوة سورة ${track.surahName}`);
  notifySurahChanged(track.surahId);

  try {
    const prepared = await ensureSource();
    // A failure leaves the reader on the new surah with its error banner: the
    // previous surah has already been released and cannot be resumed honestly.
    if (!prepared || !autoplay) return;
    repeatRemainingRef = 1;
    playAyah(1, true);
  } finally {
    surahTransitionRef = false;
  }
}

/**
 * The surah finished: walk on to the next one, the automatic continuation the whole
 * engine exists for. At سورة الناس there is nowhere left to go, so the recitation
 * ends — and the notification card goes with it.
 */
function advanceToNextSurah(): void {
  if (surahTransitionRef) return;
  const next = state.surahId === null ? null : trackFor(state.surahId + 1);
  if (!next) {
    stop();
    return;
  }
  void changeSurah(next, true);
}

/**
 * «التالي» — the next surah.
 *
 * The one entry point every control uses: the notification card, the hardware media
 * keys, the lock screen and the expanded player all land here so they cannot drift
 * apart.
 */
export async function playNextSurah(): Promise<void> {
  if (state.surahId === null) return;
  const next = trackFor(state.surahId + 1);
  if (!next) return;
  await changeSurah(next, state.isPlaying);
}

/**
 * «السابق» — the previous surah.
 *
 * A few seconds in, the habit every player shares applies first: the current surah
 * restarts instead of the previous one being fetched, which is what a hand reaching
 * for «السابق» almost always means.
 */
export async function playPreviousSurah(): Promise<void> {
  const audio = audioElement;
  if (audio && audio.currentTime > RESTART_THRESHOLD_SECONDS) {
    restartCurrentSurah();
    return;
  }
  if (state.surahId === null) return;
  const previous = state.surahId > FIRST_SURAH_ID ? trackFor(state.surahId - 1) : null;
  if (!previous) {
    // سورة الفاتحة has nothing before it: «السابق» means "start this one again".
    restartCurrentSurah();
    return;
  }
  await changeSurah(previous, state.isPlaying);
}

/** Back to the top of the surah the engine already holds — sound only if it was sounding. */
function restartCurrentSurah(): void {
  const prepared = sourceRef;
  const audio = audioElement;
  if (!prepared || !audio) return;

  const first = prepared.verseTimings[0];
  if (state.isPlaying) {
    repeatRemainingRef = 1;
    playAyah(first ? first.ayah : 1, true);
    return;
  }

  // Paused: move the needle and nothing else.
  audio.currentTime = 0;
  activeAyahRef = first ? first.ayah : null;
  continuousRef = true;
  currentTimingRef = first ?? null;
  verseEndRef = null;
  patch({ activeAyah: activeAyahRef, selectedAyah: activeAyahRef ?? 1 });
  syncProgressFromAudio(audio);
  reportProgressFromAudio();
}

/**
 * Move the needle to an absolute position — the system scrubber was dragged.
 *
 * The highlight follows the needle: a drag from آية ٣ to آية ٤٠ must leave the reader
 * showing the verse the recitation is now in, not the one it left behind.
 */
export function seekTo(positionMs: number): void {
  const prepared = sourceRef;
  const audio = audioElement;
  if (!prepared || !audio || !Number.isFinite(positionMs)) return;

  const knownSeconds = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : null;
  const targetSeconds = Math.max(0, positionMs / 1000);
  audio.currentTime = knownSeconds === null ? targetSeconds : Math.min(targetSeconds, knownSeconds);

  const timing = prepared.verseTimings.find(
    (item) => positionMs >= item.startMs && positionMs < item.endMs,
  );
  if (timing) {
    activeAyahRef = timing.ayah;
    currentTimingRef = timing;
    if (!continuousRef) verseEndRef = timing.endMs / 1000;
    patch({ activeAyah: timing.ayah, selectedAyah: timing.ayah });
  }
  syncProgressFromAudio(audio);
  reportProgressFromAudio();
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
      // At سورة الناس there is no «التالي», and at الفاتحة no «السابق»: the system is
      // told so rather than being given a button that does nothing.
      hasNext: canPlayNextSurah(),
      hasPrevious: canPlayPreviousSurah(),
    },
    {
      onPlay: resumeFromSession,
      onPause: pausePlayback,
      onStop: stop,
      // «السابق/التالي» on a headset, a car dashboard or the notification card move
      // between surahs — the memoriser's hands are on the wheel or the mushaf, not on
      // the screen. The finer ayah step stays for the platforms that offer it.
      onPrevious: () => void playPreviousSurah(),
      onNext: () => void playNextSurah(),
      onSeekBack: () => stepAyah(-1),
      onSeekForward: () => stepAyah(1),
      onSeek: seekTo,
      // Tapping the card brings the app forward; it should land on the player the
      // listener just tapped for, not on whatever screen was left behind.
      onOpenPlayer: () => openRecitationPlayer(),
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
  syncProgressFromAudio(audio);
  reportProgressFromAudio();
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
  // A pause is a discontinuity: the platform stops extrapolating here and would keep
  // showing wherever it last heard from if this were not sent.
  reportProgressFromAudio();
}
