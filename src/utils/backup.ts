import { ADHKAR_CATEGORIES } from '@/data/adhkar';
import { TOTAL_QURAN_PAGES } from '@/data/surahs';

/**
 * Backup export/import validation.
 *
 * Every table that enters an imported file must pass `isValidBackupRow` before
 * a single row is written — the file is user-supplied input, so the checks are
 * deliberately strict (types, ranges, date shapes) and live here away from any
 * component so they can be reasoned about and tested on their own.
 */

export const BACKUP_TABLES = [
  'settings',
  'plans',
  'tasks',
  'bookmarks',
  'pageBookmarks',
  'prayerRecords',
  'sunnahRecords',
  'hifzProgress',
  'hadithFavorites',
  'khatmah',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export const IGNORED_BACKUP_KEYS = ['_exportDate', 'streaks'];

/** localStorage key holding the adhkar counters — carried in backups as `adhkar`. */
export const ADHKAR_STATE_KEY = 'hifzi-adhkar-state';

export function isValidAdhkarBackup(value: unknown): value is {
  day: string;
  counts: Record<string, number>;
  favorites: string[];
  fontSize: number;
  haptics: boolean;
} {
  if (!isRecord(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return false;
  if (!isRecord(value.counts) || !Array.isArray(value.favorites)) return false;
  const adhkar = ADHKAR_CATEGORIES.flatMap((category) => category.items);
  const countsValid = Object.entries(value.counts).every(([id, count]) => {
    const item = adhkar.find((dhikr) => dhikr.id === id);
    return !!item && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= item.count;
  });
  return (
    countsValid &&
    value.favorites.every((id) => typeof id === 'string' && adhkar.some((item) => item.id === id)) &&
    typeof value.fontSize === 'number' &&
    Number.isFinite(value.fontSize) &&
    value.fontSize >= 18 &&
    value.fontSize <= 32 &&
    typeof value.haptics === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isValidBackupRow(table: BackupTable, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && (!Number.isInteger(value.id) || (value.id as number) < 1)) return false;

  switch (table) {
    case 'settings':
      return (
        Object.keys(value).some((key) =>
          [
            'theme',
            'colorPalette',
            'fontSize',
            'notificationSound',
            'adhanSound',
            'adhanVoiceId',
            'randomDhikrEnabled',
            'randomDhikrCategory',
            'randomDhikrIntervalMinutes',
            'randomDhikrStartTime',
            'randomDhikrEndTime',
            'snoozeMinutes',
            'prePrayerReminder',
            'calcMethod',
            'asrMadhab',
            'locationMethod',
            'timeZone',
            'hijriAdjustment',
          ].includes(key)
        ) &&
        (value.theme === undefined || ['light', 'dark', 'system'].includes(value.theme as string)) &&
        (value.colorPalette === undefined || ['emerald', 'ocean', 'plum', 'sand'].includes(value.colorPalette as string)) &&
        (value.fontSize === undefined || isFiniteNumber(value.fontSize)) &&
        (value.notificationSound === undefined || typeof value.notificationSound === 'boolean') &&
        (value.adhanSound === undefined || typeof value.adhanSound === 'boolean') &&
        (value.adhanVoiceId === undefined || typeof value.adhanVoiceId === 'string') &&
        (value.randomDhikrEnabled === undefined || typeof value.randomDhikrEnabled === 'boolean') &&
        (value.randomDhikrCategory === undefined ||
          ['varied', 'morning', 'evening', 'istighfar'].includes(value.randomDhikrCategory as string)) &&
        (value.randomDhikrIntervalMinutes === undefined || isFiniteNumber(value.randomDhikrIntervalMinutes)) &&
        (value.randomDhikrStartTime === undefined || isValidTime(value.randomDhikrStartTime)) &&
        (value.randomDhikrEndTime === undefined || isValidTime(value.randomDhikrEndTime)) &&
        (value.snoozeMinutes === undefined || isFiniteNumber(value.snoozeMinutes)) &&
        (value.prePrayerReminder === undefined || isFiniteNumber(value.prePrayerReminder)) &&
        (value.calcMethod === undefined || typeof value.calcMethod === 'string') &&
        (value.asrMadhab === undefined || ['standard', 'hanafi'].includes(value.asrMadhab as string)) &&
        (value.locationMethod === undefined || ['manual', 'auto'].includes(value.locationMethod as string)) &&
        (value.latitude === undefined || isFiniteNumber(value.latitude)) &&
        (value.longitude === undefined || isFiniteNumber(value.longitude)) &&
        (value.cityName === undefined || typeof value.cityName === 'string') &&
        (value.timeZone === undefined || typeof value.timeZone === 'string') &&
        (value.hijriAdjustment === undefined || [-1, 0, 1].includes(value.hijriAdjustment as number))
      );
    case 'plans':
      return (
        typeof value.name === 'string' &&
        ['hifz', 'muraja'].includes(value.type as string) &&
        typeof value.portion === 'string' &&
        Array.isArray(value.daysOfWeek) &&
        value.daysOfWeek.every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6) &&
        isValidTime(value.time) &&
        isFiniteNumber(value.createdAt) &&
        typeof value.active === 'boolean' &&
        (value.portionSequence === undefined ||
          (Array.isArray(value.portionSequence) && value.portionSequence.every((item) => typeof item === 'string'))) &&
        (value.progressionId === undefined || typeof value.progressionId === 'string')
      );
    case 'tasks':
      return (
        Number.isInteger(value.planId) &&
        (value.planId as number) > 0 &&
        isDateKey(value.date) &&
        ['hifz', 'muraja'].includes(value.type as string) &&
        typeof value.portion === 'string' &&
        isValidTime(value.scheduledTime) &&
        ['pending', 'done', 'missed', 'snoozed'].includes(value.status as string) &&
        isFiniteNumber(value.createdAt) &&
        (value.snoozedUntil === undefined || isFiniteNumber(value.snoozedUntil)) &&
        (value.status !== 'snoozed' || isFiniteNumber(value.snoozedUntil)) &&
        (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt)) &&
        (value.strength === undefined || ['weak', 'medium', 'strong'].includes(value.strength as string))
      );
    case 'bookmarks':
      return (
        Number.isInteger(value.surahId) &&
        (value.surahId as number) >= 1 &&
        (value.surahId as number) <= 114 &&
        Number.isInteger(value.ayahNumber) &&
        (value.ayahNumber as number) >= 1 &&
        isFiniteNumber(value.createdAt) &&
        (value.note === undefined || typeof value.note === 'string')
      );
    case 'pageBookmarks':
      return (
        Number.isInteger(value.page) &&
        (value.page as number) >= 1 &&
        (value.page as number) <= TOTAL_QURAN_PAGES &&
        isFiniteNumber(value.createdAt)
      );
    case 'prayerRecords':
      return (
        isDateKey(value.date) &&
        ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(value.prayer as string) &&
        (value.status === null || ['ontime', 'late', 'missed'].includes(value.status as string)) &&
        (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt))
      );
    case 'sunnahRecords':
      return isDateKey(value.date) && typeof value.type === 'string' && typeof value.done === 'boolean';
    case 'hifzProgress':
      return (
        Number.isInteger(value.surahId) &&
        (value.surahId as number) >= 1 &&
        (value.surahId as number) <= 114 &&
        Number.isInteger(value.ayahStart) &&
        (value.ayahStart as number) >= 1 &&
        Number.isInteger(value.ayahEnd) &&
        (value.ayahEnd as number) >= (value.ayahStart as number) &&
        ['memorized', 'reviewing', 'strong', 'weak'].includes(value.status as string) &&
        isFiniteNumber(value.ratedAt)
      );
    case 'hadithFavorites':
      return typeof value.hadithId === 'string' && typeof value.collection === 'string' && isFiniteNumber(value.createdAt);
    case 'khatmah':
      return (
        isDateKey(value.startDate) &&
        (value.targetDate === null || value.targetDate === undefined || isDateKey(value.targetDate)) &&
        isFiniteNumber(value.currentPage) &&
        (value.currentPage as number) >= 0 &&
        isFiniteNumber(value.updatedAt)
      );
  }
}

function isValidTime(value: unknown): boolean {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isDateKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
