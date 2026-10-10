import { describe, it, expect } from '@jest/globals';
import {
  canEditPrayerDate,
  assertPrayerRecordable,
  sunnahDoneMap,
  summariseGrid,
  FIVE_PRAYERS,
  type DayPrayerGrid,
  type PrayerStatus,
} from '@/utils/prayerTracker';
import { formatDateKey, addDays } from '@/utils/dateUtils';

/**
 * Phase 0/2's prayer-record invariants: confirmation is final (no undo, no
 * counter), a slot only opens for today or yesterday, the legacy combined
 * Dhuhr rawatib row reads exactly like its split halves, and the week
 * percentage treats a never-answered past prayer as a miss — silence must not
 * be rewarded.
 */

const now = new Date('2026-03-10T15:00:00');
const today = formatDateKey(now);
const yesterday = formatDateKey(addDays(now, -1));
const twoDaysAgo = formatDateKey(addDays(now, -2));
const tomorrow = formatDateKey(addDays(now, 1));

describe('canEditPrayerDate', () => {
  it('opens today and yesterday only', () => {
    expect(canEditPrayerDate(today, now)).toBe(true);
    expect(canEditPrayerDate(yesterday, now)).toBe(true);
    expect(canEditPrayerDate(twoDaysAgo, now)).toBe(false);
    expect(canEditPrayerDate(tomorrow, now)).toBe(false);
  });
});

describe('assertPrayerRecordable', () => {
  it('records an unanswered prayer of today at once', () => {
    expect(() => assertPrayerRecordable(today, false, now)).not.toThrow();
  });

  it('records an unanswered prayer of yesterday', () => {
    expect(() => assertPrayerRecordable(yesterday, false, now)).not.toThrow();
  });

  it('rejects a prayer that already has a record — confirmation is final, no undo', () => {
    expect(() => assertPrayerRecordable(today, true, now)).toThrow(
      'تم تأكيد هذه الصلاة ولا يمكن تغييرها.',
    );
  });

  it('rejects days outside today and yesterday', () => {
    expect(() => assertPrayerRecordable(twoDaysAgo, false, now)).toThrow(
      'يمكن تسجيل صلاة اليوم أو أمس فقط.',
    );
  });
});

describe('sunnahDoneMap', () => {
  const row = (type: string, done: boolean) => ({ date: today, type, done });

  it('folds the legacy combined Dhuhr rawatib row into its halves', () => {
    const map = sunnahDoneMap([row('rawatib_dhuhr', true)]);
    expect(map.rawatib_dhuhr).toBe(true);
    expect(map.rawatib_dhuhr_before).toBe(true);
    expect(map.rawatib_dhuhr_after).toBe(true);
  });

  it('never overrides explicitly split halves', () => {
    const map = sunnahDoneMap([row('rawatib_dhuhr', true), row('rawatib_dhuhr_before', false)]);
    expect(map.rawatib_dhuhr_before).toBe(false);
    expect(map.rawatib_dhuhr_after).toBe(true);
  });

  it('passes other rows through untouched', () => {
    const map = sunnahDoneMap([row('witr', true), row('duha', false)]);
    expect(map).toEqual({ witr: true, duha: false });
  });
});

function makeDay(status: Record<string, PrayerStatus | null>, due: Record<string, boolean>): DayPrayerGrid {
  return {
    date: '2026-03-09',
    dayName: 'الاثنين',
    dayNumber: '٩',
    isToday: false,
    isPast: true,
    due: due as DayPrayerGrid['due'],
    status: status as DayPrayerGrid['status'],
    sunnah: { fajr: [], dhuhr: [], asr: [], maghrib: [], isha: [] },
  };
}

const allDue = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };
const noneDue = { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false };

describe('summariseGrid', () => {
  it('counts answered prayers and percentages over what was actually due', () => {
    const stats = summariseGrid([
      makeDay({ fajr: 'ontime', dhuhr: 'ontime', asr: 'late', maghrib: 'missed', isha: null }, allDue),
    ]);
    expect(stats.total).toBe(5);
    expect(stats.ontime).toBe(2);
    expect(stats.late).toBe(1);
    expect(stats.missed).toBe(1);
    expect(stats.unconfirmed).toBe(1);
    expect(stats.percentage).toBe(60); // (2 + 1) / 5
  });

  it('treats an unanswered past prayer as a miss — silence is not rewarded', () => {
    const stats = summariseGrid([
      makeDay({ fajr: null, dhuhr: null, asr: null, maghrib: null, isha: null }, allDue),
    ]);
    expect(stats.total).toBe(5);
    expect(stats.unconfirmed).toBe(5);
    expect(stats.percentage).toBe(0);
  });

  it('does not count prayers whose time had not arrived', () => {
    const stats = summariseGrid([
      makeDay({ fajr: 'ontime', dhuhr: null, asr: null, maghrib: null, isha: null }, { ...noneDue, fajr: true }),
    ]);
    expect(stats.total).toBe(1);
    expect(stats.percentage).toBe(100);
  });

  it('is zero for an empty week', () => {
    const stats = summariseGrid([]);
    expect(stats.total).toBe(0);
    expect(stats.percentage).toBe(0);
  });

  it('knows exactly five obligatory prayers', () => {
    expect([...FIVE_PRAYERS]).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
  });
});
