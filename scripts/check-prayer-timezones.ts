import { Coordinates, PrayerTimes } from 'adhan';
import {
  calculatePrayerTimes,
  formatTime12h,
  getCalcMethod,
  getDateInTimeZone,
} from '../src/utils/prayerTimes';

process.env.TZ = 'America/Los_Angeles';

const cases = [
  { date: new Date(2026, 9, 5, 12), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
  { date: new Date(2026, 11, 1, 12), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
  { date: new Date(2026, 9, 5, 12), timeZone: 'Asia/Riyadh', latitude: 21.4225, longitude: 39.8262 },
  { date: new Date('2026-10-05T00:30:00Z'), timeZone: 'Africa/Cairo', latitude: 30.0444, longitude: 31.2357 },
];

for (const { date, timeZone, latitude, longitude } of cases) {
  const parameters = getCalcMethod('Egyptian');
  const expected = new PrayerTimes(
    new Coordinates(latitude, longitude),
    getDateInTimeZone(date, timeZone),
    parameters,
  );
  const actual = calculatePrayerTimes(latitude, longitude, date, 'Egyptian', 'standard', timeZone);
  const expectedTimes = [
    ['fajr', expected.fajr],
    ['sunrise', expected.sunrise],
    ['dhuhr', expected.dhuhr],
    ['asr', expected.asr],
    ['maghrib', expected.maghrib],
    ['isha', expected.isha],
  ] as const;

  for (const [name, wallClock] of expectedTimes) {
    const prayer = actual.prayers.find((item) => item.name === name);
    if (!prayer) throw new Error(`Missing ${name} prayer in ${timeZone}.`);
    const expectedDisplay = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(wallClock);
    const expectedArabic = expectedDisplay.replace('AM', 'ص').replace('PM', 'م');
    if (formatTime12h(prayer.time, timeZone) !== expectedArabic) {
      throw new Error(`${name} time does not match ${timeZone}: expected ${expectedArabic}.`);
    }
  }
}

console.log('Prayer times respect the selected city time zone across device zones and DST.');
