/**
 * The schedule has to move as the day does, without paying adhan's calculation
 * every tick — the two halves of what the hook's header promises, and the first
 * half stopped holding.
 *
 * `passed` is the one field `calculatePrayerTimes` fills in from the clock rather
 * than from the date. Reading it back out of the memo pinned to the calendar day
 * therefore froze it at the day's first render, and `passedSignature` — the only
 * dependency that ever made `nextPrayer` re-ask its question — froze with it.
 * `nextPrayer` held the answer for whatever prayer was next at first render; once
 * that prayer passed, the countdown sat at 00:00 and, because
 * `countdownTickDelayMs` answers any non-positive remainder with 1000, kept
 * re-rendering every second for the rest of the day without ever advancing.
 *
 * These cases pin both halves: the schedule follows the clock across a prayer,
 * and the day's expensive result keeps its identity between two prayers.
 *
 * The clock is mocked rather than faked because `getNextPrayer` reads
 * `trustedNow()` internally — advancing it is the only way to ask what the hook
 * answers at a chosen instant without waiting for the real one to arrive.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/** The instant under test: `getNextPrayer` and the `now` prop are driven from here. */
let trustedMs = 0;

jest.unstable_mockModule('@/utils/clock', () => ({
  JUMP_THRESHOLD_MS: 5_000,
  trustedNow: () => new Date(trustedMs),
  trustedNowMs: () => trustedMs,
  deviceClockDriftMs: () => 0,
  onClockChange: () => () => undefined,
  syncTrustedTime: async () => false,
  startClockService: () => undefined,
  checkDeviceClockJump: () => false,
  __resetClockForTests: () => undefined,
}));

const { usePrayerSchedule } = await import('@/hooks/usePrayerSchedule');
const { calculatePrayerTimesForDay, calendarDayInZone } = await import('@/utils/prayerTimes');

type Schedule = ReturnType<typeof usePrayerSchedule>;

const LOCATION = {
  latitude: 30.0444,
  longitude: 31.2357,
  calcMethod: 'Egyptian',
  asrMadhab: 'standard' as const,
  timeZone: 'Africa/Cairo',
  cityName: 'القاهرة',
};

/**
 * A fixed Cairo day, read once at load — the day's times depend only on the city,
 * so they are the same whenever the suite runs. The reference instant lands mid
 * afternoon in Cairo (UTC+2 in January), which is inside that city's day.
 */
const DAY = calendarDayInZone(new Date(Date.UTC(2026, 0, 15, 12, 0, 0)), LOCATION.timeZone);
const TIMES = calculatePrayerTimesForDay(
  LOCATION.latitude,
  LOCATION.longitude,
  DAY,
  LOCATION.calcMethod,
  LOCATION.asrMadhab,
);
const DHUHR_AT = TIMES.prayers.find((prayer) => prayer.name === 'dhuhr')!.time.getTime();

/** Cairo's dhuhr is late morning; both sides of it must stay inside one city day. */
const MINUTE = 60_000;

describe('usePrayerSchedule', () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: Schedule | undefined;

  /** `location: null` exercises the no-coordinate branch through a real render. */
  function Harness({ now, location }: { now: Date; location: typeof LOCATION | null }) {
    latest = usePrayerSchedule({
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      calcMethod: 'Egyptian',
      asrMadhab: 'standard',
      timeZone: 'Africa/Cairo',
      cityName: 'القاهرة',
      now,
    });
    return null;
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    trustedMs = DHUHR_AT - 10 * MINUTE;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  /** Renders the hook at one instant and returns what it answered. */
  async function showAt(instantMs: number, location: typeof LOCATION | null = LOCATION): Promise<Schedule> {
    trustedMs = instantMs;
    await act(async () => {
      root.render(<Harness now={new Date(instantMs)} location={location} /> as ReactElement);
    });
    return latest!;
  }

  const passed = (schedule: Schedule, name: string) =>
    schedule.prayerResult!.prayers.find((prayer) => prayer.name === name)!.passed;

  it('follows the clock across a prayer instead of keeping first render’s answer', async () => {
    const before = await showAt(DHUHR_AT - 10 * MINUTE);

    expect(before.nextPrayer?.name).toBe('dhuhr');
    expect(passed(before, 'dhuhr')).toBe(false);

    const after = await showAt(DHUHR_AT + 10 * MINUTE);

    // The whole of H3: the schedule must advance when dhuhr comes and goes.
    expect(after.nextPrayer?.name).toBe('asr');
    expect(passed(after, 'dhuhr')).toBe(true);
    expect(passed(after, 'fajr')).toBe(true);
  });

  it('reports every prayer’s state from the current instant, not the day’s', async () => {
    // One prayer short of dhuhr — sunrise is over, dhuhr is not.
    const early = await showAt(DHUHR_AT - 10 * MINUTE);
    expect(passed(early, 'sunrise')).toBe(true);
    expect(passed(early, 'dhuhr')).toBe(false);
    expect(passed(early, 'maghrib')).toBe(false);

    const late = await showAt(DHUHR_AT + 10 * MINUTE);
    expect(passed(late, 'dhuhr')).toBe(true);
    // Afternoon prayers have not happened yet at noon, whatever the day's first
    // render thought — the flags are not allowed to be older than the clock.
    expect(passed(late, 'asr')).toBe(false);
  });

  it('keeps the day’s result identical between two prayers', async () => {
    const earlier = await showAt(DHUHR_AT - 10 * MINUTE);
    // A later instant inside the same stretch: nothing has passed, so the
    // expensive adhan result must not be recomputed or reallocated.
    const later = await showAt(DHUHR_AT - 5 * MINUTE);

    expect(later.prayerResult).toBe(earlier.prayerResult);

    // The moment a prayer crosses, the derived view does move on.
    const crossing = await showAt(DHUHR_AT + MINUTE);
    expect(crossing.prayerResult).not.toBe(later.prayerResult);
  });

  it('leaves the schedule empty when there is no location', async () => {
    const schedule = await showAt(DHUHR_AT, null);

    expect(schedule.hasLocation).toBe(false);
    expect(schedule.prayerResult).toBeNull();
    expect(schedule.nextPrayer).toBeNull();
  });
});
