import { describe, it, expect } from '@jest/globals';
import {
  calculatePrayerTimes,
  calendarDayInZone,
  addCalendarDays,
  getPrayerTimeZone,
  getNextPrayer,
  getTimeUntil,
} from '@/utils/prayerTimes';

/**
 * The invariants Phase 0/2 repaired, pinned as tests: coordinates that are not
 * numbers must never produce Invalid Dates (an NaN time used to reach the adhan
 * window comparisons and fire a silent bogus azan), the high-latitude rule must
 * be explicit, and a zone's calendar day must be read from the zone.
 */

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
