/**
 * Lock-screen / background controls for the recitation player.
 *
 * A memoriser listens with the phone in a pocket: without the Media Session API
 * the OS knows nothing about the playing audio — no lock-screen card, no
 * pause/play from Bluetooth headphones or a car, no notification control — and
 * one incoming call or screen lock left the recitation uncontrolled. Registering
 * a session turns the element into a proper media session the system can drive.
 *
 * Everything is feature-detected and best-effort: a browser or WebView without
 * `navigator.mediaSession` (older Android WebViews) simply gets the old
 * behaviour, and no call here may throw into playback.
 */

export interface MediaSessionInfo {
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
}

function session(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
    ? navigator.mediaSession
    : null;
}

/**
 * Publishes "what is playing" plus the controls the system should offer.
 *
 * `handlers` receive the same arguments the platform passes (play/pause/seek…);
 * the player passes its own play/pause/resume functions so a lock-screen tap
 * drives the exact same code path as an on-screen tap.
 */
export function setMediaSession(
  info: MediaSessionInfo,
  handlers: {
    onPlay?: () => void;
    onPause?: () => void;
    onStop?: () => void;
    onSeekBack?: () => void;
    onSeekForward?: () => void;
  },
): void {
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
    action('seekbackward', handlers.onSeekBack);
    action('seekforward', handlers.onSeekForward);
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

export function setMediaPlaybackState(state: 'playing' | 'paused' | 'none'): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.playbackState = state;
  } catch {
    // Ignored: purely a system hint.
  }
}

/** Drops the session so the OS stops showing controls for finished audio. */
export function clearMediaSession(): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.metadata = null;
    ms.playbackState = 'none';
    for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward'] as const) {
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
