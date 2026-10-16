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
 *  5. spaced-repetition review alerts, soonest first;
 *  6. pre-prayer reminders, soonest first as generated;
 *  7. the dhikr filler.
 *
 * Trimming therefore eats the filler first, then the far-future pre-prayer
 * reminders, then spaced reviews, then — only under heavier overflow — later
 * iqamah alerts, and never reaches the adhan or today's tasks. Each bucket's own
 * order is preserved, so what survives of any bucket is its soonest entries.
 */
export interface NotificationQueueParts {
  /** Armed only when `scheduleAdhanOverlay` failed; empty otherwise. */
  prayerFallbacks: LocalNotificationSchema[];
  taskReminders: LocalNotificationSchema[];
  hadithReminders: LocalNotificationSchema[];
  iqamahAlerts: LocalNotificationSchema[];
  hifzReviewReminders: LocalNotificationSchema[];
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
    ...parts.hifzReviewReminders,
    ...parts.prePrayerReminders,
    ...parts.dhikrFiller,
  ].slice(0, limit);
}

/**
 * How many dhikr filler entries are worth generating, given the ceiling.
 *
 * `prayerFallbacks` is deliberately absent from the reservation, and the type
 * makes that impossible to do by accident. They are the only bucket that is not
 * certainly scheduled: they join the queue solely when the native full-screen
 * takeover has already failed, and `assembleNotificationQueue` then ranks them
 * first and trims the filler to make room. Contention is resolved once, at
 * assembly — reserving their share a second time, here, held 35 of the
 * ceiling's 50 slots for nobody on an ordinary day, so this returned zero and
 * the random dhikr reminders were never generated at all.
 *
 * The buckets that *are* passed still get subtracted, but as an economy rather
 * than a rule: assembly would discard that filler anyway, so generating it
 * would be work thrown away.
 */
export function dhikrFillerBudget(
  certainlyArmed: {
    taskReminders: LocalNotificationSchema[];
    hadithReminders: LocalNotificationSchema[];
    iqamahAlerts: LocalNotificationSchema[];
    hifzReviewReminders: LocalNotificationSchema[];
    prePrayerReminders: LocalNotificationSchema[];
  },
  max: number,
): number {
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  return Math.max(
    0,
    limit
      - certainlyArmed.prePrayerReminders.length
      - certainlyArmed.iqamahAlerts.length
      - certainlyArmed.hifzReviewReminders.length
      - certainlyArmed.taskReminders.length
      - certainlyArmed.hadithReminders.length,
  );
}
