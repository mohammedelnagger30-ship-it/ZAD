/**
 * Lock-screen / background controls for the recitation player.
 *
 * A memoriser listens with the phone in a pocket: without a media session the OS
 * knows nothing about the playing audio — no lock-screen card, no pause/play from
 * Bluetooth headphones or a car, no notification control — and one incoming call or
 * screen lock left the recitation uncontrolled.
 *
 * Two delivery paths live here, because there are two kinds of device:
 *
 *  - **The web Media Session API** (`navigator.mediaSession`) — desktop browsers and
 *    a WebView new enough to implement it. The `<audio>` element is enough for the
 *    OS to see; this module only adds the metadata and the handlers.
 *  - **The app's own Android player card** (`@/utils/recitationMediaNative`) — the
 *    Android WebView does *not* implement `navigator.mediaSession`, so on Android the
 *    card comes from a native foreground service the engine drives. That bridge is
 *    imported **dynamically and only on a real device**, so importing this module
 *    never drags Capacitor into a test or a browser build.
 *
 * Everything is feature-detected and best-effort: no call here may throw into playback.
 */

export interface MediaSessionInfo {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  /**
   * «التالي» / «السابق» move between **surahs**, matching the notification's own
   * buttons and the hardware media keys. False at the ends of the mushaf, so the
   * system does not offer a control that would do nothing.
   */
  hasNext?: boolean;
  hasPrevious?: boolean;
}

export interface MediaSessionHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  /** «السابق» — the previous surah (or a restart of this one; the engine decides). */
  onPrevious?: () => void;
  /** «التالي» — the next surah. */
  onNext?: () => void;
  /** «‎رجوع آية / تقدّم آية» — the finer step the browser and the car dashboard offer. */
  onSeekBack?: () => void;
  onSeekForward?: () => void;
  /** The system scrubber was dragged: milliseconds into the current recording. */
  onSeek?: (positionMs: number) => void;
  /** The card itself was tapped and the app was brought forward. */
  onOpenPlayer?: () => void;
}

function session(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : null;
}

// ---------------------------------------------------------------------------
// The Android player card's bridge
// ---------------------------------------------------------------------------

/**
 * The shape of the dynamically imported native module, kept structural so that
 * nothing in this file has to import it (and thus Capacitor) at module scope.
 */
interface NativeRecitationBridge {
  sync(options: {
    title: string;
    artist: string;
    album: string;
    isPlaying: boolean;
    hasNext: boolean;
    hasPrev: boolean;
    positionMs: number;
    durationMs: number;
    speed: number;
  }): Promise<void>;
  clear(): Promise<void>;
}

let nativeBridge: NativeRecitationBridge | null = null;
let bridgeRequested = false;
let nativeInfo: MediaSessionInfo | null = null;
let nativeHandlers: MediaSessionHandlers = {};
let nativePlaying = false;
let nativeProgress = { positionMs: 0, durationMs: 0, playbackRate: 1 };

/** Whether this page is running inside the Capacitor Android shell. */
function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false;
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return capacitor?.isNativePlatform?.() === true;
}

/**
 * Load the native bridge, once, the first time a session is registered.
 *
 * Deliberately lazy: the engine imports this module on every platform, and a static
 * import of `@capacitor/core` would follow it into the jsdom test run.
 */
function ensureNativeBridge(): void {
  if (nativeBridge || bridgeRequested || !isNativePlatform()) return;
  bridgeRequested = true;

  void import('@/utils/recitationMediaNative')
    .then(async (module) => {
      nativeBridge = {
        sync: (options) => module.RecitationMedia.sync(options),
        clear: () => module.RecitationMedia.clear(),
      };
      await module.RecitationMedia.addListener('action', (event) => {
        applyNativeAction(event.action, event.positionMs);
      });
      await module.RecitationMedia.addListener('openPlayer', () => {
        nativeHandlers.onOpenPlayer?.();
      });
      // Hand the system whatever the engine published before the bridge finished
      // loading — the first play often beats the dynamic import.
      publishNative();
    })
    .catch((error: unknown) => {
      bridgeRequested = false;
      console.warn('The native recitation player is unavailable:', error);
    });
}

function applyNativeAction(action: string, positionMs?: number): void {
  switch (action) {
    case 'play':
      nativeHandlers.onPlay?.();
      return;
    case 'pause':
      nativeHandlers.onPause?.();
      return;
    case 'stop':
      nativeHandlers.onStop?.();
      return;
    case 'next':
      nativeHandlers.onNext?.();
      return;
    case 'prev':
      nativeHandlers.onPrevious?.();
      return;
    case 'seek':
      if (typeof positionMs === 'number') nativeHandlers.onSeek?.(positionMs);
      return;
    default:
      // An action this build does not know is not an error.
      return;
  }
}

/** Mirrors the current snapshot onto the Android card, if there is one to mirror. */
function publishNative(): void {
  const bridge = nativeBridge;
  if (!bridge || !nativeInfo) return;
  void bridge
    .sync({
      title: nativeInfo.title,
      artist: nativeInfo.artist,
      album: nativeInfo.album ?? 'قُرّة — تلاوة وحفظ',
      isPlaying: nativePlaying,
      hasNext: nativeInfo.hasNext ?? false,
      hasPrev: nativeInfo.hasPrevious ?? false,
      positionMs: Math.max(0, Math.round(nativeProgress.positionMs)),
      durationMs: Math.max(0, Math.round(nativeProgress.durationMs)),
      speed: nativeProgress.playbackRate || 1,
    })
    .catch(() => {
      // The card is cosmetic: playback must never depend on it.
    });
}

// ---------------------------------------------------------------------------
// The web Media Session
// ---------------------------------------------------------------------------

/**
 * Publishes "what is playing" plus the controls the system should offer.
 *
 * `handlers` receive the same arguments the platform passes; the engine passes its
 * own play/pause/surah-step functions so a lock-screen tap drives the exact same code
 * path as an on-screen tap.
 */
export function setMediaSession(
  info: MediaSessionInfo,
  handlers: MediaSessionHandlers,
): void {
  // The native card needs both halves kept: it is re-published on every later change
  // (a pause, a seek, a speed change) and owns the same handlers.
  nativeInfo = info;
  nativeHandlers = handlers;
  ensureNativeBridge();
  publishNative();

  const ms = session();
  if (!ms) return;
  try {
    ms.metadata = new MediaMetadata({
      title: info.title,
      artist: info.artist,
      ...(info.album ? { album: info.album } : {}),
      // One 512px icon covers every artwork slot the system asks for.
      ...(info.artworkUrl
        ? { artwork: [{ src: info.artworkUrl, sizes: '512x512', type: 'image/png' }] }
        : {}),
    });
    const action = (
      action: MediaSessionAction,
      handler: (() => void) | undefined,
    ) => {
      if (!handler) return;
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // An unsupported action is not an error — the system just offers fewer controls.
      }
    };
    action('play', handlers.onPlay);
    action('pause', handlers.onPause);
    action('stop', handlers.onStop);
    // Media keys: «التالي/السابق» on a headset or a car dashboard move between surahs,
    // exactly as the Android card's own buttons do.
    action('nexttrack', handlers.onNext);
    action('previoustrack', handlers.onPrevious);
    // The browser's own finer controls, which have no surah-level equivalent.
    action('seekbackward', handlers.onSeekBack);
    action('seekforward', handlers.onSeekForward);
    try {
      // `seekto` is the scrubber: the handler is handed `{ seekTime }` in seconds.
      if (handlers.onSeek) {
        const onSeek = handlers.onSeek;
        ms.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
          if (typeof details.seekTime === 'number') onSeek(details.seekTime * 1000);
        });
      }
    } catch {
      // Unsupported in this browser — the scrubber simply does nothing there.
    }
  } catch {
    // Metadata is cosmetic; playback must continue regardless.
  }
}

/** Keeps the lock-screen position bar in sync with the element. */
export function updateMediaPosition(audio: HTMLAudioElement): void {
  const ms = session();
  if (!ms) return;
  try {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    ms.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration),
    });
  } catch {
    // Some WebViews throw on position updates for blob: sources — cosmetic only.
  }
}

/**
 * Report the position the app last *knew* to the system session.
 *
 * Deliberately not called from `timeupdate`: the platform advances the position itself
 * from `speed` and the elapsed real time, so a call per second would be a stream of
 * bridge traffic for a number the OS can already work out. This is for the moments it
 * cannot: a seek, a pause, a new surah, a speed change.
 */
export function reportMediaProgress(progress: {
  positionMs: number;
  durationMs: number;
  playbackRate: number;
}): void {
  nativeProgress = {
    positionMs: progress.positionMs,
    durationMs: progress.durationMs,
    playbackRate: progress.playbackRate,
  };
  publishNative();
}

export function setMediaPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  nativePlaying = state === 'playing';
  const ms = session();
  if (ms) {
    try {
      ms.playbackState = state;
    } catch {
      // Ignored: purely a system hint.
    }
  }
  publishNative();
}

/** Drops the session so the OS stops showing controls for finished audio. */
export function clearMediaSession(): void {
  nativeInfo = null;
  nativeHandlers = {};
  nativePlaying = false;
  nativeProgress = { positionMs: 0, durationMs: 0, playbackRate: 1 };
  void nativeBridge?.clear().catch(() => {
    // Nothing to take down.
  });

  const ms = session();
  if (!ms) return;
  try {
    ms.metadata = null;
    ms.playbackState = 'none';
    for (const action of [
      'play',
      'pause',
      'stop',
      'nexttrack',
      'previoustrack',
      'seekbackward',
      'seekforward',
      'seekto',
    ] as const) {
      try {
        ms.setActionHandler(action, null);
      } catch {
        // Unsupported action — nothing to clear.
      }
    }
  } catch {
    // Ignored.
  }
}
