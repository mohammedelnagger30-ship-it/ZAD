/**
 * The year grid decides what the screen is allowed to ask the database for
 * and where every label lands, so a mistake here is invisible until it is a
 * year wide: a week that does not start on Saturday shifts every month
 * label, a day missing from the padding silently drops from the map, and a
 * range wider than the grid turns one query back into hundreds.
 */
import { describe, it, expect } from '@jest/globals';
import { buildYearHeatmap } from '@/utils/yearHeatmap';

const keyOf = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

describe('buildYearHeatmap', () => {
  it('lays every column out as a whole week that starts on a Saturday', () => {
    const grid = buildYearHeatmap(2026);

    // Roughly 53 columns, plus the partial week that spills over.
    expect(grid.weeks.length).toBeGreaterThanOrEqual(53);
    expect(grid.weeks.length).toBeLessThanOrEqual(55);

    for (const week of grid.weeks) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0]}T00:00:00`).getDay()).toBe(6);
    }
  });

  it('shows every day of the year, padded with the neighbouring years', () => {
    const grid = buildYearHeatmap(2026);
    const shown = new Set<string>();
    for (const week of grid.weeks) for (const date of week) shown.add(date);

    expect(shown.has(keyOf(2026, 1, 1))).toBe(true);
    expect(shown.has(keyOf(2026, 12, 31))).toBe(true);
    expect(shown.has(keyOf(2026, 2, 29))).toBe(false); // 2026 is not a leap year

    // The padding belongs to the years on either side, which is why the
    // query range is wider than the year it is asked for.
    expect(grid.start < keyOf(2026, 1, 1)).toBe(true);
    expect(grid.end > keyOf(2026, 12, 31)).toBe(true);
  });

  it('labels all twelve months, each on the column holding its first day', () => {
    const grid = buildYearHeatmap(2026);

    const labels = grid.monthLabels.filter((month): month is number => month !== null);
    expect(labels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    for (let index = 0; index < grid.monthLabels.length; index++) {
      const month = grid.monthLabels[index];
      if (month === null) continue;
      expect(grid.weeks[index]).toContain(keyOf(2026, month + 1, 1));
    }
  });

  /**
   * Labels are set in the same fixed-width columns as the cells, and the
   * longest month name is wider than one of them. They stay legible only
   * because two month-starts are never close together: the shortest month
   * is 28 days, four whole columns.
   */
  it('keeps neighbouring month labels at least four columns apart', () => {
    const grid = buildYearHeatmap(2026);

    let previous: number | null = null;
    for (let index = 0; index < grid.monthLabels.length; index++) {
      const month = grid.monthLabels[index];
      if (month === null) continue;
      if (previous !== null) expect(index - previous).toBeGreaterThanOrEqual(4);
      previous = index;
    }
  });

  it('asks for exactly the range it shows, and no more', () => {
    for (const year of [2024, 2025, 2026, 2027]) {
      const grid = buildYearHeatmap(year);
      const lastWeek = grid.weeks[grid.weeks.length - 1];
      expect(grid.start).toBe(grid.weeks[0][0]);
      expect(grid.end).toBe(lastWeek[lastWeek.length - 1]);
    }
  });

  it('starts the first column in December of the year before', () => {
    // 1 January 2026 falls on a Thursday, five days into a week that began
    // on Saturday 27 December 2025.
    expect(buildYearHeatmap(2026).start).toBe('2025-12-27');
  });
});
