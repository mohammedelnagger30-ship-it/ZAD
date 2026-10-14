import { describe, it, expect } from '@jest/globals';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import { assembleNotificationQueue } from '@/utils/notificationQueue';

/** The smallest object the assembler cares about: identity, for asserting order. */
const n = (id: number): LocalNotificationSchema =>
  ({ id, title: `#${id}`, body: '', schedule: { at: new Date(id) }, channelId: 'c' }) as LocalNotificationSchema;

const ids = (list: LocalNotificationSchema[]) => list.map((item) => item.id);

const emptyParts = {
  prayerFallbacks: [],
  taskReminders: [],
  hadithReminders: [],
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
        prePrayerReminders: [n(4)],
        dhikrFiller: [n(5)],
      },
      50,
    );
    expect(ids(scheduled)).toEqual([1, 2, 3, 4, 5]);
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
   * prayer fallbacks is ~70 entries before a single task. The scheduler used to
   * cap only the filler and append the fallbacks afterwards, so Android's store
   * dropped the tail — the fallbacks — on the very path where the full-screen
   * takeover had already failed and they were the only adhan left.
   */
  it('holds the ceiling on an overflowing day and never drops the adhan', () => {
    const prayerFallbacks = Array.from({ length: 35 }, (_, i) => n(1000 + i));
    const taskReminders = [n(2001), n(2002), n(2003)];
    const hadithReminders = [n(3001)];
    const prePrayerReminders = Array.from({ length: 35 }, (_, i) => n(4000 + i));
    const dhikrFiller = Array.from({ length: 20 }, (_, i) => n(5000 + i));

    const scheduled = assembleNotificationQueue(
      { prayerFallbacks, taskReminders, hadithReminders, prePrayerReminders, dhikrFiller },
      50,
    );

    // The ceiling holds.
    expect(scheduled).toHaveLength(50);
    // Every fallback — the adhan — is ahead of the trim.
    expect(ids(scheduled).slice(0, 35)).toEqual(ids(prayerFallbacks));
    // Today's tasks and the hadith outrank both the reminders and the filler.
    expect(ids(scheduled)).toEqual(expect.arrayContaining([2001, 2002, 2003, 3001]));
    // The filler is what pays for the overflow: not one of it survives.
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
