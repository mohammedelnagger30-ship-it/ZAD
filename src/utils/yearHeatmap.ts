import { addDays, formatDateKey } from '@/utils/dateUtils';

export interface YearHeatmapGrid {
  /** One entry per column: seven `YYYY-MM-DD` keys, the week's Saturday first. */
  weeks: string[][];
  /**
   * The month a column introduces, or null when it introduces none.
   *
   * A label belongs on the column that *contains* the 1st, because that is
   * where the month visually starts — labelling the column after it would
   * point at a week that is already three days into the next month. Two
   * months cannot introduce themselves in the same column: the shortest
   * month is 28 days, four whole columns away.
   */
  monthLabels: (number | null)[];
  /** First and last key displayed — the exact range to ask the database for. */
  start: string;
  end: string;
}

/**
 * Lays a whole calendar year out as columns of seven, ready to be painted.
 *
 * The grid is padded at both ends so every column is a complete week: a year
 * that began on a Wednesday would otherwise open with a column of three
 * blank cells, and the first of January would sit in the middle of its
 * column instead of at the top of one. Those padding days are returned too —
 * they are real dates, they belong to the neighbouring year, and querying
 * exactly the range shown is what keeps the whole year to a single query.
 *
 * The week starts on Saturday, which is what the rest of the app says and
 * what an Arabic calendar shows. `getDay()` counts Sunday as 0, so reaching
 * back to Saturday is `+1 mod 7`, not the `-getDay()` that lands on Sunday.
 */
export function buildYearHeatmap(year: number): YearHeatmapGrid {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  let cursor = addDays(yearStart, -((yearStart.getDay() + 1) % 7));

  const weeks: string[][] = [];
  const monthLabels: (number | null)[] = [];
  const introducedMonths = new Set<number>();

  while (cursor <= yearEnd) {
    const week: string[] = [];
    let label: number | null = null;
    for (let day = 0; day < 7; day++) {
      const date = new Date(cursor);
      week.push(formatDateKey(date));
      if (date.getDate() === 1 && date.getFullYear() === year && !introducedMonths.has(date.getMonth())) {
        introducedMonths.add(date.getMonth());
        label = date.getMonth();
      }
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
    monthLabels.push(label);
  }

  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  return {
    weeks,
    monthLabels,
    start: firstWeek[0],
    end: lastWeek[lastWeek.length - 1],
  };
}
