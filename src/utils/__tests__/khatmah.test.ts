import { describe, it, expect } from '@jest/globals';
import { createKhatmahPlan, describeKhatmah } from '@/utils/khatmah';
import { TOTAL_QURAN_PAGES } from '@/data/surahs';
import type { KhatmahPlan } from '@/db/database';

/**
 * Khatmah plan maths invariants. The page total comes from the bundled mushaf
 * flow, so nothing here hardcodes the page count — the expectations are
 * derived from the same source the UI displays.
 */

const plan = (overrides: Partial<KhatmahPlan>): KhatmahPlan => ({
  startDate: '2026-10-10',
  targetDate: null,
  currentPage: 0,
  updatedAt: 0,
  ...overrides,
});

describe('describeKhatmah', () => {
  it('derives progress from the bundled page total', () => {
    const status = describeKhatmah(plan({ currentPage: 100 }), '2026-10-10');
    expect(status.totalPages).toBe(TOTAL_QURAN_PAGES);
    expect(status.completed).toBe(100);
    expect(status.remaining).toBe(TOTAL_QURAN_PAGES - 100);
    expect(status.percent).toBe(Math.round((100 / TOTAL_QURAN_PAGES) * 100));
    expect(status.finished).toBe(false);
  });

  it('clamps out-of-range progress in both directions', () => {
    const high = describeKhatmah(plan({ currentPage: TOTAL_QURAN_PAGES + 50 }), '2026-10-10');
    expect(high.completed).toBe(TOTAL_QURAN_PAGES);
    expect(high.remaining).toBe(0);
    expect(high.finished).toBe(true);

    const low = describeKhatmah(plan({ currentPage: -5 }), '2026-10-10');
    expect(low.completed).toBe(0);
    expect(low.remaining).toBe(TOTAL_QURAN_PAGES);
    expect(low.finished).toBe(false);
  });

  it('finishes exactly at the last page', () => {
    const status = describeKhatmah(plan({ currentPage: TOTAL_QURAN_PAGES }), '2026-10-10');
    expect(status.finished).toBe(true);
    expect(status.percent).toBe(100);
  });

  it('counts the target as reading days including today', () => {
    const p = createKhatmahPlan('2026-10-10', 30);
    // Day one of the plan: the full 30 days are ahead.
    expect(describeKhatmah(p, '2026-10-10').daysLeft).toBe(30);
    // On the plan's last reading day exactly one day remains.
    expect(p.targetDate).not.toBeNull();
    expect(describeKhatmah(p, p.targetDate!).daysLeft).toBe(1);
  });

  it('publishes a whole-page daily rate with no target → no rate', () => {
    const withTarget = createKhatmahPlan('2026-10-10', 10);
    withTarget.currentPage = 2;
    const status = describeKhatmah(withTarget, '2026-10-10');
    expect(status.daysLeft).toBe(10);
    expect(status.pagesPerDay).toBe(Math.ceil((TOTAL_QURAN_PAGES - 2) / 10));

    const openEnded = describeKhatmah(plan({ currentPage: 7 }), '2026-10-10');
    expect(openEnded.daysLeft).toBeNull();
    expect(openEnded.pagesPerDay).toBeNull();
  });

  it('drops the daily rate once the target date has passed', () => {
    const p = createKhatmahPlan('2026-10-01', 5);
    const status = describeKhatmah(p, '2026-10-10');
    expect(status.daysLeft).toBeLessThanOrEqual(0);
    expect(status.pagesPerDay).toBeNull();
  });

  it('never publishes a rate below one page a day', () => {
    const p = plan({ startDate: '2026-10-10', targetDate: '2026-12-31', currentPage: 0 });
    const status = describeKhatmah(p, '2026-10-10');
    expect(status.pagesPerDay).toBeGreaterThanOrEqual(1);
  });
});

describe('createKhatmahPlan', () => {
  it('places the target at start + (days − 1) so the count includes today', () => {
    expect(createKhatmahPlan('2026-10-10', 30).targetDate).toBe('2026-11-08');
    expect(createKhatmahPlan('2026-10-10', 1).targetDate).toBe('2026-10-10');
  });

  it('starts at page zero with no target when asked for open-ended', () => {
    const p = createKhatmahPlan('2026-10-10', null);
    expect(p.targetDate).toBeNull();
    expect(p.currentPage).toBe(0);
    expect(p.startDate).toBe('2026-10-10');
  });
});
