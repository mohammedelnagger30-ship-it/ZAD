import { Check, Clock, X, Minus } from 'lucide-react';
import {
  FIVE_PRAYERS,
  PRAYER_LABELS_AR,
  canEditPrayerDate,
  type DayPrayerGrid,
  type PrayerKey,
  type PrayerStatus,
} from '@/utils/prayerTracker';

interface PrayerWeekGridProps {
  grid: DayPrayerGrid[];
  /** Opens the status sheet for that (day, prayer). Omitted = read-only report. */
  onEdit?: (date: string, prayer: PrayerKey, status: PrayerStatus | null, label: string) => void;
}

/**
 * Seven days × five prayers, newest day last.
 *
 * Two things make this honest rather than decorative:
 *
 *  - A cell that had not come round yet is a faint dash, never a red cross, so
 *    "I did not pray" and "it is not time yet" cannot be confused.
 *  - Today and yesterday are editable; older days remain visible but read-only.
 *
 * The dots under each cell are that prayer's rawatib: filled = recorded,
 * hollow = not recorded yet — never a failure mark, the same honesty rule the
 * prayer itself follows. Pressing the cell opens the sheet where both the
 * prayer and its rawatib are recorded together.
 */
export function PrayerWeekGrid({ grid, onEdit }: PrayerWeekGridProps) {
  return (
    <div>
      {/* Column headers */}
      <div
        className="grid gap-1 mb-1.5"
        style={{ gridTemplateColumns: 'minmax(3.25rem,1fr) repeat(5,minmax(0,1fr))' }}
      >
        <span />
        {FIVE_PRAYERS.map((key) => (
          <span
            key={key}
            className="text-center text-[11px] font-semibold text-gray-500 dark:text-gray-400"
          >
            {PRAYER_LABELS_AR[key]}
          </span>
        ))}
      </div>

      <div className="space-y-1">
        {grid.map((day) => (
          <div
            key={day.date}
            className={`grid gap-1 items-center rounded-xl px-1.5 py-1 ${
              day.isToday ? 'bg-primary-50 dark:bg-primary-800/40 ring-1 ring-primary-200 dark:ring-primary-700' : ''
            }`}
            style={{ gridTemplateColumns: 'minmax(3.25rem,1fr) repeat(5,minmax(0,1fr))' }}
          >
            {/* Day label */}
            <div className="flex items-baseline gap-1 min-w-0">
              <span
                className={`text-xs font-semibold truncate ${
                  day.isToday
                    ? 'text-primary-700 dark:text-primary-100'
                    : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                {day.isToday ? 'اليوم' : day.dayName}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                {day.dayNumber}
              </span>
            </div>

            {FIVE_PRAYERS.map((key) => (
              <GridCell
                key={key}
                day={day}
                prayer={key}
                onEdit={onEdit}
              />
            ))}
          </div>
        ))}
      </div>

      <Legend />
    </div>
  );
}

function GridCell({
  day,
  prayer,
  onEdit,
}: {
  day: DayPrayerGrid;
  prayer: PrayerKey;
  onEdit?: PrayerWeekGridProps['onEdit'];
}) {
  const status = day.status[prayer];
  const due = day.due[prayer];
  const name = PRAYER_LABELS_AR[prayer];
  const slots = day.sunnah[prayer];

  // Not time yet — nothing is owed, so this must not read as a failure.
  if (!due && !status) {
    return (
      <span
        className="h-11 rounded-lg bg-gray-100/60 dark:bg-primary-800/20 flex items-center justify-center text-gray-300 dark:text-primary-700"
        aria-label={`${name} لم يحن وقتها بعد`}
        title="لم يحن وقتها بعد"
      >
        <Minus size={15} />
      </span>
    );
  }

  const visual = VISUALS[status ?? 'unconfirmed'];
  const Icon = visual.icon;
  const stateLabel = status ? AR_STATE[status] : 'لم تسجّلها';

  // Past days are editable so a forgotten confirmation can still be recorded.
  const editable = !!onEdit && canEditPrayerDate(day.date);

  // The dots under the icon are this prayer's rawatib; the label carries the same
  // fact for anyone reading the cell with a screen reader or a hover tooltip.
  const doneCount = slots.filter((slot) => slot.done).length;
  const rawatibLabel =
    slots.length === 0
      ? ''
      : doneCount === 0
        ? '، السنة الراتبة لم تُسجَّل'
        : doneCount === slots.length
          ? '، السنة الراتبة صُلّيت'
          : `، ${doneCount} من ${slots.length} رواتب مسجّلة`;
  const label = `${name} — ${stateLabel}${rawatibLabel}`;

  const dots =
    slots.length > 0 ? (
      <span className="flex gap-1" aria-hidden="true">
        {slots.map((slot) => (
          <span
            key={slot.type}
            title={slot.label}
            className={`h-1.5 w-1.5 rounded-full ${
              slot.done
                ? 'bg-success-600 dark:bg-success-400'
                : 'border border-gray-400 dark:border-gray-500'
            }`}
          />
        ))}
      </span>
    ) : null;

  if (!editable) {
    return (
      <span
        className={`h-11 rounded-lg flex flex-col items-center justify-center gap-1 ${visual.cell}`}
        aria-label={label}
        title={label}
      >
        <Icon size={16} className={visual.iconClass} />
        {dots}
      </span>
    );
  }

  return (
    <button
      onClick={() => onEdit(day.date, prayer, status, `${day.isToday ? 'اليوم' : day.dayName} ${day.dayNumber}`)}
      aria-label={label}
      title={label}
      className={`h-11 rounded-lg flex flex-col items-center justify-center gap-1 ${visual.cell} ring-offset-1 hover:ring-2 hover:ring-primary-300 dark:hover:ring-primary-500 transition-shadow active:scale-95`}
    >
      <Icon size={16} className={visual.iconClass} />
      {dots}
    </button>
  );
}

const AR_STATE: Record<PrayerStatus, string> = {
  ontime: 'في وقتها',
  late: 'قضاء',
  missed: 'ما صليتهاش',
};

const VISUALS: Record<
  PrayerStatus | 'unconfirmed',
  { cell: string; iconClass: string; icon: typeof Check }
> = {
  ontime: {
    cell: 'bg-success-100 dark:bg-success-900/40',
    iconClass: 'text-success-600 dark:text-success-300',
    icon: Check,
  },
  late: {
    cell: 'bg-warning-100 dark:bg-warning-900/40',
    iconClass: 'text-warning-600 dark:text-warning-300',
    icon: Clock,
  },
  missed: {
    cell: 'bg-error-100 dark:bg-error-900/40',
    iconClass: 'text-error-600 dark:text-error-300',
    icon: X,
  },
  unconfirmed: {
    // Due but never logged. Deliberately hollow rather than filled red — the user may
    // simply not have opened the app, and a loud red cross would be a lie about the
    // prayer itself.
    cell: 'bg-gray-100 dark:bg-primary-800/40 border border-dashed border-gray-300 dark:border-primary-600',
    iconClass: 'text-gray-400 dark:text-gray-500',
    icon: Minus,
  },
};

function Legend() {
  const items: { label: string; cls: string }[] = [
    { label: 'في وقتها', cls: 'rounded bg-success-100 dark:bg-success-900/40' },
    { label: 'قضاء', cls: 'rounded bg-warning-100 dark:bg-warning-900/40' },
    { label: 'ما صليتهاش', cls: 'rounded bg-error-100 dark:bg-error-900/40' },
    { label: 'لم تسجّلها', cls: 'rounded bg-gray-100 dark:bg-primary-800/40 border border-dashed border-gray-300 dark:border-primary-600' },
    { label: 'راتبة مسجّلة', cls: 'rounded-full bg-success-600 dark:bg-success-400' },
    { label: 'راتبة لم تُسجَّل', cls: 'rounded-full bg-transparent border border-gray-400 dark:border-gray-500' },
  ];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2.5 border-t border-primary-100 dark:border-primary-800/50">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
          <span className={`w-3.5 h-3.5 shrink-0 ${i.cls}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
