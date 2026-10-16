import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import {
  calculatePrayerTimes,
  calendarDayInZone,
  getNextPrayer,
  getPrayerTimeZone,
  type PrayerTimeAdjustments,
} from '@/utils/prayerTimes';
import { trustedNow } from '@/utils/clock';
import { countdownTickDelayMs } from '@/utils/countdown';

/**
 * The prayer schedule a countdown screen renders from.
 *
 * Both HomeScreen and PrayerScreen re-render every second for their countdown,
 * while adhan's answer for a calendar day never changes while the day lasts.
 * This hook pins the calculation to the city's day — recomputing only when the
 * day turns or the location/method settings change — and pins the next prayer
 * to the set of prayers that have already passed, so it moves only when a
 * prayer passes, the day turns, or the settings change.
 */
export interface PrayerScheduleInput {
  latitude?: number | null;
  longitude?: number | null;
  calcMethod: string;
  asrMadhab: 'standard' | 'hanafi';
  timeZone?: string;
  cityName?: string;
  prayerTimeAdjustments?: PrayerTimeAdjustments;
  now: Date;
}

export function usePrayerSchedule({
  latitude,
  longitude,
  calcMethod,
  asrMadhab,
  timeZone,
  cityName,
  prayerTimeAdjustments,
  now,
}: PrayerScheduleInput) {
  const prayerTimeZone = getPrayerTimeZone(timeZone, cityName);
  const hasLocation = latitude != null && longitude != null;

  const cityDayKey = useMemo(() => {
    if (!hasLocation) return null;
    const day = calendarDayInZone(now, prayerTimeZone);
    return `${day.year}-${day.month}-${day.day}`;
  }, [hasLocation, now, prayerTimeZone]);

  // The day's times: expensive (adhan's full calculation) and immutable while the
  // day lasts, so it stays pinned to the calendar day exactly as the header above
  // promises. `now` is named here only through cityDayKey — the instant inside the
  // day cannot change the day's times.
  const dayResult = useMemo(
    () =>
      hasLocation && cityDayKey
        ? calculatePrayerTimes(
            latitude!, longitude!, now, calcMethod, asrMadhab, prayerTimeZone,
            prayerTimeAdjustments,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasLocation, cityDayKey, latitude, longitude, calcMethod, asrMadhab,
      prayerTimeZone, prayerTimeAdjustments,
    ],
  );

  // `passed` is the one field `calculatePrayerTimes` fills in from the clock rather
  // than from the date, so reading it back out of the day-pinned memo froze it at the
  // day's first render: a prayer that had come and gone still drew as upcoming, and
  // `passedSignature` below — the only thing that ever made `nextPrayer` re-ask its
  // question — never changed. `nextPrayer` therefore held the answer for whatever
  // prayer was next at first render; once that prayer passed, the countdown stuck at
  // 00:00 and, because `countdownTickDelayMs` returns 1000 for any non-positive
  // remaining, kept re-rendering every second of the rest of the day.
  //
  // Deriving the signature straight from `now` costs one comparison per prayer and
  // is correct at every tick.
  const nowMs = now.getTime();
  const passedSignature = dayResult
    ? dayResult.prayers
        .filter((prayer) => prayer.time.getTime() < nowMs)
        .map((prayer) => prayer.name)
        .join(',')
    : '';

  // Keyed on the signature rather than on `now`, so the object keeps its identity for
  // the whole stretch between two prayers and only moves when one actually crosses its
  // time. Whenever that re-runs, `nowMs` is the current instant; whenever it does not,
  // the signature's sameness guarantees every flag would come out identical anyway.
  const prayerResult = useMemo(() => {
    if (!dayResult) return null;
    return {
      ...dayResult,
      prayers: dayResult.prayers.map((prayer) => ({
        ...prayer,
        passed: prayer.time.getTime() < nowMs,
      })),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayResult, passedSignature]);

  const nextPrayer = useMemo(
    () =>
      hasLocation
        ? getNextPrayer(
            latitude!, longitude!, calcMethod, asrMadhab, prayerTimeZone,
            prayerTimeAdjustments,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      hasLocation,
      cityDayKey,
      passedSignature,
      latitude,
      longitude,
      calcMethod,
      asrMadhab,
      prayerTimeZone,
      prayerTimeAdjustments,
    ],
  );

  return { prayerTimeZone, hasLocation, prayerResult, nextPrayer };
}

/**
 * The reference clock a countdown screen renders from.
 *
 * `getTimeUntil` only shows seconds in the last minute; above that the text
 * moves once a minute. Ticking `setNow` every second anyway re-rendered the
 * whole screen — task lists, week grids, sheets — sixty times a minute for a
 * string that changes once. This clock arms a chain of timeouts instead
 * (see countdownTickDelayMs): at most once a minute most of the day,
 * per-second only inside the last FAST_TICK_MS — so the prayer passing flips
 * `nextPrayer` within a second while the rest of the day stays quiet.
 *
 * The target is a ref rather than a plain value because the screens compute it
 * *from* the very schedule this clock feeds: they point the ref at the next
 * prayer's instant after the fact, and the chain reads it fresh at every wake.
 */
export function useCountdownClock(targetMsRef: MutableRefObject<number | null>): Date {
  const [now, setNow] = useState(() => trustedNow());

  useEffect(() => {
    let timeoutId: number | undefined;
    const wake = () => {
      const target = targetMsRef.current;
      const remaining = target == null ? Number.POSITIVE_INFINITY : target - trustedNow().getTime();
      timeoutId = window.setTimeout(() => {
        setNow(trustedNow());
        wake();
      }, countdownTickDelayMs(remaining));
    };
    wake();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [targetMsRef]);

  return now;
}
