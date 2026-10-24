/**
 * The trusted clock's arithmetic and its behaviour around a moved device clock.
 *
 * The contract under test: a wall-clock change must not move what the app
 * believes the time is, must be *seen* (drift + subscriber notification), and
 * must reach the alarm queue as a correction added to every armed instant.
 */
import { jest } from '@jest/globals';
import {
  JUMP_THRESHOLD_MS,
  __resetClockForTests,
  checkDeviceClockJump,
  computeDrift,
  deviceClockDriftMs,
  onClockChange,
  projectStoredAnchor,
  projectTrustedNow,
  toDeviceClock,
  trustedNowMs,
} from '@/utils/clock';

const ANCHOR_KEY = 'zad:clock-anchor';

describe('clock arithmetic', () => {
  it('projects a stored anchor forward by the device clock’s own elapsed time', () => {
    const anchor = projectStoredAnchor({ t: 1_000, d: 5_000 }, 8_000, 100);
    expect(anchor.trustedMs).toBe(4_000); // 3s passed on the device clock
    expect(anchor.deviceMs).toBe(8_000);
    expect(anchor.perfMs).toBe(100);
  });

  it('projects trusted time by monotonic elapsed time only', () => {
    const anchor = { trustedMs: 1_000, deviceMs: 5_000, perfMs: 100 };
    expect(projectTrustedNow(anchor, 1_100)).toBe(2_000);
    expect(projectTrustedNow(anchor, 100)).toBe(1_000);
  });

  it('measures drift as device minus trusted', () => {
    expect(computeDrift(1_000, 4_000)).toBe(3_000);
    expect(computeDrift(4_000, 1_000)).toBe(-3_000);
  });

  it('compensates an alarm target by the drift so it sounds at the true instant', () => {
    const trueInstant = 10_000;
    const drift = 3_600_000; // the phone's clock runs an hour ahead
    const armed = toDeviceClock(trueInstant, drift);
    expect(armed).toBe(trueInstant + drift);
    // Android fires when its clock reaches `armed`; real time then is armed − drift.
    expect(armed - drift).toBe(trueInstant);
  });
});

describe('trusted clock against a moved device clock', () => {
  const realDateNow = Date.now;
  const realPerfNow = performance.now;
  let fakeDeviceMs = 0;
  let fakePerfMs = 0;

  beforeEach(() => {
    __resetClockForTests();
    localStorage.clear();
    fakeDeviceMs = 1_000_000;
    fakePerfMs = 100;
    // Plain global patching: the module reads Date.now()/performance.now() at
    // call time, so the clock under test sees these values exactly.
    Date.now = () => fakeDeviceMs;
    performance.now = () => fakePerfMs;
  });

  afterEach(() => {
    Date.now = realDateNow;
    performance.now = realPerfNow;
    __resetClockForTests();
    localStorage.clear();
  });

  it('falls back to the device clock when there is no stored anchor', () => {
    expect(trustedNowMs()).toBe(1_000_000);
  });

  it('continues a stored anchor across a session, trusting the clock over the gap', () => {
    // Only an anchor the network vouched for may be carried forward; an
    // unvouched one is just an earlier reading of the device clock and is
    // reset to it (see ensureAnchor). Add `v: true` to simulate a synced anchor.
    localStorage.setItem(ANCHOR_KEY, JSON.stringify({ t: 1_000_000, d: 2_000_000, v: true }));
    fakeDeviceMs = 2_000_000 + 60_000;
    fakePerfMs = 10;
    expect(trustedNowMs()).toBe(1_060_000);
  });

  it('an unvouched stored anchor is not carried forward — the app follows the device clock', () => {
    // No `v` flag: the network never vouched for this anchor. Projecting it
    // would bake a stale offset into every alarm this session.
    localStorage.setItem(ANCHOR_KEY, JSON.stringify({ t: 1_000_000, d: 2_000_000 }));
    fakeDeviceMs = 2_000_000 + 60_000;
    fakePerfMs = 10;
    expect(trustedNowMs()).toBe(2_060_000);
    expect(deviceClockDriftMs()).toBe(0);
  });

  it('keeps trusted time still while the device clock is moved mid-session', () => {
    const before = trustedNowMs();
    expect(before).toBe(1_000_000);

    // The reader pushes the clock an hour forward; the monotonic anchor stays put.
    fakeDeviceMs = 1_000_000 + 3_600_000;
    fakePerfMs = 100;
    expect(trustedNowMs()).toBe(1_000_000);
    expect(deviceClockDriftMs()).toBe(3_600_000);
  });

  it('reports a wall-clock jump to subscribers once, and only once', () => {
    const listener = jest.fn();
    const unsubscribe = onClockChange(listener);

    expect(checkDeviceClockJump()).toBe(false); // nothing moved yet

    fakeDeviceMs = 1_000_000 + 60_000; // one minute step
    expect(checkDeviceClockJump()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(checkDeviceClockJump()).toBe(false); // already reported
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    fakeDeviceMs = 1_000_000 + 120_000;
    expect(checkDeviceClockJump()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('ignores steps below the jump threshold', () => {
    const listener = jest.fn();
    onClockChange(listener);
    trustedNowMs(); // the session's baseline, with the clock where it stands

    fakeDeviceMs = 1_000_000 + JUMP_THRESHOLD_MS - 1;
    expect(checkDeviceClockJump()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('persists the post-jump pairing so the next session starts from it', () => {
    trustedNowMs(); // the session's baseline, with the clock where it stands
    fakeDeviceMs = 1_000_000 + 60_000;
    expect(checkDeviceClockJump()).toBe(true);

    const stored = JSON.parse(localStorage.getItem(ANCHOR_KEY) ?? 'null') as { t: number; d: number } | null;
    expect(stored).not.toBeNull();
    expect(stored!.d).toBe(1_060_000); // device time as it now reads
    expect(stored!.t).toBe(1_000_000); // trusted time — unmoved by the jump
  });
});
