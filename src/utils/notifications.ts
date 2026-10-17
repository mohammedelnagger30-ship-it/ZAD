import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

// Low-level notification helpers: permission checks, id allocation, cancellation and
// the exact-alarm gate.
//
// Scheduling lives in `@/utils/notificationScheduler`, which owns the channels and the
// rebuild flow. Earlier versions of this file also contained copies of
// `schedulePrayerNotifications` / `scheduleDailyTaskNotifications`; those duplicated the
// scheduler and were never called.

/**
 * Notification ids are partitioned into disjoint per-category ranges.
 *
 * The old scheme (`prefix * 100000 + dayStamp + extra` with prefixes `20 + task.id`)
 * let a task numbered 10 land on the hadith-of-the-day id and a task numbered 20 land
 * on a dhikr-reminder id, so scheduling one silently replaced the other. Ranges below
 * cannot collide: every slot stays inside its own million, and all of them fit a
 * positive 32-bit int (Android uses the id as the PendingIntent requestCode).
 *
 * Slots only have to be unique within one rebuild, because every rebuild cancels the
 * queue it is replacing (the one exception — the adhan overlay's snooze — has its own
 * reserved range and is preserved across rebuilds).
 */
export const NOTIFICATION_ID_BASE = {
  /** Prayers of the armed window. */
  prayer: 1_000_000,
  /** Pre-prayer reminders. */
  reminder: 2_000_000,
  /** Hifz / review tasks (slot = Dexie task id). */
  task: 3_000_000,
  /** Hadith of the day. */
  hadith: 4_000_000,
  /** Random dhikr reminders. */
  dhikr: 5_000_000,
  /** Iqamah alerts (الإقامة) — the جماعة's own minute after the adhan. */
  iqamah: 6_000_000,
  /** Spaced-repetition reminders for memorised ayah ranges. */
  hifzReview: 7_000_000,
  /** Adhan-overlay snoozes — the only ids that survive a rebuild. */
  snooze: 9_000_000,
} as const;

const MAX_SLOT = 999_999;

function idFor(base: number, slot: number): number {
  const bounded = Number.isFinite(slot) ? Math.abs(Math.trunc(slot)) : 0;
  return base + (bounded % (MAX_SLOT + 1));
}

export const notificationId = {
  prayer: (slot: number) => idFor(NOTIFICATION_ID_BASE.prayer, slot),
  reminder: (slot: number) => idFor(NOTIFICATION_ID_BASE.reminder, slot),
  task: (taskId: number) => idFor(NOTIFICATION_ID_BASE.task, taskId),
  hadith: (slot = 0) => idFor(NOTIFICATION_ID_BASE.hadith, slot),
  dhikr: (slot: number) => idFor(NOTIFICATION_ID_BASE.dhikr, slot),
  iqamah: (slot: number) => idFor(NOTIFICATION_ID_BASE.iqamah, slot),
  hifzReview: (slot: number) => idFor(NOTIFICATION_ID_BASE.hifzReview, slot),
  /**
   * Snooze ids embed the second within the reserved range instead of the wall clock:
   * two snoozes rarely collide, a collision merely replaces the older reminder, and the
   * range stays identifiable so a rebuild can leave it alone.
   */
  snooze: () => idFor(NOTIFICATION_ID_BASE.snooze, Math.floor(Date.now() / 1000)),
} as const;

export function isSnoozeNotification(id: number): boolean {
  return id >= NOTIFICATION_ID_BASE.snooze && id < NOTIFICATION_ID_BASE.snooze + (MAX_SLOT + 1);
}

/** Schedule instant of a pending notification, in whatever shape the plugin returns it. */
function scheduledAt(notification: LocalNotificationSchema): number | null {
  const at = notification.schedule && 'at' in notification.schedule ? notification.schedule.at : undefined;
  if (at == null) return null;
  const time = at instanceof Date ? at.getTime() : new Date(at as string | number).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Predicate for {@link cancelAllNotifications}: keep an adhan-overlay snooze that has
 * not fired yet.
 *
 * Rebuilds run on every resume, and the old unconditional cancel-all silently deleted
 * the reminder the user had just asked for — «تذكير بعد 10 دقائق» vanished the moment
 * the app went to the background and came back.
 */
export function preserveActiveSnooze(notification: LocalNotificationSchema): boolean {
  if (!isSnoozeNotification(notification.id)) return false;
  const at = scheduledAt(notification);
  return at == null || at > Date.now();
}

/**
 * How long a permission request may stay unanswered before the caller stops waiting.
 *
 * On a number of Android builds the system shows no notification-permission dialog at
 * all, or shows one and never delivers the plugin's result back to the WebView —
 * `requestPermissions()` then stays pending forever. Callers await it while showing a
 * «جارٍ التفعيل...» state, so an unanswered request used to freeze the onboarding
 * screen indefinitely.
 */
export const NOTIFICATION_PERMISSION_TIMEOUT_MS = 10_000;

/**
 * Resolves `null` once `promise` has not settled within `ms`, instead of waiting forever.
 *
 * A promise that settles late is still safe: `Promise.race` holds a reaction on it, so a
 * late rejection is swallowed rather than surfacing as an unhandled rejection.
 */
async function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    if ('Notification' in window) {
      const perm = await settleWithin(Notification.requestPermission(), NOTIFICATION_PERMISSION_TIMEOUT_MS);
      return perm === 'granted';
    }
    return false;
  }
  const granted = await settleWithin(
    LocalNotifications.requestPermissions().then((perm) => perm.display === 'granted'),
    NOTIFICATION_PERMISSION_TIMEOUT_MS,
  );
  if (granted !== null) return granted;
  // The request went unanswered (some OEM skins swallow the dialog or its result).
  // Report whatever the system state actually is, so the flow keeps moving and the
  // user can re-ask from Settings, rather than hanging on «جارٍ التفعيل...».
  try {
    return (await settleWithin(hasNotificationPermission(), NOTIFICATION_PERMISSION_TIMEOUT_MS)) ?? false;
  } catch {
    return false;
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return 'Notification' in window && Notification.permission === 'granted';
  }
  const perm = await LocalNotifications.checkPermissions();
  return perm.display === 'granted';
}

/**
 * Whether Android will honour *exact* alarms — the thing that makes the adhan sound at
 * the prayer minute while the app is closed.
 *
 * Declaring `SCHEDULE_EXACT_ALARM` is not enough: the user can revoke it per app, and
 * without it the notification plugin quietly downgrades every prayer alarm to an
 * inexact one (fires in Doze on its own schedule) — and, worse for our resume
 * handler, its `schedule()` pops the system «Alarms & reminders» screen the moment it
 * notices. Checking first lets the scheduler leave a working queue untouched and tell
 * the user instead.
 *
 * Below Android 12, or on plugin builds that do not expose the check, scheduling is
 * always allowed.
 */
interface ExactAlarmPlugin {
  checkExactNotificationSetting?: () => Promise<{ exact_alarm?: string }>;
  changeExactNotificationSetting?: () => Promise<{ exact_alarm?: string }>;
}

export async function canScheduleExactAlarms(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const plugin = LocalNotifications as unknown as ExactAlarmPlugin;
  if (!plugin.checkExactNotificationSetting) return true;
  try {
    const result = await plugin.checkExactNotificationSetting();
    return result.exact_alarm !== 'denied';
  } catch {
    // Unknown plugin build: let scheduling proceed and keep the old behaviour.
    return true;
  }
}

/** Opens the system «Alarms & reminders» page for this app; resolves with the new state. */
export async function requestExactAlarms(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  const plugin = LocalNotifications as unknown as ExactAlarmPlugin;
  if (!plugin.changeExactNotificationSetting || !plugin.checkExactNotificationSetting) return true;
  try {
    await plugin.changeExactNotificationSetting();
    const result = await plugin.checkExactNotificationSetting();
    return result.exact_alarm !== 'denied';
  } catch {
    return false;
  }
}

export type NotificationWarning =
  /** Exact alarms revoked: prayer alarms cannot be re-armed right now. */
  | 'exact-alarm-denied'
  /** Prayer channels could not be prepared; the existing alarm queue was left intact. */
  | 'channel-failed'
  /** The queue was rebuilt successfully after a prior warning. */
  | 'schedule-ready'
  /** The platform scheduled the queue inexact (late firing in sleep mode). */
  | 'scheduled-inexact'
  /** Rebuild failed and the previous queue was restored. */
  | 'schedule-failed';

export const NOTIFICATION_WARNING_EVENT = 'zad:notification-warning';

/** Surfaces a scheduling problem to any mounted screen (Settings shows the actionable ones). */
export function notifyNotificationWarning(type: NotificationWarning): void {
  try {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_WARNING_EVENT, { detail: type }));
  } catch {
    // No window (non-DOM context): the console line next to the call is enough.
  }
}

/**
 * Cancel every pending notification except those the predicate keeps.
 *
 * Without a predicate this is the rebuild's first step; with it, durable one-offs
 * (active snoozes) survive the rebuild that would otherwise delete them.
 */
export async function cancelAllNotifications(
  preserve?: (notification: LocalNotificationSchema) => boolean,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const pending = await LocalNotifications.getPending();
  const cancel = preserve
    ? pending.notifications.filter((notification) => !preserve(notification))
    : pending.notifications;
  if (cancel.length > 0) {
    await LocalNotifications.cancel({
      notifications: cancel.map((notification) => ({ id: notification.id })),
    });
  }
}

export async function cancelNotification(id: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id }] });
}
