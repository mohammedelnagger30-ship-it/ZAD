import Dexie, { type Table } from 'dexie';

// ---- Types ----

export type TaskStatus = 'pending' | 'done' | 'missed' | 'snoozed';
export type TaskType = 'hifz' | 'muraja';
export type StrengthRating = 'weak' | 'medium' | 'strong';

export interface HifzPlan {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  syncPlaceholder?: boolean;
  name: string;
  type: TaskType;
  portion: string; // e.g. "surah:2:1-5" or "juz:30"
  progressionId?: string;
  portionSequence?: string[];
  daysOfWeek: number[]; // 0=Sun..6=Sat
  time: string; // "HH:MM"
  createdAt: number;
  active: boolean;
}

export interface DailyTask {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  planId: number;
  planSyncId?: string;
  date: string; // "YYYY-MM-DD"
  type: TaskType;
  portion: string;
  scheduledTime: string; // "HH:MM"
  status: TaskStatus;
  confirmedAt?: number;
  snoozedUntil?: number;
  strength?: StrengthRating;
  createdAt: number;
}

export interface Bookmark {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  surahId: number;
  ayahNumber: number;
  note?: string;
  createdAt: number;
}

/**
 * A whole mushaf page marked for later. Separate from `Bookmark` because that one is
 * ayah-scoped, and these are keyed by page number — which is unique, so it is the
 * primary key rather than an auto-increment id (an incrementing key would hand out ids
 * that have nothing to do with the page).
 */
export interface PageBookmark {
  page: number;
  syncId?: string;
  syncModifiedAt?: number;
  createdAt: number;
}

export interface PrayerRecord {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  date: string;
  prayer: string; // fajr, dhuhr, asr, maghrib, isha
  status: 'ontime' | 'late' | 'missed' | null;
  confirmedAt?: number;
}

export interface SunnahRecord {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  date: string;
  type: string; // witr, duha, rawatib_fajr, etc
  done: boolean;
}

export type ProgressType = 'memorized' | 'reviewing' | 'strong' | 'weak';

export interface HifzProgress {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  surahId: number;
  ayahStart: number;
  ayahEnd: number;
  status: ProgressType;
  ratedAt: number;
}

export interface HadithFavorite {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  hadithId: string;
  collection: string;
  createdAt: number;
}

export interface Settings {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  theme: 'light' | 'dark' | 'system';
  colorPalette: 'emerald' | 'ocean' | 'plum' | 'sand';
  fontSize: number; // Quran font size in px
  notificationSound: boolean;
  adhanSound: boolean;
  adhanVoiceId: string;
  randomDhikrEnabled: boolean;
  randomDhikrIntervalMinutes: number;
  randomDhikrStartTime: string;
  randomDhikrEndTime: string;
  snoozeMinutes: number;
  prePrayerReminder: number; // minutes before, 0 = off
  calcMethod: string; // adhan calculation method
  asrMadhab: 'standard' | 'hanafi';
  latitude?: number;
  longitude?: number;
  cityName?: string;
  locationMethod: 'manual' | 'auto';
}

export interface DayStreak {
  date: string;
  allDone: boolean;
  partial: boolean;
}

// ---- Database ----

export class HifziDB extends Dexie {
  plans!: Table<HifzPlan, number>;
  tasks!: Table<DailyTask, number>;
  bookmarks!: Table<Bookmark, number>;
  pageBookmarks!: Table<PageBookmark, number>;
  prayerRecords!: Table<PrayerRecord, number>;
  sunnahRecords!: Table<SunnahRecord, number>;
  hifzProgress!: Table<HifzProgress, number>;
  hadithFavorites!: Table<HadithFavorite, number>;
  settings!: Table<Settings, number>;

  constructor() {
    super('hifzi-db');
    this.version(1).stores({
      plans: '++id, active, type',
      tasks: '++id, date, planId, status, type, scheduledTime',
      bookmarks: '++id, surahId, ayahNumber',
      prayerRecords: '++id, date, prayer',
      sunnahRecords: '++id, date, type',
      hifzProgress: '++id, surahId, status',
      hadithFavorites: '++id, hadithId, collection',
      settings: '++id',
      // v1 defined a `streaks` table that was never read or written. Dropping it here
      // also removes it from new databases.
      streaks: 'date, allDone',
    });

    // v2: compound indexes for the weekly/monthly stat queries, which previously had
    // to scan every row. `streaks` is removed (see note above).
    this.version(2)
      .stores({
        prayerRecords: '++id, date, prayer, [date+prayer]',
        tasks: '++id, date, planId, status, type, scheduledTime, [date+status]',
        sunnahRecords: '++id, date, type, [date+type]',
      })
      .upgrade(async (tx) => {
        await tx.table('streaks').clear();

        // Settings were written with a read-then-`add` race, so some installs ended up
        // with duplicate rows. Collapse them onto a single canonical row.
        const table = tx.table<Settings, number>('settings');
        const rows = await table.toArray();
        if (rows.length > 1) {
          const [keep, ...duplicates] = rows;
          await table.put({ ...keep });
          await table.bulkDelete(
            duplicates.filter((d) => d.id !== keep.id).map((d) => d.id!)
          );
        }
      });

    // v3: page-scoped bookmarks for the mushaf reader. They used to live in component
    // state only, so every mark was gone the moment the reader was closed.
    this.version(3).stores({
      pageBookmarks: 'page, createdAt',
    });

    // v4: stable record identities allow cloud sync to merge rows across devices
    // without relying on device-local auto-increment IDs.
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        const syncableTables = [
          'settings', 'plans', 'tasks', 'bookmarks', 'pageBookmarks',
          'prayerRecords', 'sunnahRecords', 'hifzProgress', 'hadithFavorites',
        ];
        const plans = await tx.table('plans').toArray();
        const planSyncIds = new Map<number, string>();
        for (const row of plans) {
          const syncId = legacySyncId('plans', row, 0);
          if (typeof row.id === 'number') planSyncIds.set(row.id, syncId);
        }
        for (const name of syncableTables) {
          const table = tx.table(name);
          const rows = await table.toArray();
          await table.bulkPut(rows.map((row: Record<string, unknown>, index: number) => ({
            ...row,
            syncId: name === 'tasks' && typeof row.planId === 'number'
              ? `task:${planSyncIds.get(row.planId) ?? row.planId}:${row.date}:${row.type}:${row.portion}`
              : legacySyncId(name, row, index),
            ...(name === 'tasks' && typeof row.planId === 'number'
              ? { planSyncId: planSyncIds.get(row.planId) }
              : {}),
            syncModifiedAt: 0,
          })));
        }
      });
  }
}

export const db = new HifziDB();

function legacySyncId(table: string, row: Record<string, unknown>, index: number): string {
  switch (table) {
    case 'settings': return 'settings';
    case 'pageBookmarks': return `page:${row.page}`;
    case 'prayerRecords': return `${row.date}:${row.prayer}`;
    case 'sunnahRecords': return `${row.date}:${row.type}`;
    case 'hadithFavorites': return `${row.collection}:${row.hadithId}`;
    case 'plans': return `plan:${row.createdAt}:${row.type}:${row.portion}:${row.time}`;
    case 'bookmarks': return `bookmark:${row.surahId}:${row.ayahNumber}`;
    case 'hifzProgress': return `progress:${row.surahId}:${row.ayahStart}:${row.ayahEnd}:${row.ratedAt}`;
    default: return `legacy:${table}:${row.id ?? index}`;
  }
}

/** The settings table must hold exactly one row; this is its primary key. */
const SETTINGS_ROW_ID = 1;

// ---- Default settings ----

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  colorPalette: 'emerald',
  fontSize: 28,
  notificationSound: true,
  adhanSound: true,
  adhanVoiceId: 'asim_javed',
  randomDhikrEnabled: false,
  randomDhikrIntervalMinutes: 60,
  randomDhikrStartTime: '09:00',
  randomDhikrEndTime: '21:00',
  snoozeMinutes: 15,
  prePrayerReminder: 10,
  calcMethod: 'Egyptian',
  asrMadhab: 'standard',
  locationMethod: 'manual',
  cityName: 'القاهرة',
  latitude: 30.0444,
  longitude: 31.2357,
};

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.toArray();
  if (existing.length === 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, id: SETTINGS_ROW_ID });
    return DEFAULT_SETTINGS;
  }
  // Rows are kept sorted by id so the read result is deterministic.
  const first = existing.reduce((min, row) => (row.id! < min.id! ? row : min));
  // Earlier versions initialized fresh installs to Makkah with auto location enabled.
  // Migrate only that exact untouched default; manually selected cities and GPS fixes
  // have different names/methods and are deliberately preserved.
  const isLegacyDefaultLocation =
    first.locationMethod === 'auto' &&
    first.cityName === 'مكة المكرمة' &&
    first.latitude === 21.4225 &&
    first.longitude === 39.8262;
  const settings = { ...DEFAULT_SETTINGS, ...first };
  if (isLegacyDefaultLocation) {
    Object.assign(settings, {
      locationMethod: DEFAULT_SETTINGS.locationMethod,
      cityName: DEFAULT_SETTINGS.cityName,
      latitude: DEFAULT_SETTINGS.latitude,
      longitude: DEFAULT_SETTINGS.longitude,
    });
    await db.settings.update(first.id!, {
      locationMethod: DEFAULT_SETTINGS.locationMethod,
      cityName: DEFAULT_SETTINGS.cityName,
      latitude: DEFAULT_SETTINGS.latitude,
      longitude: DEFAULT_SETTINGS.longitude,
    });
  }
  return settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  // Always update the canonical row — never `add`, otherwise concurrent callers
  // (onboarding + theme hook + settings screen) can each insert their own row.
  const existing = await db.settings.toArray();
  const target =
    existing.length === 0
      ? SETTINGS_ROW_ID
      : existing.reduce((min, row) => (row.id! < min.id! ? row : min)).id!;

  if (existing.length === 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, ...patch, id: SETTINGS_ROW_ID });
    return;
  }
  await db.settings.update(target, { ...patch, id: SETTINGS_ROW_ID });
}
