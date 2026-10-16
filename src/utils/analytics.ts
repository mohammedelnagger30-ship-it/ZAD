import { supabase } from '@/utils/supabaseClient';

/**
 * Anonymous usage reporting: "who opened the app today?" with no names attached.
 *
 * Every open is reported to `track_app_open`, which stamps it either with the
 * signed-in account or with a random id that lives only on this device. That id
 * is the whole of a guest's identity — no account, no ip, nothing joinable — and
 * it is what lets the dashboard count people who walked in without signing in.
 *
 * Two things are kept client-side so the table stays a record of visits rather
 * than of button presses: the device id, and the moment this identity was last
 * counted. A repeat open inside the window is dropped here, before it costs a
 * round trip; the server applies the same window again in case storage is
 * cleared or two tabs disagree.
 */

const DEVICE_ID_KEY = 'zad:device-id';
const LAST_OPEN_KEY = 'zad:last-app-open';

/** One identity is counted once per this window, on either side of the wire. */
export const TRACK_WINDOW_MS = 30 * 60_000;

export interface TrackMarker {
  /** What was counted: `user:<id>` for an account, `device:<id>` for a guest. */
  identity: string;
  /** Epoch milliseconds of the last counted open. */
  at: number;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.getRandomValues === 'function') {
    cryptoRef.getRandomValues(buffer);
  } else {
    // Storage-less fallback: the id only has to be stable and unguessable enough
    // to separate one device from another, never to identify anybody.
    for (let i = 0; i < bytes; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A fresh anonymous device id, 8–64 chars as the server column requires. */
export function mintDeviceId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `zad-${cryptoRef.randomUUID()}`;
  }
  return `zad-${randomHex(16)}`;
}

/**
 * The id this device reports under, minted on first use and reused after.
 * Falls back to a throwaway id when storage is unavailable (private mode, a
 * refusing WebView): that open is still counted, it simply counts as a new
 * device next time.
 */
export function readOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing && existing.length >= 8 && existing.length <= 64) return existing;
    const minted = mintDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    return mintDeviceId();
  }
}

/** Parse the stored marker defensively: corrupt storage must not throw. */
export function parseMarker(raw: string | null): TrackMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TrackMarker> | null;
    if (!parsed || typeof parsed.identity !== 'string' || !parsed.identity) return null;
    if (typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    return { identity: parsed.identity, at: parsed.at };
  } catch {
    return null;
  }
}

export function readMarker(): TrackMarker | null {
  try {
    return parseMarker(localStorage.getItem(LAST_OPEN_KEY));
  } catch {
    return null;
  }
}

/**
 * Should this open be counted?
 *
 * A different identity always counts — the account the reader just signed into
 * must not hide behind a guest open from a minute ago. The same identity counts
 * again once the window has passed, and also when the clock moved backwards past
 * the stored moment (a wrong device clock must not silence reporting forever).
 */
export function shouldTrackAppOpen(marker: TrackMarker | null, identity: string, now: number): boolean {
  if (!marker || marker.identity !== identity) return true;
  if (marker.at > now) return true;
  return now - marker.at >= TRACK_WINDOW_MS;
}

function writeMarker(marker: TrackMarker): void {
  try {
    localStorage.setItem(LAST_OPEN_KEY, JSON.stringify(marker));
  } catch {
    // Without storage the next open is simply counted again — the server-side
    // window keeps that from turning into a flood.
  }
}

function appVersion(): string | null {
  // `import.meta.env` does not exist under Jest, hence the optional chain.
  const version = import.meta.env?.VITE_APP_VERSION?.trim();
  return version ? version.slice(0, 32) : null;
}

/**
 * Report an app open for the current identity.
 *
 * Resolves to true only when the server actually recorded it, so a caller can
 * tell a counted open from one the network or the window declined. Failures are
 * swallowed: analytics must never surface an error to the person using the app.
 */
export async function trackAppOpen(userId?: string | null): Promise<boolean> {
  if (!supabase) return false;

  const deviceId = readOrCreateDeviceId();
  const identity = userId ? `user:${userId}` : `device:${deviceId}`;
  const now = Date.now();

  if (!shouldTrackAppOpen(readMarker(), identity, now)) return false;

  try {
    const { error } = await supabase.rpc('track_app_open', {
      p_device_id: deviceId,
      p_app_version: appVersion(),
    });
    if (error) {
      // A missing migration or an offline device is expected, not exceptional.
      console.warn('Usage tracking skipped:', error.message);
      return false;
    }
  } catch (cause) {
    console.warn('Usage tracking skipped:', cause instanceof Error ? cause.message : cause);
    return false;
  }

  writeMarker({ identity, at: now });
  return true;
}
