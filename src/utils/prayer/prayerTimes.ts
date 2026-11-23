import {
  Coordinates,
  CalculationMethod,
  CalculationParameters,
  HighLatitudeRule,
  PrayerTimes,
  Qibla,
  Madhab,
} from 'adhan';
import { trustedNow, trustedNowMs } from '@/utils/clock';
// The app's own copy of the IANA time-zone database. WebView engines never update
// once the phone ships, so the platform's rules rot: a 2018 engine believes Egypt
// never restored summer time, and every zone the calendar touches would drift an
// hour whenever its country changed the rules. Shipping the database inside the
// bundle makes the answer identical on every engine, everywhere, forever.
import { Instant, ZoneId, ZonedDateTime } from '@js-joda/core';
import '@js-joda/timezone';

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

/** The five prayers with an adhan and a congregation time; sunrise is not a prayer. */
export type PrayerTimeKey = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

/** Per-prayer minute corrections used to match a trusted local mosque timetable. */
export type PrayerTimeAdjustments = Partial<Record<PrayerTimeKey, number>>;

export function getCalcMethod(_method: string): CalculationParameters {
  const params = CalculationMethod.Egyptian();
  // The ESA reference samples show adhan's preset Dhuhr minute adjustment makes
  // the result later than the published time; removing it brings all samples
  // within one minute of the official timetable.
  params.methodAdjustments.dhuhr = 0;
  return params;
}

/** Egypt-only bounds for prayer locations; saved coordinates remain usable offline. */
export function isEgyptianLocation(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= 21.7 &&
    latitude <= 31.9 &&
    longitude >= 24.6 &&
    longitude <= 37.0;
}

/**
 * The app's own default position — the same one DEFAULT_SETTINGS ships with — kept
 * here so a missing or corrupt coordinate never reaches adhan. `undefined` (a
 * partially saved settings row) or `NaN` used to flow straight into the prayer
 * calculation, where every time came out as an Invalid Date.
 */
const FALLBACK_LATITUDE = 30.0444;
const FALLBACK_LONGITUDE = 31.2357;

function finiteCoordinate(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Every time on this day that adhan could actually compute.
 *
 * Past the polar circles the sun can stay above (or below) the working angles for
 * the whole day, and adhan then returns nothing at all for fajr, sunrise, maghrib
 * or isha — not a wrong time, an absent one. Those entries are dropped rather than
 * passed on: an Invalid Date downstream is not harmless. `NaN` sails through the
 * azan scheduler's window comparisons (`lateBy < 0 || lateBy > CATCH_UP_MS` is
 * false for NaN), so a day of missing times used to be able to fire the adhan out
 * of nowhere.
 */
function finitePrayerTimes(pt: PrayerTimes): { name: string; arabicName: string; time: Date }[] {
  const all = [
    { name: 'fajr', arabicName: 'الفجر', time: pt.fajr },
    { name: 'sunrise', arabicName: 'الشروق', time: pt.sunrise },
    { name: 'dhuhr', arabicName: 'الظهر', time: pt.dhuhr },
    { name: 'asr', arabicName: 'العصر', time: pt.asr },
    { name: 'maghrib', arabicName: 'المغرب', time: pt.maghrib },
    { name: 'isha', arabicName: 'العشاء', time: pt.isha },
  ];
  return all.filter((prayer) => Number.isFinite(prayer.time.getTime()));
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
  adjustments?: PrayerTimeAdjustments | null,
): PrayerTimesResult {
  return calculatePrayerTimesForDay(
    latitude,
    longitude,
    calendarDayInZone(date, timeZone),
    calcMethod,
    asrMadhab,
    adjustments,
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
  adjustments?: PrayerTimeAdjustments | null,
): PrayerTimesResult {
  const coords = new Coordinates(
    finiteCoordinate(latitude, FALLBACK_LATITUDE),
    finiteCoordinate(longitude, FALLBACK_LONGITUDE),
  );
  const params = getCalcMethod(calcMethod);
  params.madhab = asrMadhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  // Named rather than left to the library's default, so the far-north behaviour is
  // pinned here: a night that never darkens to the fajr angle is reckoned from the
  // middle of the night, which is adhan's own recommendation.
  params.highLatitudeRule = HighLatitudeRule.MiddleOfTheNight;

  const prayerDate = calendarDayToDate(day);
  const pt = new PrayerTimes(coords, prayerDate, params);
  const qiblaDirection = Qibla(coords);

  const now = trustedNowMs();
  const prayers: PrayerTimeInfo[] = finitePrayerTimes(pt).map((prayer) => {
    const time = applyPrayerTimeAdjustment(prayer.time, prayer.name, adjustments);
    return { ...prayer, time, passed: time.getTime() < now };
  });

  return { prayers, qiblaDirection, date: prayerDate };
}

export function getNextPrayer(
  latitude: number,
  longitude: number,
  calcMethod: string,
  asrMadhab: 'standard' | 'hanafi',
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  adjustments?: PrayerTimeAdjustments | null,
): PrayerTimeInfo | null {
  const now = trustedNow();
  const today = calculatePrayerTimes(
    latitude, longitude, now, calcMethod, asrMadhab, timeZone, adjustments,
  );
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
    adjustments,
  );
  return tomorrowTimes.prayers.find((p) => p.name !== 'sunrise') ?? tomorrowTimes.prayers[0] ?? null;
}

const MAX_PRAYER_TIME_ADJUSTMENT_MINUTES = 30;

function applyPrayerTimeAdjustment(
  time: Date,
  prayerName: string,
  adjustments?: PrayerTimeAdjustments | null,
): Date {
  const minutes = adjustments?.[prayerName as IqamahPrayerKey];
  if (
    prayerName === 'sunrise' ||
    typeof minutes !== 'number' ||
    !Number.isFinite(minutes)
  ) {
    return time;
  }
  const boundedMinutes = Math.min(
    Math.max(Math.trunc(minutes), -MAX_PRAYER_TIME_ADJUSTMENT_MINUTES),
    MAX_PRAYER_TIME_ADJUSTMENT_MINUTES,
  );
  return new Date(time.getTime() + boundedMinutes * 60_000);
}

export function getPrayerTimeZone(_timeZone?: string, _cityName?: string): string {
  return 'Africa/Cairo';
}

/* ------------------------------------------------------------------ *
 * Iqamah (الإقامة) — the جماعة's own minute, offset from the adhan.
 * ------------------------------------------------------------------ */

/** The five prayers an iqamah offset is addressed by (sunrise has none). */
export type IqamahPrayerKey = PrayerTimeKey;

/**
 * Minutes each prayer's iqamah follows its adhan, by common mosque custom:
 * fajr given longer to gather, maghrib straight behind the call, the rest ten.
 * Per-prayer because a single global number never matches any real mosque.
 */
export const DEFAULT_IQAMAH_OFFSETS: Record<IqamahPrayerKey, number> = {
  fajr: 20,
  dhuhr: 10,
  asr: 10,
  maghrib: 5,
  isha: 10,
};

/**
 * Anything past two hours is a typo, not a جماعة — clamped here rather than at
 * the input, so a bad stored row can never schedule tomorrow's iqamah today.
 */
const IQAMAH_MAX_MINUTES = 120;

/**
 * The iqamah instant for one prayer: its adhan plus the offset in force,
 * falling back per key to {@link DEFAULT_IQAMAH_OFFSETS} — a partially saved
 * offsets row (or none at all, on installs from before the field existed)
 * still yields every prayer's proper minute. Unknown keys (sunrise) get 0,
 * which callers never ask for anyway.
 */
export function getIqamahTime(
  prayerTime: Date,
  prayerKey: string,
  offsets?: Partial<Record<string, number>> | null,
): Date {
  const raw = offsets?.[prayerKey];
  const fallback = (DEFAULT_IQAMAH_OFFSETS as Record<string, number>)[prayerKey] ?? 0;
  const minutes = typeof raw === 'number' && Number.isFinite(raw)
    ? Math.trunc(raw)
    : fallback;
  const bounded = Math.min(Math.max(minutes, 0), IQAMAH_MAX_MINUTES);
  return new Date(prayerTime.getTime() + bounded * 60_000);
}

/** A calendar day, independent of any time zone (month is 1-based). */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/**
 * The UTC offset `timeZone` observes at the instant `at`.
 *
 * Three layers, most trustworthy first:
 *
 *  1. the handwritten rules the app carries for the zones this calendar was
 *     shipped against (Egypt — field-proven on engines as old as WebView 70);
 *  2. the IANA database shipped inside the bundle — correct for *every* zone on
 *     *every* engine, which is what makes a phone from any factory, any country
 *     and any vintage show the same wall clock;
 *  3. the platform's own ICU, only where both the bundle and the database fail
 *     to recognise the name (a zone added after the bundle shipped, say).
 */
export function zoneOffsetMs(timeZone: string, at: Date): number {
  return bundledZoneOffsetMs(timeZone, at)
    ?? tzDatabaseZoneOffsetMs(timeZone, at)
    ?? platformZoneOffsetMs(timeZone, at);
}

const HOUR_MS = 3_600_000;

/**
 * Summer time in Egypt, restored in 2023 and repeating: it begins local
 * midnight on the last Friday of April (00:00 at +02 → 01:00 at +03) and ends
 * local midnight on the morning of that Friday in October (00:00 at +03 →
 * 23:00 the previous day at +02). Expressed in UTC both boundaries are that
 * same Friday, two and three hours before its UTC midnight.
 *
 * Years before 2023 answer nothing here — the platform's own data is right for
 * those — so `null` hands the question back to it.
 */
function egyptOffsetMs(at: Date): number | null {
  const year = at.getUTCFullYear();
  if (year < 2023) return null;

  const lastFridayIn = (monthIndex: number): number => {
    // Day 0 of the following month is the last day of this one; walk it back
    // to Friday (5) by however many days it sits past it.
    const lastOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0));
    lastOfMonth.setUTCDate(lastOfMonth.getUTCDate() - ((lastOfMonth.getUTCDay() - 5 + 7) % 7));
    return lastOfMonth.getTime();
  };

  const dstStarts = lastFridayIn(3) - 2 * HOUR_MS;
  const dstEnds = lastFridayIn(9) - 3 * HOUR_MS;
  return at.getTime() >= dstStarts && at.getTime() < dstEnds ? 3 * HOUR_MS : 2 * HOUR_MS;
}

/** Offset rules the app carries itself, `null` wherever the database must answer. */
function bundledZoneOffsetMs(timeZone: string, at: Date): number | null {
  // 'Egypt' is the zone's legacy alias; both name the same rules.
  if (timeZone === 'Africa/Cairo' || timeZone === 'Egypt') return egyptOffsetMs(at);
  return null;
}

/**
 * The offset the bundled IANA database reports for `timeZone`.
 *
 * Every rule for every zone ships inside the bundle, so this answers identically
 * on a 2018 WebView and on last year's — the layer that makes the app portable
 * beyond Egypt: a Moroccan, Jordanian or travelling reader gets their own
 * country's transitions, including ones the platform's stale data has never
 * heard of. An unrecognised name throws and is treated as "the database says
 * nothing", handing the question to the platform.
 */
function tzDatabaseZoneOffsetMs(timeZone: string, at: Date): number | null {
  try {
    const zoned = ZonedDateTime.ofInstant(
      Instant.ofEpochMilli(at.getTime()),
      ZoneId.of(timeZone),
    );
    return zoned.offset().totalSeconds() * 1000;
  } catch {
    return null;
  }
}

/**
 * The offset the platform itself believes for `timeZone`.
 *
 * The formatter is cached per zone: the countdown re-renders its screen every
 * second, and constructing an `Intl.DateTimeFormat` per call is far too dear.
 * `hour12: false` rather than `hourCycle` — engines this old predate the latter.
 */
const zoneOffsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function platformZoneOffsetMs(timeZone: string, at: Date): number {
  let formatter = zoneOffsetFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    zoneOffsetFormatterCache.set(timeZone, formatter);
  }

  const values: Record<string, string> = {};
  for (const { type, value } of formatter.formatToParts(at)) values[type] = value;

  // Wall-clock in the zone, read as if it were UTC; measured against the true
  // instant the difference *is* the offset. Seconds are part of both sides so
  // they cancel, and only sub-second fields would be left over — hence the
  // milliseconds stripped from the instant.
  const wallClock = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour) % 24,
    Number(values.minute),
    Number(values.second),
  );
  return wallClock - (at.getTime() - at.getMilliseconds());
}

/**
 * Which calendar day `date` falls on *in* `timeZone` — the city's day, not the device's.
 *
 * The day comes from the zone's offset ({@link zoneOffsetMs}), never from how the
 * engine happens to format: a stale ICU must not be able to push a prayer to
 * the wrong side of midnight either.
 */
export function calendarDayInZone(date: Date, timeZone: string): CalendarDay {
  const shifted = new Date(date.getTime() + zoneOffsetMs(timeZone, date));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
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

/**
 * `5:30 ص` / `12:42 م` — the prayer times the reader actually sees.
 *
 * The wall clock is derived from the zone's own offset ({@link zoneOffsetMs})
 * and the UTC fields of the shifted instant, so an engine whose tzdata predates
 * Egypt's summer time cannot render the table an hour behind the official
 * times. Formatting by offset and reading UTC is the same arithmetic a
 * formatter does internally — it just starts from rules the app controls.
 */
export function formatTime12h(
  date: Date,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const shifted = new Date(date.getTime() + zoneOffsetMs(timeZone, date));
  const hour24 = shifted.getUTCHours();
  const hour12 = hour24 % 12 || 12;
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hour12}:${minute} ${hour24 < 12 ? 'ص' : 'م'}`;
}

/**
 * Human-readable time left until `date`.
 *
 * `now` is injectable so callers that already re-render on a timer (e.g. HomeScreen)
 * stay in sync with a single clock instead of each call reading a fresh `Date()`.
 */
export function getTimeUntil(date: Date, now: Date = trustedNow()): string {
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
];

export const CALC_METHOD_NAMES_AR: Record<string, string> = {
  'Egyptian': 'الهيئة المصرية العامة للمساحة',
};

export interface CityPreset {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export const CITY_PRESETS: CityPreset[] = [
  { name: 'القاهرة', latitude: 30.0444, longitude: 31.2357, timeZone: 'Africa/Cairo' },
  { name: 'الإسكندرية', latitude: 31.2001, longitude: 29.9187, timeZone: 'Africa/Cairo' },
  { name: 'الجيزة', latitude: 30.0131, longitude: 31.2089, timeZone: 'Africa/Cairo' },
  { name: 'بنها', latitude: 30.4667, longitude: 31.1833, timeZone: 'Africa/Cairo' },
  { name: 'طنطا', latitude: 30.7865, longitude: 31.0004, timeZone: 'Africa/Cairo' },
  { name: 'شبين الكوم', latitude: 30.5526, longitude: 31.0090, timeZone: 'Africa/Cairo' },
  { name: 'دمنهور', latitude: 31.0341, longitude: 30.4682, timeZone: 'Africa/Cairo' },
  { name: 'كفر الشيخ', latitude: 31.1117, longitude: 30.9399, timeZone: 'Africa/Cairo' },
  { name: 'دمياط', latitude: 31.4165, longitude: 31.8133, timeZone: 'Africa/Cairo' },
  { name: 'المنصورة', latitude: 31.0409, longitude: 31.3785, timeZone: 'Africa/Cairo' },
  { name: 'الزقازيق', latitude: 30.5877, longitude: 31.5020, timeZone: 'Africa/Cairo' },
  { name: 'الإسماعيلية', latitude: 30.5965, longitude: 32.2715, timeZone: 'Africa/Cairo' },
  { name: 'بورسعيد', latitude: 31.2653, longitude: 32.3019, timeZone: 'Africa/Cairo' },
  { name: 'السويس', latitude: 29.9668, longitude: 32.5498, timeZone: 'Africa/Cairo' },
  { name: 'العريش', latitude: 31.1316, longitude: 33.7984, timeZone: 'Africa/Cairo' },
  { name: 'الطور', latitude: 28.2417, longitude: 33.6222, timeZone: 'Africa/Cairo' },
  { name: 'بني سويف', latitude: 29.0661, longitude: 31.0994, timeZone: 'Africa/Cairo' },
  { name: 'الفيوم', latitude: 29.3084, longitude: 30.8428, timeZone: 'Africa/Cairo' },
  { name: 'المنيا', latitude: 28.1099, longitude: 30.7503, timeZone: 'Africa/Cairo' },
  { name: 'أسيوط', latitude: 27.1809, longitude: 31.1837, timeZone: 'Africa/Cairo' },
  { name: 'سوهاج', latitude: 26.5569, longitude: 31.6948, timeZone: 'Africa/Cairo' },
  { name: 'قنا', latitude: 26.1551, longitude: 32.7160, timeZone: 'Africa/Cairo' },
  { name: 'الأقصر', latitude: 25.6872, longitude: 32.6396, timeZone: 'Africa/Cairo' },
  { name: 'أسوان', latitude: 24.0889, longitude: 32.8998, timeZone: 'Africa/Cairo' },
  { name: 'الغردقة', latitude: 27.2579, longitude: 33.8116, timeZone: 'Africa/Cairo' },
  { name: 'مرسى مطروح', latitude: 31.3543, longitude: 27.2373, timeZone: 'Africa/Cairo' },
  { name: 'الخارجة', latitude: 25.4390, longitude: 30.5586, timeZone: 'Africa/Cairo' },
];
