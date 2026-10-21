/**
 * When the adhan/iqamah page may still open *by itself*, and when a page that is
 * already open has to get out of the way.
 *
 * The page is a claim about the present — «حَانَ الآنْ وَقْت…» — so it may only stand
 * for a moment that just happened. Android hands the app two ways to be late with that
 * claim, and both used to surface as the same complaint («فتحت التطبيق العصر ففتحلي
 * أذان الظهر»):
 *
 *  - an alert event delivered long after its instant (a bridge event replayed on a
 *    later start, a notification card tapped hours afterwards), and
 *  - a page that opened at the right minute but stayed on screen — over the lock
 *    screen, or on a phone nobody was holding — until the next time the person looked.
 *
 * The window is generous: a full-screen takeover arrives at the instant itself, a cold
 * start adds seconds, and the in-app sweep catches up within five minutes. Anything
 * past this is history, and history belongs to the prayer log, not to a takeover.
 */

/** Native alerts older than this never open the page on their own.
 *
 * Mirrors the native receiver's own `MISFIRED_AFTER_MS`, deliberately: one number for
 * "how late is too late" on both sides of the bridge, so an alarm the platform delivered
 * fifteen minutes late cannot still raise a page claiming «الآن» — past this line the
 * prayer is history and the receiver has already posted the «تأخّر التنبيه» notice in
 * its place. */
export const NATIVE_OPEN_MAX_LATE_MS = 15 * 60_000;

/** An open page older than this closes itself as soon as the app is visible. */
export const STALE_AZAN_CLOSE_MS = 30 * 60_000;

/** The id span every notification category reserves — mirrors `notificationId`. */
const ID_SPAN = 1_000_000;

/**
 * Whether a native alert (payload `time`, ISO-8601) is still current enough to open the
 * page. A missing or unreadable instant is treated as fresh: newer native builds always
 * send one, and an older build should keep working rather than go silent.
 */
export function isNativeOpenFresh(time: string | undefined, nowMs: number): boolean {
  if (time == null) return true;
  const instant = new Date(time).getTime();
  if (!Number.isFinite(instant)) return true;
  return nowMs - instant <= NATIVE_OPEN_MAX_LATE_MS;
}

export interface AzanOpenSnapshot {
  isOpen: boolean;
  isPreview?: boolean;
  prayerTime?: Date;
}

/**
 * Whether the currently open page has outlived its moment. A preview is never stale
 * (it is a look at the page, not a claim about the clock), and an open without an
 * instant — a manual preview — has nothing to judge.
 */
export function isStaleAzanOpen(state: AzanOpenSnapshot, nowMs: number): boolean {
  if (!state.isOpen || state.isPreview) return false;
  const instant = state.prayerTime?.getTime();
  if (instant == null || !Number.isFinite(instant)) return false;
  return nowMs - instant > STALE_AZAN_CLOSE_MS;
}

/**
 * Whether one of the system's *delivered* notifications is this prayer's alert.
 *
 * The adhan and iqamah alerts can be posted twice over: by the native takeover receiver
 * (which builds its own card, taking the title straight from the alarm it fires) and by
 * the notification plugin as a fallback. Both share the category's id range — which is
 * how one of them replaces the other — and both carry the prayer's Arabic name in the
 * title, so (range, name) identifies the card no matter who posted it.
 */
export function isDeliveredAlertFor(
  notification: { id: number; title?: string | null },
  idBase: number,
  prayerName: string,
): boolean {
  if (!(notification.id >= idBase && notification.id < idBase + ID_SPAN)) return false;
  return (notification.title ?? '').includes(prayerName);
}
