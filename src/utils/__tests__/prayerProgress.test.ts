import { prayerProgressFraction, type ProgressPrayer } from '@/utils/prayerProgress';

/**
 * The bar under the countdown reports how far the day has travelled from the previous
 * prayer to the next one, and it used to park at 100%.
 *
 * The old window took its start from the array's neighbour to the left of the next
 * prayer. That is right in the middle of the day and wrong at 03:00: the next prayer is
 * الظهر and the entry to its left is *today's* العشاء, which has not happened yet. The
 * elapsed figure was then measured from an instant in the future; adding a whole day to
 * fix its sign put it on a different timeline from the total, and the ratio came out at
 * or past 100% — where the screen's own «has it changed» guard held it, since a clamped
 * 100 is a fixed point. Nothing moved again until the schedule rolled over.
 *
 * The fix builds the window from the clock: every prayer is shifted to the occurrence
 * nearest the reader, and the previous prayer is the last one that has already passed.
 *
 * These cases pin that: the overnight window, the reset after a prayer passes, and the
 * refusal to ever report a value outside the window.
 */

/** A fixed Cairo day, so the arithmetic is read in plain local hours. */
const DAY = new Date(2026, 0, 15, 0, 0, 0, 0);
const at = (hours: number, minutes = 0): Date =>
  new Date(2026, 0, 15, hours, minutes, 0, 0);
const PRAYERS: ProgressPrayer[] = [
  { name: 'fajr', time: at(5, 5) },
  { name: 'dhuhr', time: at(12, 40) },
  { name: 'asr', time: at(15, 55) },
  { name: 'maghrib', time: at(18, 45) },
  { name: 'isha', time: at(19, 15) },
];

const percent = (now: Date, nextName = 'dhuhr'): number =>
  Math.round(prayerProgressFraction(PRAYERS, PRAYERS.find((p) => p.name === nextName), now) * 100);

describe('prayerProgressFraction', () => {
  it('measures the small hours from the previous night, not from a prayer still to come', () => {
    // The case that used to read 100: 03:00, next prayer الظهر at 12:40, and the
    // window really opened at last night's العشاء (19:15 the day before).
    const fraction = prayerProgressFraction(
      PRAYERS,
      PRAYERS.find((p) => p.name === 'dhuhr'),
      at(3, 0),
    );

    // 19:15 → 12:40 is 17h25m; 19:15 → 03:00 is 7h45m. Just under half.
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.5);
  });

  it('advances across the whole overnight gap and never parks at 100', () => {
    // Through the small hours the next prayer is الظهر, and the window runs from last
    // night's العشاء: the value climbs towards it the whole way.
    const overnight = [0, 2, 4].map((h) => percent(at(h), 'dhuhr'));
    for (const value of overnight) {
      expect(value).toBeLessThan(100);
    }
    for (let i = 1; i < overnight.length; i += 1) {
      expect(overnight[i]).toBeGreaterThan(overnight[i - 1]);
    }

    // Once الفجر passes the window restarts from it, so the value drops — it does not
    // stay clamped at the top. From there it climbs again towards الظهر.
    const afterFajr = [6, 8, 10, 12].map((h) => percent(at(h), 'dhuhr'));
    expect(afterFajr[0]).toBeLessThan(overnight[overnight.length - 1]);
    for (let i = 1; i < afterFajr.length; i += 1) {
      expect(afterFajr[i]).toBeGreaterThan(afterFajr[i - 1]);
    }
    for (const value of afterFajr) {
      expect(value).toBeLessThan(100);
    }
  });

  it('drops back to a small number once the next prayer passes', () => {
    const beforeDhuhr = percent(at(12, 30), 'dhuhr');
    const afterDhuhr = percent(at(12, 50), 'asr');
    expect(beforeDhuhr).toBeGreaterThan(90);
    expect(afterDhuhr).toBeLessThan(10);
  });

  it('carries the overnight window past midnight into the following day', () => {
    // 20:00, next prayer الفجر tomorrow: the previous prayer is tonight's العشاء.
    const fraction = prayerProgressFraction(
      PRAYERS,
      PRAYERS.find((p) => p.name === 'fajr'),
      at(20, 0),
    );
    // 19:15 → 05:05 is 9h50m; 19:15 → 20:00 is 45m.
    expect(fraction).toBeGreaterThan(0.05);
    expect(fraction).toBeLessThan(0.15);
  });

  it('returns zero for a schedule or a next prayer it cannot match', () => {
    const dhuhr = PRAYERS.find((p) => p.name === 'dhuhr');
    expect(prayerProgressFraction(null, dhuhr, at(9, 0))).toBe(0);
    expect(prayerProgressFraction([], dhuhr, at(9, 0))).toBe(0);
    expect(prayerProgressFraction(PRAYERS, null, at(9, 0))).toBe(0);
    expect(prayerProgressFraction(PRAYERS, { name: 'tahajjud', time: at(2, 0) }, at(9, 0))).toBe(0);
  });

  it('stays inside the window at every hour of the day', () => {
    const names = PRAYERS.map((p) => p.name);
    for (let minutes = 0; minutes < 24 * 60; minutes += 7) {
      const now = new Date(DAY.getTime() + minutes * 60_000);
      for (const name of names) {
        const fraction = prayerProgressFraction(PRAYERS, PRAYERS.find((p) => p.name === name), now);
        expect(fraction).toBeGreaterThanOrEqual(0);
        expect(fraction).toBeLessThanOrEqual(1);
      }
    }
  });
});
