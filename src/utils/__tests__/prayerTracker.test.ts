import { describe, it, expect } from '@jest/globals';
import {
  canEditPrayerDate,
  assertPrayerRecordable,
  sunnahDoneMap,
  summariseGrid,
  computeRecordingWindows,
  isWindowOpen,
  countDoneSunnahs,
  nawafilStreak,
  nawafilOpportunity,
  RAWATIB_TYPES,
  FIVE_PRAYERS,
  type DayPrayerGrid,
  type NawafilWindowTimes,
  type PrayerStatus,
} from '@/utils/prayerTracker';
import { formatDateKey, addDays } from '@/utils/dateUtils';
import type { SunnahRecord } from '@/db/database';

/**
 * Phase 0/2's prayer-record invariants: an answer saved in its day stays
 * correctable inside the today/yesterday window, a slot only opens for those
 * two days, the legacy combined Dhuhr rawatib row reads exactly like its split
 * halves, and the week percentage treats a never-answered past prayer as a
 * miss — silence must not be rewarded.
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
    expect(() => assertPrayerRecordable(today, now)).not.toThrow();
  });

  it('records an unanswered prayer of yesterday', () => {
    expect(() => assertPrayerRecordable(yesterday, now)).not.toThrow();
  });

  it('keeps today and yesterday editable — a mis-tap can be corrected in its window', () => {
    // Correction reuses the same rule: the day is writable, so re-answering is too.
    expect(() => assertPrayerRecordable(today, now)).not.toThrow();
    expect(() => assertPrayerRecordable(yesterday, now)).not.toThrow();
  });

  it('rejects days outside today and yesterday — the window closes with the day', () => {
    expect(() => assertPrayerRecordable(twoDaysAgo, now)).toThrow(
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
    // `open` is what the grid's editability reads; `summariseGrid` never looks
    // at it, so mirroring `due` keeps this fixture a plain "recorded prayers"
    // day without pretending to model a live window.
    open: due as DayPrayerGrid['open'],
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

describe('computeRecordingWindows', () => {
  // One plain day: five adhans in prayer order, every instant inside that day.
  const at = (hour: number, minute = 0) => new Date(2026, 2, 10, hour, minute).getTime();
  const windows = computeRecordingWindows([
    { name: 'fajr', time: new Date(2026, 2, 10, 4, 45) },
    { name: 'dhuhr', time: new Date(2026, 2, 10, 12, 0) },
    { name: 'asr', time: new Date(2026, 2, 10, 15, 30) },
    { name: 'maghrib', time: new Date(2026, 2, 10, 17, 45) },
    { name: 'isha', time: new Date(2026, 2, 10, 19, 15) },
  ]);

  it('opens a prayer exactly at its adhan and shuts it at the next one', () => {
    expect(isWindowOpen(windows, 'dhuhr', at(11, 59))).toBe(false);
    expect(isWindowOpen(windows, 'dhuhr', at(12, 0))).toBe(true);
    expect(isWindowOpen(windows, 'dhuhr', at(15, 29))).toBe(true);
    // The end is exclusive: at Asr's adhan Dhuhr's window is already shut.
    expect(isWindowOpen(windows, 'dhuhr', at(15, 30))).toBe(false);
  });

  it("keeps the day's last prayer open until the day itself ends", () => {
    expect(isWindowOpen(windows, 'isha', at(19, 15))).toBe(true);
    expect(isWindowOpen(windows, 'isha', at(23, 59))).toBe(true);
  });

  it('never opens a prayer before its adhan, nor one it knows nothing about', () => {
    expect(isWindowOpen(windows, 'fajr', at(4, 44))).toBe(false);
    expect(isWindowOpen(windows, 'fajr', at(4, 45))).toBe(true);
    // Sunrise is not a confirmable prayer, so it never carries a window.
    expect(isWindowOpen(windows, 'sunrise', at(6, 10))).toBe(false);
    expect(isWindowOpen(windows, 'unknown', at(12, 30))).toBe(false);
  });

  it('is shut everywhere for an empty schedule', () => {
    const none = computeRecordingWindows([]);
    expect(isWindowOpen(none, 'fajr', at(12))).toBe(false);
  });
});

describe('countDoneSunnahs', () => {
  const row = (type: string, done: boolean): SunnahRecord => ({ date: today, type, done } as SunnahRecord);

  it('counts only done rows whose key is wanted', () => {
    const rows = [
      row('rawatib_fajr', true),
      row('rawatib_dhuhr_before', true),
      row('rawatib_dhuhr_after', false),   // present but not done
      row('witr', true),                    // done but not wanted here
    ];
    expect(countDoneSunnahs(rows, ['rawatib_fajr', 'rawatib_dhuhr_before', 'rawatib_dhuhr_after'])).toBe(2);
    expect(countDoneSunnahs(rows, ['witr'])).toBe(1);
  });

  it('counts nothing for an empty day', () => {
    expect(countDoneSunnahs([], RAWATIB_TYPES)).toBe(0);
  });
});

describe('nawafilStreak', () => {
  it('counts consecutive perfect days back from today', () => {
    expect(nawafilStreak([true, true, true, false, true])).toBe(3);
  });

  it('lets an unfinished today stand — the streak counts from yesterday', () => {
    expect(nawafilStreak([false, true, true])).toBe(2);
  });

  it('ends the run at the first gap', () => {
    expect(nawafilStreak([true, true, false, true])).toBe(2);
  });

  it('is zero when not even yesterday was perfect', () => {
    expect(nawafilStreak([false, false])).toBe(0);
    expect(nawafilStreak([])).toBe(0);
  });
});

describe('nawafilOpportunity', () => {
  // A plain day: sunrise 6:10, Dhuhr 12:00, Maghrib 17:45, Isha 19:15 — and Fajr
  // belongs to the *next* calendar day, because the night runs Maghrib→Fajr.
  const at = (hour: number, minute = 0) => new Date(2026, 2, 10, hour, minute);
  const fajr = new Date(2026, 2, 11, 4, 45);
  const times: NawafilWindowTimes = {
    fajr,
    sunrise: at(6, 10),
    dhuhr: at(12, 0),
    maghrib: at(17, 45),
    isha: at(19, 15),
  };
  // The night (Maghrib→Fajr) is 11h, so its last third begins 3h40m before Fajr: 1:05.
  const lastThirdStart = new Date(2026, 2, 11, 1, 5);

  it('opens الضحى from sunrise until Dhuhr', () => {
    expect(nawafilOpportunity(at(6, 10), times)).toBe('duha');
    expect(nawafilOpportunity(at(11, 59), times)).toBe('duha');
    expect(nawafilOpportunity(at(6, 9), times)).toBe('none');
  });

  it('opens الوتر from Isha until Fajr', () => {
    expect(nawafilOpportunity(at(19, 15), times)).toBe('witr');
    expect(nawafilOpportunity(at(23, 59), times)).toBe('witr');
    expect(nawafilOpportunity(at(19, 14), times)).toBe('none');
  });

  it("opens قيام الليل in the night's last third, ahead of الوتر", () => {
    expect(nawafilOpportunity(lastThirdStart, times)).toBe('qiyam');
    expect(nawafilOpportunity(new Date(2026, 2, 11, 2, 30), times)).toBe('qiyam');
    // Before the last third, the night is still الوتر's.
    expect(nawafilOpportunity(new Date(2026, 2, 11, 1, 4), times)).toBe('witr');
    // At Fajr the night is over — nothing is open.
    expect(nawafilOpportunity(fajr, times)).toBe('none');
  });

  it('is never open outside every window', () => {
    expect(nawafilOpportunity(at(15, 0), times)).toBe('none');
    expect(nawafilOpportunity(at(3, 0), times)).toBe('none');
  });
});
