import { Check, Clock, X, Minus, Sun, Moon } from 'lucide-react';
import {
  FIVE_PRAYERS,
  PRAYER_LABELS_AR,
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
 * Layout redesign:
 *  - Column headers = prayer names (with sun/moon hint for fajr/isha)
 *  - Row headers = day name + date, right-aligned, today marked with a dot
 *  - Cells = larger touch targets, clear status icons, rawatib dots beneath
 *  - Not-yet-due = faint dash, never a red cross (honesty rule kept)
 *  - Today / yesterday editable; older days read-only
 */
export function PrayerWeekGrid({ grid, onEdit }: PrayerWeekGridProps) {

  // Prayer icons: fajr = sunrise (sun), isha = night (moon), others = neutral clock
  const PRAYER_ICONS = {
    fajr: Sun,
    dhuhr: Sun,
    asr: Sun,
    maghrib: Moon,
    isha: Moon,
  };

  return (
    <div className="lg:max-w-3xl mx-auto">
      {/* Section title area handled by caller; this is just the grid */}
      {/* Column headers — prayer names across the top */}
      <div
        className="grid gap-1 mb-3"
        style={{ gridTemplateColumns: 'minmax(4rem,1fr) repeat(5,minmax(0,1fr))' }}
      >
        <span className="sr-only">الأسبوع</span>
        {FIVE_PRAYERS.map((key) => {
          const Icon = PRAYER_ICONS[key];
          return (
            <span
              key={key}
              className={`flex flex-col items-center gap-1 pt-1 pb-2 text-center font-semibold ${
                key === 'fajr' || key === 'isha'
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <Icon size={12} className="mb-0.5" />
              {PRAYER_LABELS_AR[key]}
            </span>
          );
        })}
      </div>

      {/* Day rows */}
      <div className="space-y-1">
        {grid.map((day) => (
          <div
            key={day.date}
            className={`grid gap-1 items-start rounded-xl px-2 py-2 ${day.isToday ? 'bg-primary-50/60 dark:bg-primary-900/40 ring-1 ring-inset ring-primary-200 dark:ring-primary-700/50 shadow-sm' : 'hover:bg-gray-50 dark:hover:bg-primary-800/20'}`}
            style={{ gridTemplateColumns: 'minmax(4rem,1fr) repeat(5,minmax(0,1fr))' }}
          >
            {/* Day label — fixed left column */}
            <div className="flex flex-col items-end min-w-[4rem]">
              <span
                className={`text-xs font-semibold leading-none ${day.isToday ? 'text-primary-700 dark:text-primary-100' : 'text-gray-600 dark:text-gray-300'}`}
              >
                {day.isToday ? 'اليوم' : day.dayName}
              </span>
              <span className="text-[0.625rem] md:text-xs text-gray-400 dark:text-gray-500 tabular-nums">
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
        className="h-12 md:h-16 rounded-xl bg-gray-100/50 dark:bg-primary-800/20 flex items-center justify-center text-gray-300 dark:text-primary-700/50"
        aria-label={`${name} لم يحن وقتها بعد`}
        title="لم يحن وقتها بعد"
      >
        <Minus size={13} />
      </span>
    );
  }

  const visual = VISUALS[status ?? 'unconfirmed'];
  const Icon = visual.icon;
  const stateLabel = status ? AR_STATE[status] : 'لم تسجّلها';

  // Today's cell opens only inside the prayer's window — its own adhan until the
  // next adhan. Yesterday stays open for corrections all day and older days stay
  // shut: `getPrayerGrid` already packed that whole rule into `open`.
  const editable = !!onEdit && day.open[prayer];

  const doneCount = slots.filter((slot) => slot.done).length;
  const rawatibLabel =
    slots.length === 0
      ? ''
      : doneCount === 0
        ? '، السنة الراتبة لم تُسجَّل'
        : doneCount === slots.length
          ? '، السنة الراتبة صُلّيت'
          : `، ${doneCount} من ${slots.length} رواتب`;

  // Due but shut is its own state: the cell says why instead of silently
  // refusing a tap. The correction opens again when the date turns it to أمس.
  const closedNote =
    day.isToday && !day.open[prayer]
      ? ' — انتهى وقت التسجيل، يُصحَّح غدًا كأمس'
      : '';

  const label = `${name} — ${stateLabel}${rawatibLabel}${closedNote}`;

  const dots =
    slots.length > 0 ? (
      <span className="flex gap-1 mt-0.5" aria-hidden="true">
        {slots.map((slot) => (
          <span
            key={slot.type}
            title={slot.label}
            className={`h-2 w-2 rounded-full shrink-0 ${slot.done ? 'bg-success-600 dark:bg-success-400' : 'border border-gray-400 dark:border-gray-500'}`}
          />
        ))}
      </span>
    ) : null;

  if (!editable) {
    return (
      <span
        className={`h-12 md:h-16 rounded-xl flex flex-col items-center justify-center gap-1 ${visual.cell}`}
        aria-label={label}
        title={label}
      >
        <Icon size={14} className={visual.iconClass} />
        {dots}
      </span>
    );
  }

  return (
    <button
      onClick={() => onEdit(day.date, prayer, status, `${day.isToday ? 'اليوم' : day.dayName} ${day.dayNumber}`)}
      aria-label={label}
      title={label}
      className={`h-12 md:h-16 rounded-xl flex flex-col items-center justify-center gap-1 ${visual.cell} ring-offset-1 hover:ring-2 hover:ring-primary-300 dark:hover:ring-primary-500 transition-shadow active:scale-95`}
    >
      <Icon size={14} className={visual.iconClass} />
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
    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-4 pt-2.5 border-t border-primary-100 dark:border-primary-800/50">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[0.6875rem] md:text-xs text-gray-500 dark:text-gray-400">
          <span className={`w-3.5 h-3.5 shrink-0 ${i.cls}`} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
