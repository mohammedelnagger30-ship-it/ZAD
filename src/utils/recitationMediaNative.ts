/**
 * JS side of the native recitation player card
 * (`RecitationMedia` + `RecitationMediaService` + `RecitationMediaReceiver`).
 *
 * Android's WebView does not implement `navigator.mediaSession`, so the recitation
 * — which is an `<audio>` element inside that WebView — is invisible to the OS:
 * no lock-screen card, no controls on a Bluetooth headset, no notification while the
 * app is in the background. The native service mirrors what the JS engine publishes
 * onto a real `android.media.session.MediaSession` plus one `MediaStyle` card, and
 * sends every button press back as an `action` event.
 *
 * This module is only ever loaded dynamically (see `@/utils/mediaSession`), because
 * importing `@capacitor/core` inside the engine's module graph would drag the
 * Capacitor bridge into the jsdom unit tests — which is exactly what the engine's
 * own tests must not need.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * What the system is told about the recitation.
 *
 * `positionMs` is the position the app last *knew*; the platform extrapolates from
 * there using `speed`, which is why this is sent on a seek, a pause, a track change
 * or a speed change rather than every second.
 */
export interface RecitationMediaState {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  /** «التالي» moves to the next surah; false while سورة الناس is the track. */
  hasNext: boolean;
  /** «السابق» moves to the previous surah; false while الفاتحة is the track. */
  hasPrev: boolean;
  positionMs: number;
  durationMs: number;
  speed: number;
}

/** A transport control the user pressed — on the card, a headset, or the lock screen. */
export type RecitationMediaAction = 'play' | 'pause' | 'stop' | 'next' | 'prev' | 'seek';

export interface RecitationMediaActionEvent {
  action: RecitationMediaAction;
  /** Only «seek» carries one: milliseconds into the current recording. */
  positionMs?: number;
}

interface RecitationMediaPlugin {
  sync(options: RecitationMediaState): Promise<void>;
  clear(): Promise<void>;
  addListener(
    eventName: 'action',
    listenerFunc: (event: RecitationMediaActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'openPlayer',
    listenerFunc: () => void,
  ): Promise<PluginListenerHandle>;
}

export const RecitationMedia = registerPlugin<RecitationMediaPlugin>('RecitationMedia');
