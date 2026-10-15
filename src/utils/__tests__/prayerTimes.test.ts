import { describe, it, expect, jest } from '@jest/globals';
import {
  calculatePrayerTimes,
  calendarDayInZone,
  addCalendarDays,
  getPrayerTimeZone,
  getNextPrayer,
  getTimeUntil,
  getIqamahTime,
  formatTime12h,
  zoneOffsetMs,
  DEFAULT_IQAMAH_OFFSETS,
} from '@/utils/prayerTimes';

/**
 * The invariants Phase 0/2 repaired, pinned as tests: coordinates that are not
 * numbers must never produce Invalid Dates (an NaN time used to reach the adhan
 * window comparisons and fire a silent bogus azan), the high-latitude rule must
 * be explicit, and a zone's calendar day must be read from the zone.
 *
 * The zone tests also pin the engine-independence of the Cairo rules: a phone
 * whose WebView tzdata predates 2023 must still see the official times.
 */

/** Simulate an engine whose ICU throws (or predates the rules we carry). */
function withBrokenPlatformFormatter<T>(run: () => T): T {
  const spy = jest
    .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
    .mockImplementation(() => {
      throw new Error('engine tzdata predates 2023');
    });
  try {
    return run();
  } finally {
    spy.mockRestore();
  }
}

describe('calendarDayInZone', () => {
  it('reads the city day, not the device day', () => {
    const instant = new Date('2026-01-01T23:30:00Z');
    expect(calendarDayInZone(instant, 'Asia/Tokyo')).toEqual({ year: 2026, month: 1, day: 2 });
    expect(calendarDayInZone(instant, 'America/Los_Angeles')).toEqual({ year: 2026, month: 1, day: 1 });
  });

  it('keeps returning the same answer on repeated calls (formatter cache)', () => {
    const instant = new Date('2026-06-15T10:00:00Z');
    const first = calendarDayInZone(instant, 'Africa/Cairo');
    for (let i = 0; i < 5; i++) {
      expect(calendarDayInZone(instant, 'Africa/Cairo')).toEqual(first);
    }
  });

  it('crosses Cairo midnight by the rules, not by the engine', () => {
    // 21:30 UTC during summer time is already the next day in Cairo (+03);
    // a pre-2023 ICU would still read +02 and call it the 15th.
    expect(calendarDayInZone(new Date('2026-10-15T21:30:00Z'), 'Africa/Cairo')).toEqual({
      year: 2026,
      month: 10,
      day: 16,
    });
    expect(calendarDayInZone(new Date('2026-10-15T20:30:00Z'), 'Africa/Cairo')).toEqual({
      year: 2026,
      month: 10,
      day: 15,
    });
    expect(calendarDayInZone(new Date('2026-10-15T21:30:00Z'), 'Africa/Cairo')).toEqual(
      withBrokenPlatformFormatter(() =>
        calendarDayInZone(new Date('2026-10-15T21:30:00Z'), 'Africa/Cairo'),
      ),
    );
  });
});

describe('zoneOffsetMs', () => {
  it('carries Egypt’s summer time itself, engine or no engine', () => {
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-01-15T12:00:00Z'))).toBe(2 * 3_600_000);
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-07-15T12:00:00Z'))).toBe(3 * 3_600_000);
    expect(zoneOffsetMs('Egypt', new Date('2026-07-15T12:00:00Z'))).toBe(3 * 3_600_000);
  });

  it('switches at the exact Egyptian boundaries of 2026', () => {
    // DST begins Fri Apr 24 00:00 EET (= Apr 23 22:00 UTC) and ends
    // Fri Oct 30 00:00 EEST (= Oct 29 21:00 UTC).
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-04-23T21:59:00Z'))).toBe(2 * 3_600_000);
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-04-23T22:00:00Z'))).toBe(3 * 3_600_000);
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-10-29T20:59:00Z'))).toBe(3 * 3_600_000);
    expect(zoneOffsetMs('Africa/Cairo', new Date('2026-10-29T21:00:00Z'))).toBe(2 * 3_600_000);
  });

  it('leaves the years before the restoration to the platform', () => {
    // Egypt had no summer time from 2015 to 2022 — every engine agrees on +02.
    expect(zoneOffsetMs('Africa/Cairo', new Date('2021-07-15T12:00:00Z'))).toBe(2 * 3_600_000);
  });

  it('answers for Cairo even when the platform formatter throws', () => {
    const offsets = withBrokenPlatformFormatter(() => [
      zoneOffsetMs('Africa/Cairo', new Date('2026-10-15T12:00:00Z')),
      zoneOffsetMs('Africa/Cairo', new Date('2026-01-15T12:00:00Z')),
    ]);
    expect(offsets).toEqual([3 * 3_600_000, 2 * 3_600_000]);
  });

  it('still follows the platform for zones the bundle does not carry', () => {
    expect(zoneOffsetMs('Asia/Riyadh', new Date('2026-10-15T12:00:00Z'))).toBe(3 * 3_600_000);
    expect(zoneOffsetMs('UTC', new Date('2026-10-15T12:00:00Z'))).toBe(0);
  });
});

describe('formatTime12h', () => {
  const isha = new Date('2026-10-15T16:42:00Z'); // tonight's isha instant

  it('renders the official Cairo wall time whatever the engine knows', () => {
    expect(formatTime12h(isha, 'Africa/Cairo')).toBe('7:42 م'); // summer time: +03
    expect(formatTime12h(new Date('2026-01-15T10:00:00Z'), 'Africa/Cairo')).toBe('12:00 م');
    expect(formatTime12h(new Date('2026-01-15T02:30:00Z'), 'Africa/Cairo')).toBe('4:30 ص');
  });

  it('survives a platform formatter that throws', () => {
    expect(withBrokenPlatformFormatter(() => formatTime12h(isha, 'Africa/Cairo'))).toBe('7:42 م');
  });

  it('still follows the platform for zones the bundle does not carry', () => {
    expect(formatTime12h(isha, 'Asia/Riyadh')).toBe('7:42 م'); // fixed +03
    expect(formatTime12h(isha, 'Asia/Dubai')).toBe('8:42 م'); // fixed +04
    expect(formatTime12h(isha, 'UTC')).toBe('4:42 م');
  });
});

describe('addCalendarDays', () => {
  it('normalises overflow into the next month and year', () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({ year: 2026, month: 2, day: 1 });
    expect(addCalendarDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addCalendarDays({ year: 2026, month: 3, day: 1 }, -1)).toEqual({ year: 2026, month: 2, day: 28 });
  });
});

describe('calculatePrayerTimes', () => {
  const day = new Date('2026-03-15T12:00:00Z');

  it('returns finite prayers in chronological order for Cairo', () => {
    const result = calculatePrayerTimes(30.0444, 31.2357, day, 'MWL', 'standard', 'Africa/Cairo');
    expect(result.prayers.length).toBeGreaterThanOrEqual(5);
    const times = result.prayers.map((p) => p.time.getTime());
    for (const t of times) expect(Number.isFinite(t)).toBe(true);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('falls back to finite times when coordinates are not numbers', () => {
    const result = calculatePrayerTimes(NaN, NaN, day, 'MWL', 'standard', 'Africa/Cairo');
    expect(result.prayers.length).toBeGreaterThan(0);
    for (const p of result.prayers) {
      expect(Number.isFinite(p.time.getTime())).toBe(true);
    }
  });

  it('stays finite at polar latitude under the explicit middle-of-the-night rule', () => {
    const result = calculatePrayerTimes(
      78.2232,
      15.6469,
      new Date('2026-06-21T12:00:00Z'),
      'MWL',
      'standard',
      'Arctic/Longyearbyen',
    );
    for (const p of result.prayers) {
      expect(Number.isFinite(p.time.getTime())).toBe(true);
    }
  });
});

describe('getNextPrayer', () => {
  it('always resolves to a real prayer that is not the sunrise marker', () => {
    // No `now` is injectable here, so the assertions hold whatever the clock says:
    // after the last prayer of the day it must roll to tomorrow's Fajr, never null.
    const next = getNextPrayer(30.0444, 31.2357, 'MWL', 'standard', 'Africa/Cairo');
    expect(next).not.toBeNull();
    expect(next!.name).not.toBe('sunrise');
    expect(Number.isFinite(next!.time.getTime())).toBe(true);
  });
});

describe('getPrayerTimeZone', () => {
  it('prefers a valid stored zone', () => {
    expect(getPrayerTimeZone('Asia/Tokyo', 'Cairo')).toBe('Asia/Tokyo');
  });

  it('falls back to the preset city zone when the stored zone is invalid', () => {
    expect(getPrayerTimeZone('not/a/zone', 'إسطنبول')).toBe('Europe/Istanbul');
  });

  it('falls back to the device zone when nothing else resolves', () => {
    expect(getPrayerTimeZone('not/a/zone', 'No Such City')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });
});

describe('getTimeUntil', () => {
  it('counts down to a future time from an injected clock', () => {
    const target = new Date('2026-03-15T12:30:00');
    const now = new Date('2026-03-15T12:00:00');
    // 'بعد ٣٠ دقيقة' at minute range, 'خلال …' once the last minute is entered.
    expect(getTimeUntil(target, now)).toMatch(/^(بعد|خلال) /);
  });
});

describe('getIqamahTime', () => {
  const adhan = new Date('2026-03-15T12:00:00Z');

  it('falls back per prayer to the defaults when nothing is saved', () => {
    expect(getIqamahTime(adhan, 'fajr').getTime()).toBe(adhan.getTime() + 20 * 60_000);
    expect(getIqamahTime(adhan, 'maghrib').getTime()).toBe(adhan.getTime() + 5 * 60_000);
    expect(getIqamahTime(adhan, 'dhuhr').getTime()).toBe(adhan.getTime() + 10 * 60_000);
    expect(getIqamahTime(adhan, 'isha').getTime()).toBe(adhan.getTime() + 10 * 60_000);
    expect(getIqamahTime(adhan, 'asr').getTime()).toBe(adhan.getTime() + 10 * 60_000);
  });

  it('honours a saved row per key, tolerating a partial one', () => {
    // A partially saved offsets row (or a pre-iqamah install merging in) must
    // still give every prayer its minute — keys missing fall back individually.
    expect(getIqamahTime(adhan, 'dhuhr', { dhuhr: 15 }).getTime()).toBe(adhan.getTime() + 15 * 60_000);
    expect(getIqamahTime(adhan, 'fajr', { dhuhr: 15 }).getTime()).toBe(adhan.getTime() + 20 * 60_000);
    expect(getIqamahTime(adhan, 'fajr', null).getTime()).toBe(adhan.getTime() + 20 * 60_000);
  });

  it('clamps a bad stored minute into a schedulable range', () => {
    // Past two hours is a typo, not a جماعة — and negatives never move behind
    // the adhan itself.
    expect(getIqamahTime(adhan, 'fajr', { fajr: 900 }).getTime()).toBe(adhan.getTime() + 120 * 60_000);
    expect(getIqamahTime(adhan, 'fajr', { fajr: -30 }).getTime()).toBe(adhan.getTime());
    expect(getIqamahTime(adhan, 'fajr', { fajr: Number.NaN }).getTime()).toBe(
      adhan.getTime() + DEFAULT_IQAMAH_OFFSETS.fajr * 60_000,
    );
    // Fractional saves truncate rather than drift.
    expect(getIqamahTime(adhan, 'asr', { asr: 7.8 }).getTime()).toBe(adhan.getTime() + 7 * 60_000);
  });
});
