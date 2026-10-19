import Dexie, { type Table } from 'dexie';
import { DEFAULT_NOTIFICATION_VOICE_ID } from '@/data/notificationSounds';
import { DEFAULT_IQAMAH_SOUND_ID } from '@/data/iqamahSound';
import { type ColorPalette } from '@/utils/colorThemes';
import {
  CITY_PRESETS,
  DEFAULT_IQAMAH_OFFSETS,
  isEgyptianLocation,
  type IqamahPrayerKey,
  type PrayerTimeAdjustments,
} from '@/utils/prayerTimes';

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
  /** Free-text note kept with the ayah. */
  note?: string;
  /**
   * Highlight colour id from `utils/ayahHighlights` — an ayah washed in a colour
   * rather than the plain bookmark wash. A colour *id*, not a CSS value, so the
   * record stays stable across themes and palette retunes. Not an index, so
   * adding it needs no schema migration — Dexie stores the value as-is.
   */
  color?: string;
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

export type HifzGrade = 'again' | 'hard' | 'good' | 'easy';

/**
 * One memorised range's spaced-repetition state (SM-2).
 *
 * Deliberately keyed by the *range* the way a hifz portion is (`surahId` +
 * `fromAyah..toAyah`), not per ayah: a memoriser thinks in portions, the quiz
 * tests a portion, and one state per portion keeps the schedule honest without
 * 6000 rows of bookkeeping. Synced across devices keyed by `key` (see v9), so a
 * grade given on one device reschedules the range on the other instead of the
 * two schedules quietly diverging.
 */
export interface HifzReview {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  /** `${surahId}:${from}-${to}` — the range this state belongs to. */
  key: string;
  surahId: number;
  fromAyah: number;
  toAyah: number;
  /** SM-2 easiness factor, starts at 2.5, floored at 1.3. */
  ease: number;
  /** Current spacing between reviews, in days. */
  intervalDays: number;
  /** Consecutive successful reviews (resets on a lapse). */
  repetitions: number;
  /** Epoch ms of the next due review. */
  dueAt: number;
  lastGrade: HifzGrade;
  lastReviewedAt: number;
  /** How many times this range has lapsed (graded «again»). */
  lapses: number;
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
  colorPalette: ColorPalette;
  fontSize: number; // Quran font size in px
  notificationSound: boolean;
  /**
   * Which voice the reminder notifications ring (hifz/review/hadith/azkar) — an id
   * from `NOTIFICATION_VOICES`, which offers the app's own chime, every adhan voice,
   * and «بدون صوت». `notificationSound` stays the master switch above it.
   */
  notificationVoiceId: string;
  adhanSound: boolean;
  adhanVoiceId: string;
  /**
   * Ring the iqamah's own recording (أذان الإقامة) at the جماعة's minute, after the
   * adhan. Master switch is `adhanSound`: with the adhan silenced there is no call to
   * repeat, so this one is read as `adhanSound && iqamahSound` everywhere it matters.
   */
  iqamahSound: boolean;
  /** Which iqamah sound to play — an id from `IQAMAH_SOUNDS`. */
  iqamahSoundId: string;
  randomDhikrEnabled: boolean;
  randomDhikrCategory: 'varied' | 'morning' | 'evening' | 'istighfar';
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
  timeZone?: string;
  /** -1 | 0 | 1 — manual correction when the displayed Hijri date is off by a day. */
  hijriAdjustment?: number;
  locationMethod: 'manual' | 'auto';
  /**
   * Line weight of every icon in the app. The ids keep the names of the icon sets the
   * weights were borrowed from — `lucide` (default, no rule), `feather` (lighter),
   * `heroicons` (heavier) — because rows in the wild already store them. Applied by
   * `App` as `data-icon-style` on <html>; index.css owns the actual stroke widths.
   */
  iconStyle?: 'lucide' | 'feather' | 'heroicons';
  /**
   * Pin the app's text scale and ignore the system's (Android's «الوضع البسيط», the font
   * size slider, the display size setting).
   *
   * The WebView multiplies every font by the system font scale, while the layout boxes are
   * laid out in px and do not move — so a larger scale makes text overflow and the whole
   * app look turned inside out. Turning this on sets `textZoom` to 100 natively and pins
   * the root font size on the web, so the app renders at its own scale regardless.
   */
  ignoreSystemFontScale?: boolean;
  /** Enable custom badge emojis */
  customBadgesEnabled?: boolean;
  /**
   * Legacy: the switch that wrote this was removed because no tips feature ever read
   * it. Kept in the type so existing rows stay valid on read, backup and sync.
   */
  showOnboardingTips?: boolean;
  /**
   * Minutes each prayer's iqamah follows its adhan (الجماعة), per mosque
   * custom. Optional so pre-iqamah rows read as defaults — `getSettings`
   * spreads DEFAULT_SETTINGS over whatever is stored, and `getIqamahTime`
   * falls back per key for a partially saved object.
   */
  iqamahOffsets?: Partial<Record<IqamahPrayerKey, number>>;
   /** Per-prayer minute corrections for matching a trusted local mosque timetable. */
   prayerTimeAdjustments?: PrayerTimeAdjustments;
}

export interface DayStreak {
  date: string;
  allDone: boolean;
  partial: boolean;
}

/** One Quran-completion (khatmah) plan: a start, an optional target date, and page progress. */
export interface KhatmahPlan {
  id?: number;
  syncId?: string;
  syncModifiedAt?: number;
  /** ISO date (YYYY-MM-DD) the plan started. */
  startDate: string;
  /** ISO date the user aims to finish by — null for an open-ended plan. */
  targetDate: string | null;
  /** Last completed mushaf page in mushaf-flow order (1-based, 0 = nothing yet). */
  currentPage: number;
  /** Epoch ms of the last change. */
  updatedAt: number;
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
  hifzReviews!: Table<HifzReview, number>;
  hadithFavorites!: Table<HadithFavorite, number>;
  settings!: Table<Settings, number>;
  khatmah!: Table<KhatmahPlan, number>;

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

    // v5: khatmah — a Quran-completion plan tracked by page progress. Kept
    // deliberately out of the v4 syncable set: it is a local reading plan, not
    // a cross-device record (syncing it later can reuse the same upgrade path).
    // It joined the synced set in v9.
    this.version(5).stores({
      khatmah: '++id, updatedAt',
    });

    // v6: Performance improvements - add compound indexes for faster queries
    // and search optimization for large datasets
    this.version(6)
      .stores({
        // Add compound indexes for efficient filtering and sorting
        hifzProgress: '++id, surahId, status, [surahId+status], ratedAt',
        bookmarks: '++id, surahId, ayahNumber, [surahId+ayahNumber], createdAt',
        hadithFavorites: '++id, hadithId, collection, [collection+hadithId], createdAt',
        // Improve task queries with date+status+type compound index
        tasks: '++id, date, planId, status, type, scheduledTime, [date+status], [date+status+type]',
        // Improve prayer records queries
        prayerRecords: '++id, date, prayer, [date+prayer], confirmedAt',
        // Improve sunnah records queries
        sunnahRecords: '++id, date, type, [date+type], done',
        // Add index for plan filtering
        plans: '++id, active, type, [active+type], createdAt',
        // Keep existing indexes for khatmah
        khatmah: '++id, updatedAt, startDate',
      })
      .upgrade(async () => {
        // No data migration needed - only index structure changes
        // This upgrade is purely for performance optimization
      });

    // v7: hifzReviews — the spaced-repetition (SM-2) schedule behind the hifz
    // quiz. A fresh table, so no migration: existing installs simply gain the
    // ability to be quizzed, and every range starts unscheduled.
    this.version(7).stores({
      hifzReviews: '++id, key, dueAt, surahId',
    });

    // v8: index `syncId` on every synced table. Cloud sync looks each incoming
    // row up by its record id, and without the index every one of those lookups
    // scanned the whole table — a merge of N records cost N full scans on every
    // sync cycle. Each lookup is now a single B-tree probe. Index-only change,
    // so Dexie rebuilds the indexes without touching row data.
    this.version(8).stores({
      settings: '++id, syncId',
      plans: '++id, active, type, [active+type], createdAt, syncId',
      tasks: '++id, date, planId, status, type, scheduledTime, [date+status], [date+status+type], syncId',
      bookmarks: '++id, surahId, ayahNumber, [surahId+ayahNumber], createdAt, syncId',
      pageBookmarks: 'page, createdAt, syncId',
      prayerRecords: '++id, date, prayer, [date+prayer], confirmedAt, syncId',
      sunnahRecords: '++id, date, type, [date+type], done, syncId',
      hifzProgress: '++id, surahId, status, [surahId+status], ratedAt, syncId',
      hadithFavorites: '++id, hadithId, collection, [collection+hadithId], createdAt, syncId',
    });

    // v9: khatmah and hifzReviews join the synced set, so `syncId` must be an
    // index on them too — every incoming record is looked up by its record id
    // (see v8), and a merge of N records would otherwise cost N full table scans.
    // Index-only change, so Dexie rebuilds the indexes without touching row data.
    this.version(9).stores({
      khatmah: '++id, updatedAt, startDate, syncId',
      hifzReviews: '++id, key, dueAt, surahId, syncId',
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
export const SETTINGS_ROW_ID = 1;

// ---- Default settings ----

export const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  colorPalette: 'ocean',
  fontSize: 28,
  notificationSound: true,
  notificationVoiceId: DEFAULT_NOTIFICATION_VOICE_ID,
  adhanSound: true,
  adhanVoiceId: 'makkah_masjid',
  iqamahSound: true,
  iqamahSoundId: DEFAULT_IQAMAH_SOUND_ID,
  randomDhikrEnabled: false,
  randomDhikrCategory: 'varied',
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
  iconStyle: 'lucide',
  ignoreSystemFontScale: false,
  customBadgesEnabled: true,
  showOnboardingTips: true,
  iqamahOffsets: { ...DEFAULT_IQAMAH_OFFSETS },
  prayerTimeAdjustments: { fajr: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
};

export async function getSettings(): Promise<Settings> {
  const existing = await db.settings.toArray();
  if (existing.length === 0) {
    await db.settings.put({ ...DEFAULT_SETTINGS, id: SETTINGS_ROW_ID });
    return DEFAULT_SETTINGS;
  }
  // Rows are kept sorted by id so the read result is deterministic.
  const first = existing.reduce((min, row) => (row.id! < min.id! ? row : min));
  // Earlier versions defaulted the adhan voice to عاصم جاويد; the Makkah adhan is now the
  // out-of-the-box voice. Migrate only that exact untouched default — a deliberately
  // chosen voice is any other value and is preserved.
  const isLegacyDefaultAdhan = first.adhanVoiceId === 'asim_javed';
  const settings = normalizeEgyptPrayerSettings({ ...DEFAULT_SETTINGS, ...first });
  if (
    first.calcMethod !== settings.calcMethod ||
    first.latitude !== settings.latitude ||
    first.longitude !== settings.longitude ||
    first.cityName !== settings.cityName ||
    first.timeZone !== settings.timeZone ||
    first.locationMethod !== settings.locationMethod
  ) {
    await db.settings.update(first.id!, {
      calcMethod: settings.calcMethod,
      latitude: settings.latitude,
      longitude: settings.longitude,
      cityName: settings.cityName,
      timeZone: settings.timeZone,
      locationMethod: settings.locationMethod,
    });
  }
  if (isLegacyDefaultAdhan) {
    settings.adhanVoiceId = DEFAULT_SETTINGS.adhanVoiceId;
    await db.settings.update(first.id!, { adhanVoiceId: DEFAULT_SETTINGS.adhanVoiceId });
  }
  return settings;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  // Always update the canonical row — never `add`, otherwise concurrent callers
  // (onboarding + theme hook + settings screen) can each insert their own row.
  // The merged row is returned so callers can adopt it directly: the old path
  // wrote the patch and then re-read the whole table with getSettings(), which
  // made every settings save one database round trip more than it needed.
  const existing = await db.settings.toArray();
  if (existing.length === 0) {
    const created = normalizeEgyptPrayerSettings({
      ...DEFAULT_SETTINGS,
      ...patch,
      id: SETTINGS_ROW_ID,
    });
    await db.settings.put(created);
    return created;
  }
  const current = existing.reduce((min, row) => (row.id! < min.id! ? row : min));
  const merged = normalizeEgyptPrayerSettings({
    ...current,
    ...patch,
    id: SETTINGS_ROW_ID,
  });
  await db.settings.update(current.id!, {
    ...patch,
    id: SETTINGS_ROW_ID,
    calcMethod: merged.calcMethod,
    latitude: merged.latitude,
    longitude: merged.longitude,
    cityName: merged.cityName,
    timeZone: merged.timeZone,
    locationMethod: merged.locationMethod,
  });
  return merged;
}

function normalizeEgyptPrayerSettings(settings: Settings): Settings {
  const hasEgyptianLocation = isEgyptianLocation(
    settings.latitude ?? Number.NaN,
    settings.longitude ?? Number.NaN,
  );
  const cityName = !hasEgyptianLocation
    ? DEFAULT_SETTINGS.cityName
    : settings.locationMethod === 'auto'
      ? 'موقعي داخل مصر'
      : CITY_PRESETS.some((city) => city.name === settings.cityName)
        ? settings.cityName!
        : DEFAULT_SETTINGS.cityName;

  return {
    ...settings,
    calcMethod: 'Egyptian',
    latitude: hasEgyptianLocation ? settings.latitude : DEFAULT_SETTINGS.latitude,
    longitude: hasEgyptianLocation ? settings.longitude : DEFAULT_SETTINGS.longitude,
    cityName,
    timeZone: 'Africa/Cairo',
    locationMethod: settings.locationMethod === 'auto' ? 'auto' : 'manual',
  };
}
