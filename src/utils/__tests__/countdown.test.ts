/**
 * Tests for the countdown re-render arithmetic (see utils/countdown.ts) —
 * how often a prayer-countdown screen is allowed to tick.
 */
import { countdownTickDelayMs, COARSE_TICK_MS, FAST_TICK_MS } from '../countdown';

describe('countdownTickDelayMs', () => {
  it('ticks every second inside the last-minute window — the only place seconds show', () => {
    expect(countdownTickDelayMs(0)).toBe(1000);
    expect(countdownTickDelayMs(45_000)).toBe(1000);
    expect(countdownTickDelayMs(FAST_TICK_MS)).toBe(1000);
    // Past the target: keep ticking per second until the schedule flips over.
    expect(countdownTickDelayMs(-30_000)).toBe(1000);
  });

  it('wakes exactly at the window edge when that lands sooner than the coarse cap', () => {
    expect(countdownTickDelayMs(FAST_TICK_MS + 1_000)).toBe(1000);
    expect(countdownTickDelayMs(FAST_TICK_MS + 30_000)).toBe(30_000);
  });

  it('coasts on the coarse cadence when far from the target — or with no target at all', () => {
    expect(countdownTickDelayMs(10 * 60_000)).toBe(COARSE_TICK_MS);
    expect(countdownTickDelayMs(5 * 60 * 60_000)).toBe(COARSE_TICK_MS);
    expect(countdownTickDelayMs(Number.POSITIVE_INFINITY)).toBe(COARSE_TICK_MS);
  });
});
