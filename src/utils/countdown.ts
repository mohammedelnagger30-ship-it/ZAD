/**
 * How often a countdown screen re-renders.
 *
 * `getTimeUntil` (the prayer countdown text) only ever shows seconds in the
 * last minute before the target; above that the string moves once a minute.
 * Ticking a screen's clock every second anyway re-renders the whole screen —
 * task lists, week grids, sheets — sixty times a minute for a string that
 * changes once. This module holds the arming arithmetic, split out so it can
 * be pinned down by tests without a DOM.
 */

/** Inside this much time left, tick every second — the only window seconds are shown. */
export const FAST_TICK_MS = 90_000;

/** Outside that window: the finest granularity the countdown text renders at. */
export const COARSE_TICK_MS = 60_000;

/**
 * How long to wait before the next tick, given `remainingMs` until the target
 * instant. Coarse most of the time; per-second only inside the last
 * `FAST_TICK_MS` — so the prayer passing flips the countdown within a second
 * while the rest of the day ticks once a minute. A far target is woken for
 * exactly the window edge when that lands sooner than the coarse cap; with no
 * target at all (`Infinity`) the clock coasts on the coarse cadence.
 */
export function countdownTickDelayMs(remainingMs: number): number {
  if (remainingMs <= FAST_TICK_MS) return 1000;
  return Math.min(COARSE_TICK_MS, Math.max(1000, remainingMs - FAST_TICK_MS));
}
