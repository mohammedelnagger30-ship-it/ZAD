/**
 * How far the day has travelled from the prayer before the next one to the next one.
 *
 * Kept apart from the screen that draws it because the arithmetic is the part that can
 * be wrong in a way nobody notices: a bar sitting at the wrong number still looks like a
 * bar. This is the one place the window is defined, so the fill, the figure printed
 * beside it, and the tick that decides whether to redraw all measure the same thing.
 *
 * The one thing that has to be got right is *which* prayer comes before the next one.
 * Reading the neighbour to the left in the array only works in the middle of the day: at
 * 03:00 the next prayer is الظهر, and the array's neighbour to its left is *today's*
 * العشاء — an instant that has not happened yet. Measuring «elapsed» from a prayer in the
 * future, then adding a day to make the sign come out positive, puts the elapsed and
 * total figures on two different timelines, and the bar then reports a value that can sit
 * at 100% (or anywhere else) for hours.
 *
 * So the window is built from the clock instead. Every prayer in the list is shifted to
 * the occurrence nearest to `now` — the day earlier if that is closer — which turns the
 * array into a run of instants around the reader; the previous prayer is then simply the
 * last one that has already passed. Overnight the two neighbours land a day apart and the
 * arithmetic is ordinary subtraction at both ends.
 *
 * The fraction is returned rather than a rounded percent so the bar can be filled to a
 * fraction of a percent and glide, while the figure beside it is rounded at draw time.
 */

/** The shape this module needs from a prayer: a name to match on, and an instant. */
export interface ProgressPrayer {
  name: string;
  time: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shifts an instant to the occurrence nearest `nowMs` — earlier if that is closer. */
function nearestOccurrence(ms: number, nowMs: number): number {
  let t = ms;
  while (t - nowMs > DAY_MS / 2) t -= DAY_MS;
  while (nowMs - t > DAY_MS / 2) t += DAY_MS;
  return t;
}

/**
 * The elapsed part of the window from the previous prayer to the next one, as a number
 * in `[0, 1]`. Zero whenever the question cannot be answered — no schedule, the next
 * prayer not in it, or a window that does not run forwards — so a caller can draw it
 * without a guard of its own.
 */
export function prayerProgressFraction(
  prayers: readonly ProgressPrayer[] | null | undefined,
  nextPrayer: ProgressPrayer | null | undefined,
  now: Date,
): number {
  if (!nextPrayer || !prayers?.length) return 0;
  const nextIdx = prayers.findIndex((prayer) => prayer.name === nextPrayer.name);
  if (nextIdx === -1) return 0;

  const nowMs = now.getTime();

  // The next prayer is the end of the window whatever its stamped day says; pull it to
  // the nearest occurrence so a schedule computed for tomorrow still measures sensibly.
  const nextMs = nearestOccurrence(nextPrayer.time.getTime(), nowMs);

  // Every prayer placed on the same run of instants as the reader.
  const timeline = prayers.map((prayer) => nearestOccurrence(prayer.time.getTime(), nowMs));

  // The last prayer to have passed is the start of the window. It is normally the
  // neighbour to the left, but deriving it from the clock rather than the index keeps the
  // answer right when the array's own ordering straddles midnight.
  let prevMs = Number.NEGATIVE_INFINITY;
  for (const t of timeline) {
    if (t <= nowMs && t > prevMs) prevMs = t;
  }
  if (!Number.isFinite(prevMs)) {
    // Nothing has passed yet on this run — the window opened at the previous day's last
    // prayer, a day before the one the reader is in.
    const latest = timeline.reduce((best, t) => Math.max(best, t), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(latest)) return 0;
    prevMs = latest - DAY_MS;
  }

  const span = nextMs - prevMs;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (nowMs - prevMs) / span));
}
