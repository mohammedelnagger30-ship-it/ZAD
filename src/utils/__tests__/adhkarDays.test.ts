/**
 * This history is written by one screen and read by another, in between
 * being restored from a backup and merged with a copy from a device that
 * never heard of it. What it must never do is report a day that did not
 * happen or report one twice — either way a badge counts work that was not
 * done, and nothing on screen would say so.
 */
import { describe, it, expect } from '@jest/globals';
import {
  MAX_COMPLETED_DAYS,
  normalizeCompletedDays,
  recordCompletedDay,
} from '@/utils/adhkarDays';

/** `count` distinct days starting at `from`, one a day, in a form the module accepts. */
function consecutiveDays(count: number, from = new Date(2020, 0, 1)): string[] {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(from);
    date.setDate(from.getDate() + index);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  });
}

describe('normalizeCompletedDays', () => {
  it('rejects anything that is not a list of dates', () => {
    expect(normalizeCompletedDays(undefined)).toEqual([]);
    expect(normalizeCompletedDays(null)).toEqual([]);
    expect(normalizeCompletedDays('2026-01-01')).toEqual([]);
    expect(normalizeCompletedDays({ '2026-01-01': true })).toEqual([]);
    expect(normalizeCompletedDays([null, 7, {}, 'yesterday', ''])).toEqual([]);
    expect(normalizeCompletedDays(['2026-1-01', '2026-01-012'])).toEqual([]);
  });

  it('keeps the days in order, whatever order they arrived in', () => {
    expect(normalizeCompletedDays(['2026-03-02', '2026-01-05', '2026-02-11'])).toEqual([
      '2026-01-05',
      '2026-02-11',
      '2026-03-02',
    ]);
  });

  /** Two devices finishing the same day and meeting in the cloud. */
  it('counts a day once no matter how many copies of it arrive', () => {
    expect(normalizeCompletedDays(['2026-01-05', '2026-01-05', '2026-01-05'])).toEqual([
      '2026-01-05',
    ]);
  });

  it('drops the oldest days once the history is full, never the newest', () => {
    const many = consecutiveDays(MAX_COMPLETED_DAYS + 50);
    // Shuffled, so the test cannot pass by accident of input order.
    const shuffled = [...many].reverse();

    const normalized = normalizeCompletedDays(shuffled);

    expect(normalized).toHaveLength(MAX_COMPLETED_DAYS);
    expect(normalized[0]).toBe(many[50]);
    expect(normalized[normalized.length - 1]).toBe(many[many.length - 1]);
  });
});

describe('recordCompletedDay', () => {
  it('adds the day and keeps the history sorted', () => {
    expect(recordCompletedDay(['2026-01-05'], '2026-01-04')).toEqual([
      '2026-01-04',
      '2026-01-05',
    ]);
  });

  it('returns the very same array when the day is already filed', () => {
    const days = ['2026-01-05'];
    // Identity, not equality: the effect that calls this branches on `===`
    // to know whether anything changed, which is what stops it running
    // again on every render while the day sits at 100%.
    expect(recordCompletedDay(days, '2026-01-05')).toBe(days);
  });

  it('refuses a value that is not a date rather than storing it', () => {
    const days = ['2026-01-05'];
    expect(recordCompletedDay(days, 'today')).toBe(days);
    expect(recordCompletedDay(days, '')).toBe(days);
  });

  it('still bounds a history it did not get to normalize first', () => {
    const many = consecutiveDays(MAX_COMPLETED_DAYS + 10);
    const recorded = recordCompletedDay(many, '2022-01-01');

    expect(recorded).toHaveLength(MAX_COMPLETED_DAYS);
    expect(recorded[recorded.length - 1]).toBe('2022-01-01');
  });
});
