import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

// JS side of the native adhan launcher (`AdhanOverlay` + `AdhanOverlayReceiver`).
//
// Android refuses to start an activity from a background process, so an app that is
// closed at prayer time could never open its own adhan page. The sanctioned mechanism
// is a full-screen-intent notification — the same one alarm clocks use: the system
// takes over the screen with the app's activity while the device is locked or idle, and
// shows a banner when it is in use. These alarms run on their own exact AlarmManager
// schedule (drift-compensated on the JS side, exactly like the sound notifications),
// so they fire whether or not anything in the WebView is still running.

/** One prayer-time takeover alarm. `at` is a device-clock instant in ms (drift-compensated). */
export interface AdhanOverlayAlarm {
  /** Notification id, shared with the prayer sound notification it stands in for. */
  id: number;
  /** Device-clock epoch ms — Android alarms always fire against the device clock. */
  at: number;
  /** Channel carrying the adhan sound (created by the JS scheduler). */
  channelId: string;
  title: string;
  body: string;
  prayerKey: string;
  prayerName: string;
  /** Prayer instant, ISO-8601. */
  time: string;
}

/** Payload the native side hands back when the adhan page must open. */
export interface AdhanOverlayEvent {
  prayerKey: string;
  prayerName?: string;
  time?: string;
}

interface AdhanOverlayPlugin {
  schedule(options: { alarms: AdhanOverlayAlarm[] }): Promise<void>;
  cancelAll(): Promise<void>;
  addListener(
    eventName: 'adhanReceived' | 'adhanLaunch',
    listenerFunc: (data: AdhanOverlayEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const AdhanOverlay = registerPlugin<AdhanOverlayPlugin>('AdhanOverlay');

/**
 * Replace the armed takeover alarms with this batch (empty = cancel all).
 *
 * Every resume rebuilds the whole window, so this mirrors the notification queue's
 * swap semantics: the native side cancels its previous alarms, then arms the new ones.
 */
export async function scheduleAdhanOverlay(alarms: AdhanOverlayAlarm[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await AdhanOverlay.schedule({ alarms });
}

/** Drop every armed takeover alarm. */
export async function cancelAdhanOverlay(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdhanOverlay.cancelAll();
  } catch (err) {
    console.warn('Could not cancel the adhan overlay alarms:', err);
  }
}

/**
 * Subscribe to both takeover paths:
 *
 * - `adhanReceived` — the alarm fired while the app was in the foreground (the
 *   notification posted at the prayer instant), opening the page at once.
 * - `adhanLaunch` — the full-screen intent (or a tap on its notification) started the
 *   activity, including the cold start where Capacitor replays the retained event.
 *
 * Returns the unsubscribe function.
 */
export async function onAdhanOverlay(
  handler: (data: AdhanOverlayEvent, source: 'received' | 'launch') => void,
): Promise<() => void> {
  const received = await AdhanOverlay.addListener('adhanReceived', (data) =>
    handler(data, 'received'),
  );
  const launch = await AdhanOverlay.addListener('adhanLaunch', (data) =>
    handler(data, 'launch'),
  );
  return () => {
    received.remove();
    launch.remove();
  };
}
