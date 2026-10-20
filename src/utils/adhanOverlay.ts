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
  /** 'prayer' for adhan — decides which page opens. */
  type: 'prayer';
  /**
   * The channel's sound, so the native receiver can build the channel *with* it when the
   * channel is missing (a cleared app data set, a first boot). Android fixes a channel's
   * sound the moment the channel exists, so a receiver that mints one silently produces a
   * card that can never be heard — and no later `createChannel` call can undo it.
   * A bundled voice is a res/raw filename (`adhan_makkah_masjid.mp3`).
   */
  sound?: string;
  /**
   * Absolute path of a *downloaded* voice, which has no res/raw entry. The native side
   * publishes it through the FileProvider instead. Ignored when `sound` is present.
   */
  soundPath?: string;
}

/** Payload the native side hands back when the adhan/iqamah page must open. */
export interface AdhanOverlayEvent {
  prayerKey: string;
  prayerName?: string;
  time?: string;
  type?: 'prayer' | 'test';
  /**
   * False when the receiver's card could not ring at all — the notification call threw
   * (an OEM notification manager refusing it), the permission was revoked, or the
   * channel was muted. The page is then the only speaker the prayer has, so the JS side
   * must start its own recording instead of assuming the channel is ringing.
   */
  ringing?: boolean;
}

/**
 * What {@link AdhanOverlayPlugin.schedule} actually managed, and whether the system
 * really holds it.
 *
 * Arming is not the same as being armed: Android 12+ can refuse exact alarms, an OEM
 * cleaner can drop a batch the moment it is written, and a downgraded (inexact) alarm
 * may fire minutes late in doze — which for an adhan is the same as not ringing. The
 * native side asks the platform itself (`getNextAlarmClock()`) rather than trusting the
 * return of the arming call, and hands the answer back so JS can keep its sound
 * fallbacks instead of assuming the takeover will speak.
 */
export interface AdhanScheduleResult {
  /** Alarms the platform accepted. */
  armed: number;
  /** True when exact alarms were refused and the batch was downgraded to inexact. */
  inexact: boolean;
  /**
   * True when the system's own next-alarm-clock row matches the batch just armed —
   * the only honest answer to "is it really on the books?".
   */
  verified: boolean;
}

/** Result of the self-test alarm — see {@link armTestAdhanAlarm}. */
export interface AdhanTestAlarmResult {
  /** Alarms the platform accepted — always one, for the test. */
  armed: number;
  /** True when exact alarms were refused and the test went out inexact. */
  inexact: boolean;
  /** True when the test was armed as an exact alarm-clock alarm. */
  verified: boolean;
  /** Device-clock instant the test will fire at. */
  at: number;
}

interface AdhanOverlayPlugin {
  schedule(options: { alarms: AdhanOverlayAlarm[] }): Promise<AdhanScheduleResult>;
  cancelAll(): Promise<void>;
  setChannel(options: {
    id: string;
    name: string;
    description?: string;
    soundPath: string;
    /** Android channel importance; the adhan's HIGH is the default. */
    importance?: number;
  }): Promise<void>;
  setKeepScreenOn(options: { on: boolean }): Promise<void>;
  testAlarm(options: {
    channelId: string;
    prayerKey: string;
    prayerName?: string;
    title: string;
    body?: string;
    /** How far in the future to arm it; 10s by default, never below 1s. */
    delayMs?: number;
    /** Bundled voice: its res/raw name. */
    sound?: string;
    /** Downloaded voice: the stored path the FileProvider publishes. */
    soundPath?: string;
  }): Promise<AdhanTestAlarmResult>;
  protectionStatus(options?: { channelId?: string }): Promise<ProtectionStatus>;
  openProtectionSettings(options: { target: ProtectionTarget }): Promise<void>;
  addListener(
    eventName: 'adhanReceived' | 'adhanLaunch',
    listenerFunc: (data: AdhanOverlayEvent) => void,
  ): Promise<PluginListenerHandle>;
}

const AdhanOverlay = registerPlugin<AdhanOverlayPlugin>('AdhanOverlay');

/**
 * Whether anything on the device can hold the adhan back — the device's own
 * answers, read natively, because a WebView cannot see any of them.
 */
export interface ProtectionStatus {
  /** Notifications allowed for this app in the system settings. */
  notificationsEnabled: boolean;
  /** Android 12+ exact-alarm permission: without it prayers ring in batches. */
  exactAlarmsAllowed: boolean;
  /** Android 14+ full-screen-intent access: without it the adhan page cannot take over. */
  fullScreenIntentAllowed: boolean;
  /** Battery optimisation exempted — otherwise doze may postpone a prayer. */
  ignoringBatteryOptimizations: boolean;
  /**
   * Do Not Disturb is on. Every notification the app posts then arrives in silence,
   * the adhan included — the most common cause of «بيوصل من غير صوت» on Xiaomi and
   * Samsung, and invisible from inside a WebView.
   */
  dndActive?: boolean;
  /** The ringer is on vibrate or silent: the channel's sound exists, nothing sounds. */
  ringerSilent?: boolean;
  /**
   * Only present when a `channelId` was passed: whether that channel carries a sound
   * the *app* gave it. A channel is immutable once created, so one minted before the
   * adhan sound existed stays silent forever and has to be deleted and rebuilt, not
   * fixed — the scheduler does that itself when this comes back false.
   */
  channelSoundOk?: boolean;
  /**
   * Only present when a `channelId` was passed: the reader silenced this channel in the
   * system settings. Their choice, so the app reports it and never undoes it — the adhan
   * page speaks the call itself instead.
   */
  channelMuted?: boolean;
}

/** Which system screen a fix should open. */
export type ProtectionTarget =
  | 'notifications'
  | 'exact'
  | 'full-screen'
  | 'battery'
  | 'autostart'
  | 'dnd'
  | 'sound';

/**
 * Replace the armed takeover alarms with this batch (empty = cancel all).
 *
 * Every resume rebuilds the whole window, so this mirrors the notification queue's
 * swap semantics: the native side cancels its previous alarms, then arms the new ones.
 *
 * The native answer is handed back, because arming is not the same as being armed: an
 * inexact or unverifiable batch may ring minutes late (or not at all) on a dozing phone,
 * and the caller must then keep its sound fallbacks instead of trusting the takeover.
 */
export async function scheduleAdhanOverlay(
  alarms: AdhanOverlayAlarm[],
): Promise<AdhanScheduleResult> {
  if (!Capacitor.isNativePlatform()) return { armed: 0, inexact: false, verified: false };
  return await AdhanOverlay.schedule({ alarms });
}

/**
 * Create/update a prayer channel whose sound is a file the app stored on disk.
 *
 * Only needed for downloaded voices: bundled ones go through the notification plugin's
 * channel builder, which resolves them from res/raw. A stored file has no resource id,
 * so the native side publishes it through the FileProvider instead.
 */
export async function setAdhanChannel(options: {
  id: string;
  name: string;
  description?: string;
  soundPath: string;
  /** Android channel importance; only the reminder channels override the HIGH default. */
  importance?: number;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await AdhanOverlay.setChannel(options);
}

/**
 * Hold the screen while the adhan page is up, hand it back when the page closes.
 *
 * The takeover wakes the screen at prayer time, but the system timeout would put it
 * back to sleep while the adhan is still playing — a dark screen over a ringing page
 * looks broken. The native flag only lives on the visible window (backgrounding the
 * app releases it anyway), and the caller caps the hold so a page left open cannot
 * keep the display lit all night.
 */
export async function setAdhanKeepScreenOn(on: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdhanOverlay.setKeepScreenOn({ on });
  } catch (err) {
    console.warn('Could not update the keep-screen-on flag:', err);
  }
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
 * The device's own verdict on whether the adhan can ring: notifications open,
 * exact alarms allowed, battery optimisation lifted, Do Not Disturb off, ringer on.
 * `null` on the web (or when the native side is missing) — callers hide themselves
 * then, because there is no device to speak of.
 *
 * Pass `channelId` to also ask whether that channel really carries a sound; leave it
 * out when the channel has not been created yet (its sound is about to be set by JS,
 * which is the answer that will hold).
 */
export async function getProtectionStatus(channelId?: string): Promise<ProtectionStatus | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await AdhanOverlay.protectionStatus(channelId ? { channelId } : {});
  } catch (err) {
    console.warn('Could not read the protection status:', err);
    return null;
  }
}

/**
 * Arm one throwaway alarm through the very same receiver the adhan uses, a few seconds
 * from now.
 *
 * This is the honest answer to «هل الأذان شغّال على ده الموبايل؟»: it exercises the
 * whole chain — the platform's alarm-clock registration, the receiver, the prayer
 * channel's sound, the full-screen takeover, the page — in seconds, on whatever phone
 * is in hand, without waiting for the next prayer. It never touches the armed batch
 * (its request code sits outside every notification id range), and the page it raises
 * arrives as `type: 'test'`, which the trigger opens as a *preview* — a test can never
 * stamp a record onto a real prayer.
 */
export async function armTestAdhanAlarm(options: {
  channelId: string;
  prayerKey: string;
  prayerName?: string;
  title: string;
  body?: string;
  delayMs?: number;
  /** Bundled voice: its res/raw name, so the receiver can build the channel ringing. */
  sound?: string;
  /** Downloaded voice: the stored path the FileProvider publishes. */
  soundPath?: string;
}): Promise<AdhanTestAlarmResult | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await AdhanOverlay.testAlarm(options);
  } catch (err) {
    console.warn('Could not arm the test adhan alarm:', err);
    return null;
  }
}

/**
 * Open the system screen that lifts one of the restrictions
 * {@link getProtectionStatus} reports. The native side falls back to the app
 * details page whenever a ROM does not carry the screen asked for, so this
 * never dead-ends.
 */
export async function openProtectionSettings(target: ProtectionTarget): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await AdhanOverlay.openProtectionSettings({ target });
  } catch (err) {
    console.warn('Could not open the protection settings:', err);
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
