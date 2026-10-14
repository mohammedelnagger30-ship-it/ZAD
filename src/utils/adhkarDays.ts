/**
 * The list of days the daily adhkar was carried all the way through.
 *
 * The counters in `AdhkarState` are wiped whenever the date rolls over, so on
 * their own they can only ever answer "did I finish *today*" — and the very
 * day they are finished is the day they stop keeping. This list is what
 * turns a year of scattered afternoons into a number that a badge, or a
 * streak, or a question like «كم يومًا أتممتها؟» can be answered with.
 *
 * It is stored, merged, restored from a backup and pulled down from a cloud
 * that did not know it existed, so everything here assumes the value it is
 * handed may be nonsense.
 */

/**
 * How many completed days are kept.
 *
 * A year and a bit is far past any badge's reach and costs about four
 * kilobytes, but the whole object is what travels on every sync — so the
 * history is bounded rather than left to grow for as long as the app is
 * installed.
 */
export const MAX_COMPLETED_DAYS = 400;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turns whatever was stored into a usable history.
 *
 * Sorted oldest first so the cap drops the oldest rather than an arbitrary
 * one, and de-duplicated because two devices that each finished today and
 * then met in the cloud would otherwise both be counted — a merge is exactly
 * where a badge's number quietly doubles.
 */
export function normalizeCompletedDays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const days = value.filter(
    (day): day is string => typeof day === 'string' && ISO_DAY.test(day),
  );
  return Array.from(new Set(days)).sort().slice(-MAX_COMPLETED_DAYS);
}

/**
 * Files `day` into the history.
 *
 * Returns the array it was handed when the day is already recorded, so the
 * caller can tell "nothing happened" from "something did" without comparing
 * dates — that identity check is what keeps the effect that calls this from
 * re-running on every render while the day sits at 100%.
 */
export function recordCompletedDay(days: string[], day: string): string[] {
  if (!ISO_DAY.test(day) || days.includes(day)) return days;
  return [...days, day].sort().slice(-MAX_COMPLETED_DAYS);
}
