/**
 * The day divided the way the home screen speaks about it.
 *
 * The bounds follow the prayers rather than the clock's tidy thirds: Fajr opens the
 * morning, Dhuhr opens the middle of the day, and Maghrib opens the evening — which
 * is why the evening runs past midnight, back to 3:59. Keeping this a pure function
 * of a `Date` means the card can be tested at every boundary without a component,
 * a timer or a mocked clock.
 */
export type DayPhase = 'morning' | 'midday' | 'evening';

export const DAY_PHASE_STARTS = {
  morning: 4,
  midday: 12,
  evening: 18,
} as const;

export function dayPhaseOf(date: Date): DayPhase {
  const hour = date.getHours();
  if (hour >= DAY_PHASE_STARTS.morning && hour < DAY_PHASE_STARTS.midday) return 'morning';
  if (hour >= DAY_PHASE_STARTS.midday && hour < DAY_PHASE_STARTS.evening) return 'midday';
  return 'evening';
}
