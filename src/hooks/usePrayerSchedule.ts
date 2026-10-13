import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import {
  calculatePrayerTimes,
  calendarDayInZone,
  getNextPrayer,
  getPrayerTimeZone,
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
  now: Date;
}

export function usePrayerSchedule({
  latitude,
  longitude,
  calcMethod,
  asrMadhab,
  timeZone,
  cityName,
  now,
}: PrayerScheduleInput) {
  const prayerTimeZone = getPrayerTimeZone(timeZone, cityName);
  const hasLocation = latitude != null && longitude != null;

  const cityDayKey = useMemo(() => {
    if (!hasLocation) return null;
    const day = calendarDayInZone(now, prayerTimeZone);
    return `${day.year}-${day.month}-${day.day}`;
  }, [hasLocation, now, prayerTimeZone]);

  const prayerResult = useMemo(
    () =>
      hasLocation && cityDayKey
        ? calculatePrayerTimes(latitude!, longitude!, now, calcMethod, asrMadhab, prayerTimeZone)
        : null,
    // `now` is named here only through cityDayKey — the instant inside the day
    // cannot change the day's times.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasLocation, cityDayKey, latitude, longitude, calcMethod, asrMadhab, prayerTimeZone],
  );

  const passedSignature = prayerResult
    ? prayerResult.prayers
        .filter((prayer) => prayer.passed)
        .map((prayer) => prayer.name)
        .join(',')
    : '';

  const nextPrayer = useMemo(
    () =>
      hasLocation
        ? getNextPrayer(latitude!, longitude!, calcMethod, asrMadhab, prayerTimeZone)
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
