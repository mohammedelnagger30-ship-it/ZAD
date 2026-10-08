import { Coordinates, PrayerTimes } from 'adhan';
import {
  addCalendarDays,
  calculatePrayerTimes,
  calendarDayInZone,
  formatTime12h,
  getCalcMethod,
  getDateInTimeZone,
  getNextPrayer,
} from '../src/utils/prayerTimes';

// The device zone is deliberately far from every city under test. Any code path that
// reads a prayer time through the device clock instead of treating adhan's `Date` as an
// absolute instant is off by `deviceOffset − cityOffset` here — hours, and a whole
// calendar day once the gap passes 12 hours.
process.env.TZ = 'America/Los_Angeles';

const cases = [
  { label: 'Cairo (DST)', date: new Date(2026, 9, 5, 12), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
  { label: 'Cairo (standard time)', date: new Date(2026, 11, 1, 12), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
  { label: 'Makkah (no DST)', date: new Date(2026, 9, 5, 12), timeZone: 'Asia/Riyadh', latitude: 21.4225, longitude: 39.8262 },
  { label: 'Cairo just after city midnight', date: new Date('2026-10-05T00:30:00Z'), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
  // 17 hours behind the device zone: the date round-trips through the device clock.
  { label: 'Tokyo (device/city gap > 12h)', date: new Date(2026, 9, 5, 12), timeZone: 'Asia/Tokyo', latitude: 35.6762, longitude: 139.6503 },
];

const PRAYER_NAMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

function sameDay(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function describe(day: { year: number; month: number; day: number }): string {
  return `${day.year}-${day.month}-${day.day}`;
}

for (const { label, date, timeZone, latitude, longitude } of cases) {
  // adhan is the reference implementation: same coordinates, same calendar day, no
  // device clock involved. Its output defines the correct instants.
  const reference = new PrayerTimes(
    new Coordinates(latitude, longitude),
    getDateInTimeZone(date, timeZone),
    getCalcMethod('Egyptian'),
  );
  const expectedDay = calendarDayInZone(date, timeZone);
  const actual = calculatePrayerTimes(latitude, longitude, date, 'Egyptian', 'standard', timeZone);

  for (const name of PRAYER_NAMES) {
    const prayer = actual.prayers.find((item) => item.name === name);
    if (!prayer) throw new Error(`${label}: missing ${name} prayer.`);

    const instant = reference[name];

    if (prayer.time.getTime() !== instant.getTime()) {
      const driftHours = (prayer.time.getTime() - instant.getTime()) / 3_600_000;
      throw new Error(
        `${label}/${name}: instant is off by ${driftHours.toFixed(2)}h — the device zone leaked into the calculation.`,
      );
    }

    // What the user reads must be the city's own wall clock on the city's own day.
    if (formatTime12h(prayer.time, timeZone) !== formatTime12h(instant, timeZone)) {
      throw new Error(`${label}/${name}: displayed time is not the city's wall clock.`);
    }
    if (!sameDay(calendarDayInZone(prayer.time, timeZone), expectedDay)) {
      throw new Error(
        `${label}/${name}: lands on ${describe(calendarDayInZone(prayer.time, timeZone))}` +
        ` instead of the city's ${describe(expectedDay)}.`,
      );
    }
  }

  // getNextPrayer works off the real clock, so its reference is *today*, not the case date.
  const coordinates = new Coordinates(latitude, longitude);
  const todayReference = new PrayerTimes(
    coordinates,
    getDateInTimeZone(new Date(), timeZone),
    getCalcMethod('Egyptian'),
  );
  const tomorrowReference = new PrayerTimes(
    coordinates,
    getDateInTimeZone(new Date(Date.now() + 86_400_000), timeZone),
    getCalcMethod('Egyptian'),
  );
  const reachable = new Set<number>();
  for (const name of PRAYER_NAMES) {
    if (name === 'sunrise') continue;
    reachable.add(todayReference[name].getTime());
    reachable.add(tomorrowReference[name].getTime());
  }

  const next = getNextPrayer(latitude, longitude, 'Egyptian', 'standard', timeZone);
  if (!next) throw new Error(`${label}: getNextPrayer returned nothing.`);
  if (next.time.getTime() <= Date.now()) {
    throw new Error(`${label}: getNextPrayer returned ${next.name} in the past.`);
  }
  if (next.name === 'sunrise') throw new Error(`${label}: getNextPrayer returned sunrise.`);
  if (!reachable.has(next.time.getTime())) {
    throw new Error(`${label}: getNextPrayer returned ${next.name}, which is not a computed prayer instant.`);
  }
}

// The city's next day must be a plain calendar step, never a device-clock round trip.
const cairoDay = { year: 2026, month: 3, day: 31 };
const afterLeapMonth = addCalendarDays(cairoDay, 1);
if (afterLeapMonth.year !== 2026 || afterLeapMonth.month !== 4 || afterLeapMonth.day !== 1) {
  throw new Error(`addCalendarDays crossed a month boundary incorrectly: ${JSON.stringify(afterLeapMonth)}`);
}
const overYearEnd = addCalendarDays({ year: 2026, month: 12, day: 31 }, 1);
if (overYearEnd.year !== 2027 || overYearEnd.month !== 1 || overYearEnd.day !== 1) {
  throw new Error(`addCalendarDays crossed a year boundary incorrectly: ${JSON.stringify(overYearEnd)}`);
}

console.log('Prayer times respect the selected city time zone across device zones and DST.');
