/**
 * The clock the app keeps time by.
 *
 * Prayer times are astronomy: their instants depend on the city, not on the phone.
 * The device wall clock, by contrast, belongs to whoever holds the phone — a reader
 * may move it forward or back, and everything scheduled against it moves with it.
 * This module keeps a second opinion:
 *
 *  - an **anchor** of believed-true wall time, captured together with a monotonic
 *    reading (`performance.now()`), which a wall-clock change cannot move;
 *  - `trustedNow()` — the anchor projected forward by monotonic elapsed time, so a
 *    clock changed mid-session changes nothing about what the app believes;
 *  - a network sync (the `Date` header of a same-origin response, with public
 *    time APIs behind it) that re-captures the anchor whenever the phone is online,
 *    which is what catches a clock changed while the app was closed;
 *  - a watchdog that notices a wall-clock jump while the app is alive and tells
 *    subscribers (the notification queue re-arms its alarms in device-clock
 *    coordinates, so the alarm still sounds at the true instant);
 *  - `deviceClockDriftMs()` — how far the device clock now sits from the truth,
 *    the correction added to every absolute alarm target before handing it to
 *    Android, whose alarms fire when the *device* clock reaches them.
 *
 * Honest limitation: with the phone offline, fully closed, and its clock changed
 * while off, there is no second source to consult — the device clock is all there
 * is until the next successful sync. Everything detectable is detected.
 */

const ANCHOR_KEY = 'zad:clock-anchor';

/** A wall-clock move at least this big, seen in one step, counts as tampering. */
export const JUMP_THRESHOLD_MS = 5_000;

/** Re-check against the network this often while online. */
const SYNC_INTERVAL_MS = 5 * 60_000;

const SYNC_TIMEOUT_MS = 8_000;

/** How often the watchdog compares the wall clock against the monotonic projection. */
const WATCHDOG_INTERVAL_MS = 15_000;

interface Anchor {
  /** Believed-true wall time at the moment `perfMs` was read. */
  trustedMs: number;
  /** Device wall time at the same moment — the base for drift compensation. */
  deviceMs: number;
  /** Monotonic reading at the same moment. */
  perfMs: number;
}

interface StoredAnchor {
  t: number;
  d: number;
}

/* ------------------------------------------------------------------ *
 * Pure helpers (exported for the tests that pin this arithmetic down).
 * ------------------------------------------------------------------ */

/**
 * The anchor to start a session from: project the stored anchor forward by how
 * much the device clock says time passed since it was written. This trusts the
 * clock across the gap — with nothing else to consult, that is the only move —
 * but every in-session change after this point is caught by the monotonic side.
 */
export function projectStoredAnchor(stored: StoredAnchor, deviceNow: number, perfNow: number): Anchor {
  const trusted = stored.t + (deviceNow - stored.d);
  return { trustedMs: trusted, deviceMs: deviceNow, perfMs: perfNow };
}

/** Believed-true wall time, projected by monotonic elapsed time. */
export function projectTrustedNow(anchor: Anchor, perfNow: number): number {
  return anchor.trustedMs + (perfNow - anchor.perfMs);
}

/** How far the device wall clock now sits from the believed-true wall clock. */
export function computeDrift(trustedNow: number, deviceNow: number): number {
  return deviceNow - trustedNow;
}

/**
 * The device-clock instant an alarm must be armed at so that it sounds when the
 * *true* instant arrives: Android fires when its own clock reaches the target,
 * so the target carries the drift with it.
 */
export function toDeviceClock(trueInstantMs: number, driftMs: number): number {
  return trueInstantMs + driftMs;
}

/* ------------------------------------------------------------------ *
 * Environment shims — the module must load anywhere (tests included).
 * ------------------------------------------------------------------ */

function nowPerf(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function readStoredAnchor(): StoredAnchor | null {
  try {
    const raw = globalThis.localStorage?.getItem(ANCHOR_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredAnchor).t === 'number' &&
      typeof (parsed as StoredAnchor).d === 'number'
    ) {
      return parsed as StoredAnchor;
    }
    return null;
  } catch {
    return null;
  }
}

function writeStoredAnchor(stored: StoredAnchor): void {
  try {
    globalThis.localStorage?.setItem(ANCHOR_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable: the session keeps its in-memory anchor; the next
    // session simply starts from the device clock again.
  }
}

/* ------------------------------------------------------------------ *
 * Service state.
 * ------------------------------------------------------------------ */

let anchor: Anchor | null = null;
let lastKnownDrift = 0;
let started = false;
let syncInFlight = false;
const listeners = new Set<() => void>();

function ensureAnchor(): Anchor {
  if (anchor) return anchor;
  const deviceNow = Date.now();
  const perfNow = nowPerf();
  const stored = readStoredAnchor();
  anchor = stored ? projectStoredAnchor(stored, deviceNow, perfNow) : { trustedMs: deviceNow, deviceMs: deviceNow, perfMs: perfNow };
  lastKnownDrift = computeDrift(projectTrustedNow(anchor, perfNow), deviceNow);
  return anchor;
}

/** Believed-true wall time, in epoch milliseconds. */
export function trustedNowMs(): number {
  return projectTrustedNow(ensureAnchor(), nowPerf());
}

/** Believed-true wall time as a Date. */
export function trustedNow(): Date {
  return new Date(trustedNowMs());
}

/** Device clock minus trusted clock — the correction every alarm target carries. */
export function deviceClockDriftMs(): number {
  return computeDrift(trustedNowMs(), Date.now());
}

function persistAnchor(): void {
  writeStoredAnchor({ t: trustedNowMs(), d: Date.now() });
}

function emitClockChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.warn('Clock-change listener failed:', err);
    }
  }
}

/** Fires whenever the believed-true clock jumps — a clock change or a network correction. */
export function onClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A wall-clock step the monotonic projection did not take: someone moved the
 * clock while the app was alive. The trusted time is untouched (the anchor's
 * monotonic side still holds) — the drift changed, so alarms re-arm and the
 * new drift is persisted for the next session's projection.
 */
export function checkDeviceClockJump(): boolean {
  ensureAnchor();
  const drift = deviceClockDriftMs();
  if (Math.abs(drift - lastKnownDrift) < JUMP_THRESHOLD_MS) return false;
  lastKnownDrift = drift;
  persistAnchor();
  emitClockChange();
  return true;
}

/* ------------------------------------------------------------------ *
 * Network sync — the only authority beyond the phone itself.
 * ------------------------------------------------------------------ */

interface TimeSource {
  request: () => Promise<number>;
}

/**
 * Same-origin first: its `Date` header is readable without CORS cooperation and
 * it is a server the app already trusts. Public time APIs (CORS-open JSON) stand
 * behind it — Capacitor's local asset server does not send a `Date` header, so
 * on native the chain falls through to them.
 */
const TIME_SOURCES: TimeSource[] = [
  {
    request: async () => {
      const url = new URL('/', globalThis.location?.origin ?? 'http://localhost').toString();
      const sentPerf = nowPerf();
      const response = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
      const receivedPerf = nowPerf();
      const header = response.headers.get('date');
      if (!header) throw new Error('no Date header');
      const serverMs = Date.parse(header);
      if (!Number.isFinite(serverMs)) throw new Error('unparsable Date header');
      // The header is written when the response is built; half the round trip
      // (to second granularity) is the best placement of that instant.
      return serverMs + (receivedPerf - sentPerf) / 2;
    },
  },
  {
    request: async () => {
      const response = await fetch('https://worldtimeapi.org/api/timezone/Etc/UTC', { cache: 'no-store' });
      if (!response.ok) throw new Error('worldtimeapi unavailable');
      const body = (await response.json()) as { unixtime?: number };
      if (typeof body.unixtime !== 'number') throw new Error('no unixtime');
      return body.unixtime * 1000;
    },
  },
  {
    request: async () => {
      const response = await fetch('https://timeapi.io/api/Time/current/zone?timeZone=Etc/UTC', { cache: 'no-store' });
      if (!response.ok) throw new Error('timeapi unavailable');
      const body = (await response.json()) as { unixTime?: number };
      if (typeof body.unixTime !== 'number') throw new Error('no unixTime');
      return body.unixTime * 1000;
    },
  },
];

/**
 * Re-capture the anchor from an external source. A correction beyond the jump
 * threshold is a real answer to "the phone's clock moved" — subscribers
 * re-arm; a sub-threshold difference is round-trip noise and stays quiet.
 */
export async function syncTrustedTime(): Promise<boolean> {
  if (syncInFlight) return false;
  syncInFlight = true;
  try {
    for (const source of TIME_SOURCES) {
      try {
        const externalMs = await Promise.race([
          source.request(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('time sync timed out')), SYNC_TIMEOUT_MS),
          ),
        ]);
        const before = trustedNowMs();
        const perfNow = nowPerf();
        anchor = { trustedMs: externalMs, deviceMs: Date.now(), perfMs: perfNow };
        lastKnownDrift = computeDrift(externalMs, Date.now());
        persistAnchor();
        if (Math.abs(externalMs - before) >= JUMP_THRESHOLD_MS) emitClockChange();
        return true;
      } catch {
        // This source failed — the next one is still worth a try.
      }
    }
    return false;
  } finally {
    syncInFlight = false;
  }
}

/* ------------------------------------------------------------------ *
 * Lifecycle.
 * ------------------------------------------------------------------ */

/**
 * Boot the watchdog and the periodic sync. Idempotent; called once by the app.
 * Without it the trusted clock still works — it simply runs on the stored
 * projection and the in-session monotonic anchor alone.
 */
export function startClockService(): void {
  if (started) return;
  started = true;
  ensureAnchor();

  // First contact with a server settles the argument about the current instant.
  void syncTrustedTime();

  const watchdog = globalThis.setInterval?.(() => {
    if (checkDeviceClockJump()) return; // a jump already told every subscriber
    persistAnchor(); // keep the stored projection fresh for the next session
  }, WATCHDOG_INTERVAL_MS);
  if (typeof watchdog === 'object' && watchdog !== null && 'unref' in watchdog) {
    (watchdog as { unref?: () => void }).unref?.(); // tests: never hold the process open
  }

  globalThis.setInterval?.(() => {
    if (globalThis.navigator?.onLine !== false) void syncTrustedTime();
  }, SYNC_INTERVAL_MS);

  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.visibilityState !== 'visible') return;
    if (checkDeviceClockJump()) return;
    if (globalThis.navigator?.onLine !== false) void syncTrustedTime();
  });

  globalThis.addEventListener?.('pagehide', () => {
    persistAnchor();
  });
}

/** Test seam: drop the session's anchor and subscribers so a case starts clean. */
export function __resetClockForTests(): void {
  anchor = null;
  lastKnownDrift = 0;
  started = false;
  syncInFlight = false;
  listeners.clear();
}
