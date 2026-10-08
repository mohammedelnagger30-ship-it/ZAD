import {
  Coordinates,
  CalculationMethod,
  CalculationParameters,
  PrayerTimes,
  Qibla,
  Madhab,
} from 'adhan';

export interface PrayerTimeInfo {
  name: string;
  arabicName: string;
  time: Date;
  passed: boolean;
}

export interface PrayerTimesResult {
  prayers: PrayerTimeInfo[];
  qiblaDirection: number;
  date: Date;
}

export function getCalcMethod(method: string): CalculationParameters {
  switch (method) {
    case 'Egyptian': return CalculationMethod.Egyptian();
    case 'MWL': return CalculationMethod.MuslimWorldLeague();
    case 'Karachi': return CalculationMethod.Karachi();
    case 'UMM al-Qura': return CalculationMethod.UmmAlQura();
    case 'Dubai': return CalculationMethod.Dubai();
    case 'Moonsighting': return CalculationMethod.MoonsightingCommittee();
    case 'NorthAmerica': return CalculationMethod.NorthAmerica();
    case 'Kuwait': return CalculationMethod.Kuwait();
    case 'Qatar': return CalculationMethod.Qatar();
    case 'Singapore': return CalculationMethod.Singapore();
    case 'Turkey': return CalculationMethod.Turkey();
    case 'Tehran': return CalculationMethod.Tehran();
    default: return CalculationMethod.Egyptian();
  }
}

/**
 * Prayer times for one calendar day.
 *
 * `date` only picks the calendar day *in the city's own time zone*. adhan already
 * returns absolute instants (its `Date` values are built with `Date.UTC` from the
 * solar event expressed in UTC), so they must be handed to the rest of the app as-is.
 * The earlier implementation re-read those values through the device clock and
 * re-interpreted them in the city zone, which shifted every prayer by
 * `deviceOffset − cityOffset`: the times were only right when the phone happened to
 * sit in the selected city, and wrong (by hours, sometimes a whole day) otherwise.
 */
export function calculatePrayerTimes(
  latitude: number,
  longitude: number,
  date: Date,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi',
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): PrayerTimesResult {
  return calculatePrayerTimesForDay(
    latitude,
    longitude,
    calendarDayInZone(date, timeZone),
    calcMethod,
    asrMadhab,
  );
}

/**
 * Same as {@link calculatePrayerTimes} but starting from an already-resolved calendar
 * day. Use this whenever the day is known, so it cannot be re-derived — converting an
 * instant to a day in another zone and back is what breaks at large zone differences.
 */
export function calculatePrayerTimesForDay(
  latitude: number,
  longitude: number,
  day: CalendarDay,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi',
): PrayerTimesResult {
  const coords = new Coordinates(latitude, longitude);
  const params = getCalcMethod(calcMethod);
  params.madhab = asrMadhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;

  const prayerDate = calendarDayToDate(day);
  const pt = new PrayerTimes(coords, prayerDate, params);
  const qiblaDirection = Qibla(coords);

  const now = Date.now();
  const prayerTimes: { name: string; arabicName: string; time: Date }[] = [
    { name: 'fajr', arabicName: 'الفجر', time: pt.fajr },
    { name: 'sunrise', arabicName: 'الشروق', time: pt.sunrise },
    { name: 'dhuhr', arabicName: 'الظهر', time: pt.dhuhr },
    { name: 'asr', arabicName: 'العصر', time: pt.asr },
    { name: 'maghrib', arabicName: 'المغرب', time: pt.maghrib },
    { name: 'isha', arabicName: 'العشاء', time: pt.isha },
  ];

  const prayers: PrayerTimeInfo[] = prayerTimes.map((prayer) => ({
    ...prayer,
    passed: prayer.time.getTime() < now,
  }));

  return { prayers, qiblaDirection, date: prayerDate };
}

export function getNextPrayer(
  latitude: number,
  longitude: number,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi',
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): PrayerTimeInfo | null {
  const now = new Date();
  const today = calculatePrayerTimes(latitude, longitude, now, calcMethod, asrMadhab, timeZone);
  const upcoming = today.prayers.filter((p) => p.name !== 'sunrise' && p.time.getTime() > now.getTime());
  if (upcoming.length > 0) {
    return upcoming[0];
  }

  const tomorrowTimes = calculatePrayerTimesForDay(
    latitude,
    longitude,
    addCalendarDays(calendarDayInZone(now, timeZone), 1),
    calcMethod,
    asrMadhab,
  );
  return tomorrowTimes.prayers.find((p) => p.name !== 'sunrise') ?? tomorrowTimes.prayers[0];
}

export function getPrayerTimeZone(timeZone?: string, cityName?: string): string {
  if (timeZone && isTimeZone(timeZone)) return timeZone;
  return CITY_PRESETS.find((city) => city.name === cityName)?.timeZone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A calendar day, independent of any time zone (month is 1-based). */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** Which calendar day `date` falls on *in* `timeZone` — the city's day, not the device's. */
export function calendarDayInZone(date: Date, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

/** Move a calendar day by whole days. Day arithmetic happens on numbers, never on a Date. */
export function addCalendarDays(day: CalendarDay, days: number): CalendarDay {
  // Date.UTC normalises overflow (e.g. month 13, day 32) into the right day/month/year.
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/**
 * Noon of a calendar day **in the device's zone**.
 *
 * adhan reads `getFullYear()/getMonth()/getDate()` off the date it is given, so the day
 * must be presented as a local date the device will render as the intended one. This is
 * the only place a prayer day is turned back into a `Date`.
 */
function calendarDayToDate(day: CalendarDay): Date {
  return new Date(day.year, day.month - 1, day.day, 12);
}

/** Device-local noon of the calendar day `date` falls on in `timeZone`. */
export function getDateInTimeZone(date: Date, timeZone: string): Date {
  return calendarDayToDate(calendarDayInZone(date, timeZone));
}

export function formatTime12h(
  date: Date,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute} ${values.dayPeriod === 'PM' ? 'م' : 'ص'}`;
}

/**
 * Human-readable time left until `date`.
 *
 * `now` is injectable so callers that already re-render on a timer (e.g. HomeScreen)
 * stay in sync with a single clock instead of each call reading a fresh `Date()`.
 */
export function getTimeUntil(date: Date, now: Date = new Date()): string {
  const diff = date.getTime() - now.getTime();
  if (diff <= 0) return 'حَانَ الآنْ';

  const totalSeconds = Math.ceil(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  // If more than 1 hour, show hours
  if (hours >= 1) {
    const hourText = hours === 1 ? 'ساعة' : hours === 2 ? 'ساعتين' : `${hours} ساعات`;
    if (minutes === 0 && seconds === 0) {
      return `بعد ${hourText}`;
    }
    if (minutes === 0) {
      return `بعد ${hourText}`;
    }
    const minText = minutes === 1 ? 'دقيقة' : minutes === 2 ? 'دقيقتين' : `${minutes} دقيقة`;
    return `بعد ${hourText} و ${minText}`;
  }

  // Less than 1 hour - show minutes
  if (minutes >= 1) {
    if (minutes === 1) {
      return `بعد دقيقة واحدة`;
    }
    if (minutes === 2) {
      return `بعد دقيقتين`;
    }
    if (minutes <= 10) {
      return `بعد ${minutes} دقائق`;
    }
    // For 11-59 minutes, just show the number
    return `بعد ${minutes} دقيقة`;
  }

  // Less than 1 minute - show seconds
  if (seconds === 0) {
    return 'خلال أقل من دقيقة';
  }
  if (seconds === 1) {
    return 'خلال ثانية واحدة';
  }
  if (seconds <= 10) {
    return `خلال ${seconds} ثوانٍ`;
  }
  return `خلال ${seconds} ثانية`;
}

export const CALC_METHODS = [
  'Egyptian',
  'MWL',
  'Karachi',
  'UMM al-Qura',
  'Dubai',
  'Moonsighting',
  'NorthAmerica',
  'Kuwait',
  'Qatar',
  'Singapore',
  'Turkey',
  'Tehran',
];

export const CALC_METHOD_NAMES_AR: Record<string, string> = {
  'Egyptian': 'الهيئة المصرية العامة للمساحة',
  'MWL': 'رابطة العالم الإسلامي',
  'Karachi': 'جامعة كراتشي',
  'UMM al-Qura': 'أم القرى',
  'Dubai': 'دبي',
  'Moonsighting': 'لجنة رؤية الهلال',
  'NorthAmerica': 'أمريكا الشمالية',
  'Kuwait': 'الكويت',
  'Qatar': 'قطر',
  'Singapore': 'سنغافورة',
  'Turkey': 'تركيا',
  'Tehran': 'طهران',
};

export interface CityPreset {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export const CITY_PRESETS: CityPreset[] = [
  { name: 'القاهرة', latitude: 30.0444, longitude: 31.2357, timeZone: 'Africa/Cairo' },
  { name: 'مكة المكرمة', latitude: 21.4225, longitude: 39.8262, timeZone: 'Asia/Riyadh' },
  { name: 'المدينة المنورة', latitude: 24.5247, longitude: 39.5692, timeZone: 'Asia/Riyadh' },
  { name: 'الرياض', latitude: 24.7136, longitude: 46.6753, timeZone: 'Asia/Riyadh' },
  { name: 'الإسكندرية', latitude: 31.2001, longitude: 29.9187, timeZone: 'Africa/Cairo' },
  { name: 'بيروت', latitude: 33.8938, longitude: 35.5018, timeZone: 'Asia/Beirut' },
  { name: 'عمّان', latitude: 31.9454, longitude: 35.9284, timeZone: 'Asia/Amman' },
  { name: 'بغداد', latitude: 33.3152, longitude: 44.3661, timeZone: 'Asia/Baghdad' },
  { name: 'دمشق', latitude: 33.5138, longitude: 36.2765, timeZone: 'Asia/Damascus' },
  { name: 'الجزائر', latitude: 36.7538, longitude: 3.0588, timeZone: 'Africa/Algiers' },
  { name: 'تونس', latitude: 36.8065, longitude: 10.1815, timeZone: 'Africa/Tunis' },
  { name: 'الرباط', latitude: 34.0209, longitude: -6.8416, timeZone: 'Africa/Casablanca' },
  { name: 'الدوحة', latitude: 25.2854, longitude: 51.531, timeZone: 'Asia/Qatar' },
  { name: 'الكويت', latitude: 29.3759, longitude: 47.9774, timeZone: 'Asia/Kuwait' },
  { name: 'المنامة', latitude: 26.2285, longitude: 50.586, timeZone: 'Asia/Bahrain' },
  { name: 'أبو ظبي', latitude: 24.4539, longitude: 54.3773, timeZone: 'Asia/Dubai' },
  { name: 'دبي', latitude: 25.2048, longitude: 55.2708, timeZone: 'Asia/Dubai' },
  { name: 'صنعاء', latitude: 15.3694, longitude: 44.191, timeZone: 'Asia/Aden' },
  { name: 'الخرطوم', latitude: 15.5007, longitude: 32.5599, timeZone: 'Africa/Khartoum' },
  { name: 'إسطنبول', latitude: 41.0082, longitude: 28.9784, timeZone: 'Europe/Istanbul' },
];
