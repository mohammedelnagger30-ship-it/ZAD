import { readFile } from 'node:fs/promises';
import {
  calculatePrayerTimes,
  isEgyptianLocation,
  zoneOffsetMs,
} from '../src/utils/prayerTimes';

const EGYPT_TIME_ZONE = 'Africa/Cairo';
const MAX_DRIFT_SECONDS = 60;
const PRAYER_NAMES = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

interface PrayerReferenceEntry {
  date: string;
  city: string;
  latitude: number;
  longitude: number;
  times: Record<(typeof PRAYER_NAMES)[number], string>;
}

interface PrayerReferenceFile {
  source: string;
  entries: PrayerReferenceEntry[];
}

function validateReferenceFile(value: unknown): PrayerReferenceFile {
  if (!value || typeof value !== 'object') {
    throw new Error('Reference data must be a JSON object.');
  }

  const candidate = value as Partial<PrayerReferenceFile>;
  let sourceUrl: URL | null = null;
  if (typeof candidate.source === 'string') {
    try {
      sourceUrl = new URL(candidate.source);
    } catch {
      sourceUrl = null;
    }
  }
  if (
    !sourceUrl ||
    sourceUrl.protocol !== 'https:' ||
    sourceUrl.hostname !== 'www.esa.gov.eg'
  ) {
    throw new Error('Set source to the official Egyptian Survey Authority URL.');
  }
  if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) {
    throw new Error('Reference data must contain at least one official timetable entry.');
  }

  for (const [index, rawEntry] of candidate.entries.entries()) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      throw new Error(`Entry ${index + 1} must be an object.`);
    }

    const entry = rawEntry as Partial<PrayerReferenceEntry>;
    if (
      typeof entry.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) ||
      new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date
    ) {
      throw new Error(`Entry ${index + 1} has an invalid ISO date.`);
    }
    if (
      typeof entry.city !== 'string' ||
      !entry.city.trim() ||
      typeof entry.latitude !== 'number' ||
      typeof entry.longitude !== 'number' ||
      !isEgyptianLocation(entry.latitude, entry.longitude)
    ) {
      throw new Error(`Entry ${index + 1} must have a city and valid Egyptian coordinates.`);
    }
    if (!entry.times || typeof entry.times !== 'object') {
      throw new Error(`Entry ${index + 1} is missing prayer times.`);
    }
    for (const prayer of PRAYER_NAMES) {
      const time = entry.times[prayer];
      if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        throw new Error(`Entry ${index + 1} needs ${prayer} as 24-hour HH:mm.`);
      }
    }
  }

  return candidate as PrayerReferenceFile;
}

function egyptianSecondsAfterMidnight(instant: Date): number {
  const local = new Date(instant.getTime() + zoneOffsetMs(EGYPT_TIME_ZONE, instant));
  return local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
}

function clockSecondsAfterMidnight(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 3600 + minutes * 60;
}

function shortestSecondDifference(actual: number, expected: number): number {
  return ((actual - expected + 43_200 + 86_400) % 86_400) - 43_200;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    throw new Error(
      'Usage: npm run check:prayer-reference -- <official-reference.json>\n' +
      'JSON shape: { "source": "https://www.esa.gov.eg/praytimes.aspx", "entries": [{\n' +
      '  "date": "2026-10-16", "city": "القاهرة", "latitude": 30.0444, "longitude": 31.2357,\n' +
      '  "times": { "fajr": "HH:mm", "sunrise": "HH:mm", "dhuhr": "HH:mm", ' +
      '"asr": "HH:mm", "maghrib": "HH:mm", "isha": "HH:mm" }\n' +
      '}]}. Transcribe HH:mm values from the official timetable.',
    );
  }

  const sourceFile = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const reference = validateReferenceFile(sourceFile);
  let failures = 0;

  console.log(`Comparing ${reference.entries.length} official timetable day(s) from ${reference.source}`);
  console.log(`Tolerance: ${MAX_DRIFT_SECONDS} second(s); method: Egyptian, Asr: standard`);

  for (const entry of reference.entries) {
    const date = new Date(`${entry.date}T12:00:00Z`);
    const actual = calculatePrayerTimes(
      entry.latitude,
      entry.longitude,
      date,
      'Egyptian',
      'standard',
      EGYPT_TIME_ZONE,
    );

    for (const prayerName of PRAYER_NAMES) {
      const calculated = actual.prayers.find((prayer) => prayer.name === prayerName);
      if (!calculated) {
        failures++;
        console.error(`${entry.date} ${entry.city} ${prayerName}: no calculated time`);
        continue;
      }

      const actualSeconds = egyptianSecondsAfterMidnight(calculated.time);
      const expectedSeconds = clockSecondsAfterMidnight(entry.times[prayerName]);
      const driftSeconds = shortestSecondDifference(actualSeconds, expectedSeconds);
      const actualMinute = Math.floor(actualSeconds / 60);
      const status = Math.abs(driftSeconds) <= MAX_DRIFT_SECONDS ? 'PASS' : 'FAIL';
      console.log(
        `${status} ${entry.date} ${entry.city} ${prayerName}: ` +
        `official ${entry.times[prayerName]}, app ${String(Math.floor(actualMinute / 60)).padStart(2, '0')}:` +
        `${String(actualMinute % 60).padStart(2, '0')}, drift ${driftSeconds > 0 ? '+' : ''}${driftSeconds}s`,
      );
      if (status === 'FAIL') failures++;
    }
  }

  if (failures > 0) {
    throw new Error(`${failures} prayer-time comparison(s) exceeded the allowed difference.`);
  }
  console.log('All official timetable comparisons are within tolerance.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
