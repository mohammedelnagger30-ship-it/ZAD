import { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, SectionHeader } from '@/components/ui';
import { db } from '@/db/database';
import { ARABIC_MONTHS, todayKey } from '@/utils/dateUtils';
import { trustedNow } from '@/utils/clock';
import { toArabicNumber } from '@/data/surahs';
import { buildYearHeatmap } from '@/utils/yearHeatmap';

interface Cell {
  done: number;
  total: number;
}

/**
 * A year of commitment, one column per week.
 *
 * This used to show the last thirty days, loaded with a query *per day* —
 * thirty round trips to IndexedDB for five weeks of squares. A year at that
 * rate would be 365, so the grid decides the range and the whole thing
 * arrives in one `between()`, grouped by date afterwards.
 *
 * The year is steppable because a heatmap for the current year is mostly
 * empty in February, and because the record of last year is the only proof
 * that the streak you are proudest of actually happened.
 */
export function YearHeatmap() {
  const [year, setYear] = useState(() => trustedNow().getFullYear());
  const [data, setData] = useState<Record<string, Cell>>({});

  const grid = useMemo(() => buildYearHeatmap(year), [year]);

  useEffect(() => {
    let cancelled = false;
    void db.tasks
      .where('date')
      .between(grid.start, grid.end, true, true)
      .toArray()
      .then((tasks) => {
        if (cancelled) return;
        const byDate: Record<string, Cell> = {};
        for (const task of tasks) {
          const cell = byDate[task.date] ?? { done: 0, total: 0 };
          cell.total += 1;
          if (task.status === 'done') cell.done += 1;
          byDate[task.date] = cell;
        }
        setData(byDate);
      })
      .catch((error) => console.error('Failed to load the commitment map:', error));
    return () => {
      cancelled = true;
    };
  }, [grid.start, grid.end]);

  const today = todayKey();
  const currentYear = trustedNow().getFullYear();

  return (
    <Card>
      <SectionHeader title="خريطة الالتزام" icon={<Calendar size={20} />} />

      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setYear((value) => value - 1)}
          aria-label="العام السابق"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-primary-800/40 dark:hover:text-gold-300"
        >
          <ChevronRight size={18} />
        </button>
        <p className="text-sm font-bold text-primary-800 dark:text-gold-300">
          {toArabicNumber(year)}
        </p>
        <button
          type="button"
          onClick={() => setYear((value) => value + 1)}
          disabled={year >= currentYear}
          aria-label="العام التالي"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-400 dark:hover:bg-primary-800/40 dark:hover:text-gold-300"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-max">
          {/* Month labels share the columns' gap, so they line up without a grid. */}
          <div className="mb-1 flex gap-1">
            {grid.monthLabels.map((month, index) => (
              <div
                key={index}
                className="w-4 shrink-0 overflow-visible whitespace-nowrap text-[9px] leading-none text-gray-500 dark:text-gray-400 md:w-5"
              >
                {month !== null ? ARABIC_MONTHS[month] : ''}
              </div>
            ))}
          </div>

          <div className="flex gap-1">
            {grid.weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((date) => {
                  const cell = data[date];
                  const isFuture = date > today;
                  const ratio = cell && cell.total > 0 ? cell.done / cell.total : 0;
                  return (
                    <div
                      key={date}
                      className={`h-4 w-4 rounded-[3px] transition-smooth md:h-5 md:w-5 ${
                        isFuture
                          ? 'bg-gray-50 dark:bg-gray-800/30'
                          : ratio === 0 && cell?.total > 0
                          ? 'bg-error-100 dark:bg-error-900/30'
                          : ratio > 0 && ratio < 0.5
                          ? 'bg-warning-200 dark:bg-warning-800/50'
                          : ratio >= 0.5 && ratio < 1
                          ? 'bg-primary-300 dark:bg-primary-700'
                          : ratio === 1
                          ? 'bg-primary-500'
                          : 'bg-gray-100 dark:bg-gray-800'
                      } ${date === today ? 'ring-2 ring-gold-400 ring-offset-1 dark:ring-offset-primary-900' : ''}`}
                      title={
                        isFuture
                          ? date
                          : cell
                            ? `${date}: ${toArabicNumber(cell.done)}/${toArabicNumber(cell.total)}`
                            : date
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span>أقل</span>
        <div className="flex gap-1">
          <div className="h-3 w-3 rounded-sm bg-gray-100 dark:bg-gray-800" />
          <div className="h-3 w-3 rounded-sm bg-error-100 dark:bg-error-900/30" />
          <div className="h-3 w-3 rounded-sm bg-warning-200 dark:bg-warning-800/50" />
          <div className="h-3 w-3 rounded-sm bg-primary-300 dark:bg-primary-700" />
          <div className="h-3 w-3 rounded-sm bg-primary-500" />
        </div>
        <span>أكثر</span>
      </div>
    </Card>
  );
}
