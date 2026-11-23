import type { LocalNotificationSchema } from '@capacitor/local-notifications';

/**
 * The day's notifications, assembled in priority order and capped in one step.
 *
 * The scheduler keeps a hard ceiling (`MAX_SCHEDULED_NOTIFICATIONS`), which exists to
 * keep the native batch — one preferences row, one `AlarmManager` transaction, and the
 * copy restored after a reboot — modest. The ceiling only means something if the
 * *assembly* enforces it: the scheduler used to apply it solely to the dhikr filler,
 * so a day where the adhan's sound fallback had to take over reached ~70 entries —
 * seven days of fallbacks behind seven days of pre-prayer reminders, with the cap
 * already exhausted — and everything past the ceiling was simply not scheduled. The
 * tail was exactly the fallbacks, pushed last, which is the one set that must never go:
 * they are the adhan, on the very path where the full-screen takeover already failed.
 *
 * Order is priority, highest first — matching what the scheduler documents:
 *
 *  1. prayer fallbacks — the adhan itself, armed only when the native full-screen
 *     path failed;
 *  2. today's task reminders (hifz / review);
 *  3. today's content — the hadith of the day, the Qur'an message, the Sunnahs about
 *     the Prophet ﷺ, the facts and miracles about him;
 *  4. iqamah alerts (الإقامة) — the جماعة's minute, ahead of the purely advisory
 *     pre-prayer reminders because it is when the prayer actually starts. Like the
 *     adhan, the جماعة is armed as a native takeover first; these join the queue
 *     only when that arming failed;
 *  5. spaced-repetition review alerts, soonest first;
 *  6. pre-prayer reminders, soonest first as generated;
 *  7. the *future days'* content, farthest day last — kept for the day-after-tomorrow
 *     that would otherwise go silent when the app stays closed, but the first thing
 *     to give up, because everything ranked above it is about a prayer or a day the
 *     user is actually living through;
 *  8. the Friday adhkar — five cards on the day itself, and the reason a queue built
 *     on a Tuesday still carries something for يوم الجمعة;
 *  9. the dhikr filler.
 *
 * Trimming therefore eats the filler first, then the Friday cards, then the farthest
 * content day, then the far-future pre-prayer reminders, then spaced reviews, then —
 * only under heavier overflow — later iqamah alerts, and never reaches the adhan or
 * today's tasks. Each bucket's own order is preserved, so what survives of any bucket
 * is its soonest entries.
 */
export interface NotificationQueueParts {
  /** Armed only when `scheduleAdhanOverlay` failed; empty otherwise. */
  prayerFallbacks: LocalNotificationSchema[];
  taskReminders: LocalNotificationSchema[];
  /**
   * Today's nafl windows — الضحى، الوتر، الثلث الأخير. Ranked with the tasks, ahead
   * of the content: they are tied to a prayer's own minute, so they are the second
   * thing to be kept after the ورد.
   */
  naflReminders?: LocalNotificationSchema[];
  hadithReminders: LocalNotificationSchema[];
  /**
   * The جماعة's own cards — the shorter daily-alert window only, and kept solely for
   * the same failed-takeover case as {@link prayerFallbacks} (the takeover owns every
   * iqamah otherwise, so the two always travel together).
   */
  iqamahAlerts: LocalNotificationSchema[];
  hifzReviewReminders: LocalNotificationSchema[];
  prePrayerReminders: LocalNotificationSchema[];
  /** The same content as {@link hadithReminders}, for the days still to come. */
  futureContentReminders?: LocalNotificationSchema[];
  /**
   * The Friday adhkar — its own cards, armed for every Friday inside the window. Ranked
   * ahead of the filler (a Friday the reader is actually living through outranks a
   * random reminder) and behind everything about a prayer or the day's ورد.
   */
  fridayReminders?: LocalNotificationSchema[];
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
    ...(parts.naflReminders ?? []),
    ...parts.hadithReminders,
    ...parts.iqamahAlerts,
    ...parts.hifzReviewReminders,
    ...parts.prePrayerReminders,
    ...(parts.futureContentReminders ?? []),
    ...(parts.fridayReminders ?? []),
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
 * assembly — reserving their share a second time, here, held most of the ceiling's
 * slots for nobody on an ordinary day, so this returned zero and the random dhikr
 * reminders were never generated at all.
 *
 * The buckets that *are* passed still get subtracted, but as an economy rather
 * than a rule: assembly would discard that filler anyway, so generating it
 * would be work thrown away.
 */
export function dhikrFillerBudget(
  certainlyArmed: {
    taskReminders: LocalNotificationSchema[];
    naflReminders?: LocalNotificationSchema[];
    hadithReminders: LocalNotificationSchema[];
    iqamahAlerts: LocalNotificationSchema[];
    hifzReviewReminders: LocalNotificationSchema[];
    prePrayerReminders: LocalNotificationSchema[];
    /** Optional: the future days' content, which assembly trims before the filler. */
    futureContentReminders?: LocalNotificationSchema[];
    /** Optional: the Friday adhkar, which assembly trims after the filler's betters. */
    fridayReminders?: LocalNotificationSchema[];
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
      - (certainlyArmed.naflReminders?.length ?? 0)
      - (certainlyArmed.futureContentReminders?.length ?? 0)
      - (certainlyArmed.fridayReminders?.length ?? 0)
      - certainlyArmed.hadithReminders.length,
  );
}
