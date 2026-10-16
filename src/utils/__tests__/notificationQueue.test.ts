import { describe, it, expect } from '@jest/globals';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { assembleNotificationQueue, dhikrFillerBudget, type NotificationQueueParts } from '@/utils/notificationQueue';

/** The smallest object the assembler cares about: identity, for asserting order. */
const n = (id: number): LocalNotificationSchema =>
  ({ id, title: `#${id}`, body: '', schedule: { at: new Date(id) }, channelId: 'c' }) as LocalNotificationSchema;

const ids = (list: LocalNotificationSchema[]) => list.map((item) => item.id);

const emptyParts = {
  prayerFallbacks: [],
  taskReminders: [],
  hadithReminders: [],
  iqamahAlerts: [],
  prePrayerReminders: [],
  dhikrFiller: [],
};

describe('assembleNotificationQueue', () => {
  it('concatenates the buckets in documented priority order', () => {
    const scheduled = assembleNotificationQueue(
      {
        prayerFallbacks: [n(1)],
        taskReminders: [n(2)],
        hadithReminders: [n(3)],
        iqamahAlerts: [n(4)],
        prePrayerReminders: [n(5)],
        dhikrFiller: [n(6)],
      },
      50,
    );
    // The iqamah sits after the day's own business (tasks, hadith) but ahead of
    // the advisory pre-prayer reminders: it is when the prayer actually starts.
    expect(ids(scheduled)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('leaves a queue already under the cap untouched', () => {
    const scheduled = assembleNotificationQueue(
      {
        ...emptyParts,
        taskReminders: [n(11), n(12)],
        hadithReminders: [n(13)],
      },
      50,
    );
    expect(ids(scheduled)).toEqual([11, 12, 13]);
  });

  it('returns nothing when the cap is zero or negative', () => {
    expect(assembleNotificationQueue({ ...emptyParts, dhikrFiller: [n(1)] }, 0)).toEqual([]);
    expect(assembleNotificationQueue({ ...emptyParts, dhikrFiller: [n(1)] }, -5)).toEqual([]);
  });

  /**
   * The default configuration overflows on its own: `prePrayerReminder` defaults
   * to 10 minutes, so seven days of pre-prayer reminders behind seven days of
   * prayer fallbacks is ~70 entries before a single task — and the iqamah alerts
   * now claim seven days of their own on top. The scheduler used to cap only the
   * filler and append the fallbacks afterwards, so Android's store dropped the
   * tail — the fallbacks — on the very path where the full-screen takeover had
   * already failed and they were the only adhan left.
   */
  it('holds the ceiling on an overflowing day and never drops the adhan', () => {
    const prayerFallbacks = Array.from({ length: 35 }, (_, i) => n(1000 + i));
    const taskReminders = [n(2001), n(2002), n(2003)];
    const hadithReminders = [n(3001)];
    const iqamahAlerts = Array.from({ length: 35 }, (_, i) => n(6000 + i));
    const prePrayerReminders = Array.from({ length: 35 }, (_, i) => n(4000 + i));
    const dhikrFiller = Array.from({ length: 20 }, (_, i) => n(5000 + i));

    const scheduled = assembleNotificationQueue(
      { prayerFallbacks, taskReminders, hadithReminders, iqamahAlerts, prePrayerReminders, dhikrFiller },
      50,
    );

    // The ceiling holds.
    expect(scheduled).toHaveLength(50);
    // Every fallback — the adhan — is ahead of the trim.
    expect(ids(scheduled).slice(0, 35)).toEqual(ids(prayerFallbacks));
    // Today's tasks and the hadith outrank both the iqamah alerts and the filler.
    expect(ids(scheduled)).toEqual(expect.arrayContaining([2001, 2002, 2003, 3001]));
    // The next slot up for the iqamah is what pays: it keeps its soonest entries.
    expect(ids(scheduled).slice(39, 50)).toEqual(ids(iqamahAlerts.slice(0, 11)));
    // The advisory reminders and the filler are what the overflow eats first.
    expect(ids(scheduled)).not.toEqual(expect.arrayContaining(ids(dhikrFiller)));
    expect(ids(scheduled)).not.toEqual(expect.arrayContaining(ids(prePrayerReminders)));
  });

  /**
   * The everyday case: the takeover succeeded (no fallbacks armed), and the seven
   * days of iqamah alerts still fit inside the ceiling together with the day's
   * business — so it is only the far-future pre-prayer reminders that shrink.
   */
  it('keeps every iqamah alert on a normal day, trimming the advisory reminders first', () => {
    const taskReminders = [n(2001), n(2002)];
    const hadithReminders = [n(3001)];
    const iqamahAlerts = Array.from({ length: 35 }, (_, i) => n(6000 + i));
    const prePrayerReminders = Array.from({ length: 35 }, (_, i) => n(4000 + i));
    const dhikrFiller = Array.from({ length: 12 }, (_, i) => n(5000 + i));

    const scheduled = assembleNotificationQueue(
      { ...emptyParts, taskReminders, hadithReminders, iqamahAlerts, prePrayerReminders, dhikrFiller },
      50,
    );

    expect(scheduled).toHaveLength(50);
    // The جماعة alerts the reader explicitly asked for are never the casualties.
    expect(ids(scheduled)).toEqual(expect.arrayContaining(ids(iqamahAlerts)));
    // 2 tasks + 1 hadith + 35 iqamah = 38; the ceiling grants the reminders 12.
    const reminderIds = ids(scheduled).filter((id) => id >= 4000 && id < 5000);
    expect(reminderIds).toEqual(ids(prePrayerReminders.slice(0, 12)));
    // Filler and old reminders pay, as documented.
    expect(ids(scheduled)).not.toEqual(expect.arrayContaining(ids(dhikrFiller)));
  });

  it('truncates each bucket from its tail, keeping the soonest entries', () => {
    const prePrayerReminders = Array.from({ length: 35 }, (_, i) => n(4000 + i));
    const scheduled = assembleNotificationQueue(
      { ...emptyParts, prePrayerReminders },
      10,
    );
    // Generated soonest-first, so the head that survives is today's, not day six's.
    expect(ids(scheduled)).toEqual(ids(prePrayerReminders.slice(0, 10)));
  });

  it('keeps the queue whole when the takeover succeeded and no fallbacks are armed', () => {
    const taskReminders = [n(2001)];
    const hadithReminders = [n(3001)];
    const scheduled = assembleNotificationQueue(
      { ...emptyParts, taskReminders, hadithReminders },
      50,
    );
    expect(ids(scheduled)).toEqual([2001, 3001]);
  });
});

describe('dhikrFillerBudget', () => {
  /** The four buckets that are armed whether or not the takeover succeeds. */
  const certainlyArmed = (
    parts: Partial<Omit<NotificationQueueParts, 'prayerFallbacks' | 'dhikrFiller'>> = {},
  ): Omit<NotificationQueueParts, 'prayerFallbacks' | 'dhikrFiller'> => ({
    taskReminders: [],
    hadithReminders: [],
    iqamahAlerts: [],
    prePrayerReminders: [],
    ...parts,
  });

  const many = (from: number, length: number) =>
    Array.from({ length }, (_, i) => n(from + i));

  it('hands the whole ceiling to the filler when nothing else is armed', () => {
    expect(dhikrFillerBudget(certainlyArmed(), 50)).toBe(50);
  });

  /**
   * The regression this budget exists to prevent. Reserving the 35 prayer
   * fallbacks — which are armed *only* when the native takeover has failed — on
   * top of assembly ranking them first left a normal day with
   * `50 - 35 - 35 - 3 - 1 < 0`, so the random dhikr reminders were never
   * generated at all. They are not subtracted any more, and the parameter list
   * no longer admits them.
   */
  it('reserves nothing for the prayer fallbacks, which assembly ranks when they arrive', () => {
    const budget = dhikrFillerBudget(
      certainlyArmed({
        iqamahAlerts: many(6000, 35),
        taskReminders: [n(2001)],
        hadithReminders: [n(3001)],
      }),
      50,
    );
    // 50 - 35 iqamah - 1 task - 1 hadith. The fallbacks' 35 are absent.
    expect(budget).toBe(13);
    // What the old arithmetic returned for this same day, and why it was zero.
    expect(50 - 35 - 35 - 1 - 1).toBeLessThan(0);
  });

  it('yields nothing once the certainly armed buckets already fill the ceiling', () => {
    // Seven days of pre-prayer reminders behind seven days of iqamah alerts is
    // 70 entries against a ceiling of 50 — there is genuinely no room, and the
    // filler is the bucket the priority order spends last.
    const budget = dhikrFillerBudget(
      certainlyArmed({
        prePrayerReminders: many(4000, 35),
        iqamahAlerts: many(6000, 35),
        taskReminders: [n(2001), n(2002)],
        hadithReminders: [n(3001)],
      }),
      50,
    );
    expect(budget).toBe(0);
  });

  it('never hands out a negative or non-finite share', () => {
    expect(dhikrFillerBudget(certainlyArmed({ iqamahAlerts: many(6000, 60) }), 50)).toBe(0);
    expect(dhikrFillerBudget(certainlyArmed(), 0)).toBe(0);
    expect(dhikrFillerBudget(certainlyArmed(), -5)).toBe(0);
    expect(dhikrFillerBudget(certainlyArmed(), Number.NaN)).toBe(0);
  });

  /**
   * The whole point of the split: a day where the takeover *did* fail, with the
   * full fallback share arriving at assembly. The filler that the budget funded
   * is exactly what gives way — the adhan keeps every slot it claims.
   */
  it('lets assembly spend the filler rather than the adhan when the takeover failed', () => {
    const prayerFallbacks = many(1000, 35);
    const iqamahAlerts = many(6000, 35);
    const taskReminders = [n(2001)];
    const hadithReminders = [n(3001)];
    const budget = dhikrFillerBudget(
      certainlyArmed({ iqamahAlerts, taskReminders, hadithReminders }),
      50,
    );
    const dhikrFiller = many(5000, budget);

    const scheduled = assembleNotificationQueue(
      { prayerFallbacks, iqamahAlerts, taskReminders, hadithReminders, prePrayerReminders: [], dhikrFiller },
      50,
    );

    expect(scheduled).toHaveLength(50);
    expect(ids(scheduled).slice(0, 35)).toEqual(ids(prayerFallbacks));
    expect(ids(scheduled)).not.toEqual(expect.arrayContaining(ids(dhikrFiller)));
  });
});
