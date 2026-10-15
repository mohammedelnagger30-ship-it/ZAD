import type { LocalNotificationSchema } from '@capacitor/local-notifications';

/**
 * The day's notifications, assembled in priority order and capped in one step.
 *
 * Android's notification store silently drops the tail of a batch this size, so
 * the scheduler keeps a hard ceiling (`MAX_SCHEDULED_NOTIFICATIONS`). The ceiling
 * only means something if the *assembly* enforces it: the scheduler used to apply
 * it solely to the dhikr filler, so a day where the adhan's sound fallback had to
 * take over reached ~70 entries — seven days of fallbacks behind seven days of
 * pre-prayer reminders, with the cap already exhausted — and the store dropped the
 * tail. The tail was exactly the fallbacks, pushed last, which is the one set that
 * must never go: they are the adhan, on the very path where the full-screen
 * takeover already failed.
 *
 * Order is priority, highest first — matching what the scheduler documents:
 *
 *  1. prayer fallbacks — the adhan itself, armed only when the native full-screen
 *     path failed;
 *  2. today's task reminders (hifz / review);
 *  3. the hadith of the day;
 *  4. iqamah alerts (الإقامة) — the جماعة's minute, ahead of the purely advisory
 *     pre-prayer reminders because it is when the prayer actually starts;
 *  5. pre-prayer reminders, soonest first as generated;
 *  6. the dhikr filler.
 *
 * Trimming therefore eats the filler first, then the far-future pre-prayer
 * reminders, then — only under heavier overflow — later iqamah alerts, and never
 * reaches the adhan or today's tasks. Each bucket's own order is preserved, so
 * what survives of any bucket is its soonest entries.
 */
export interface NotificationQueueParts {
  /** Armed only when `scheduleAdhanOverlay` failed; empty otherwise. */
  prayerFallbacks: LocalNotificationSchema[];
  taskReminders: LocalNotificationSchema[];
  hadithReminders: LocalNotificationSchema[];
  iqamahAlerts: LocalNotificationSchema[];
  prePrayerReminders: LocalNotificationSchema[];
  dhikrFiller: LocalNotificationSchema[];
}

/**
 * Concatenates the buckets in priority order and truncates to `max`.
 *
 * Pure: no ids are touched (they are allocated by the scheduler and are unique
 * across buckets), so truncation can never collide two notifications.
 */
export function assembleNotificationQueue(
  parts: NotificationQueueParts,
  max: number,
): LocalNotificationSchema[] {
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return [
    ...parts.prayerFallbacks,
    ...parts.taskReminders,
    ...parts.hadithReminders,
    ...parts.iqamahAlerts,
    ...parts.prePrayerReminders,
    ...parts.dhikrFiller,
  ].slice(0, limit);
}
