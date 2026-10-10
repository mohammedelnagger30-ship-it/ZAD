import { useMemo } from 'react';
import {
  calculatePrayerTimes,
  calendarDayInZone,
  getNextPrayer,
  getPrayerTimeZone,
} from '@/utils/prayerTimes';

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
