import { db, type PrayerRecord, type SunnahRecord } from '@/db/database';
import { formatDateKey, addDays, getLast7Days, getDayNameShort } from '@/utils/dateUtils';
import { calculatePrayerTimes } from '@/utils/prayerTimes';

export async function getPrayerRecord(date: string, prayer: string): Promise<PrayerRecord | undefined> {
  return db.prayerRecords.where('date').equals(date).toArray().then(
    (records) => records.find((r) => r.prayer === prayer)
  );
}

export async function getDayPrayerRecords(date: string): Promise<PrayerRecord[]> {
  const records = await db.prayerRecords.where('date').equals(date).toArray();
  return records;
}

export type PrayerStatus = 'ontime' | 'late' | 'missed';

/** A day's prayer slot can be written only for today or yesterday. */
export function canEditPrayerDate(date: string, now = new Date()): boolean {
  const today = formatDateKey(now);
  const yesterday = formatDateKey(addDays(now, -1));
  return date === today || date === yesterday;
}

/**
 * The whole confirmation rule in one pure function so `check:content` can
 * assert it without IndexedDB: the slot must be writable, and a prayer that
 * already has a record is final. Pressing an answer saves it at once — there
 * is no countdown, no undo, and no correction afterwards.
 */
export function assertPrayerRecordable(
  date: string,
  hasRecord: boolean,
  now = new Date()
): void {
  if (!canEditPrayerDate(date, now)) {
    throw new Error('يمكن تسجيل صلاة اليوم أو أمس فقط.');
  }
  if (hasRecord) {
    throw new Error('تم تأكيد هذه الصلاة ولا يمكن تغييرها.');
  }
}

/**
 * Records a prayer's answer. The write is final and immediate: only a slot
 * with no record yet can be saved, and it never expires into an edit window.
 */
export async function confirmPrayer(
  date: string,
  prayer: string,
  status: PrayerStatus
): Promise<void> {
  const existing = await getPrayerRecord(date, prayer);
  assertPrayerRecordable(date, existing != null);
  await db.prayerRecords.add({
    date,
    prayer,
    status,
    confirmedAt: Date.now(),
  });
}

export async function getSunnahRecord(date: string, type: string): Promise<SunnahRecord | undefined> {
  const records = await db.sunnahRecords.where('date').equals(date).toArray();
  return records.find((r) => r.type === type);
}

export async function getDaySunnahRecords(date: string): Promise<SunnahRecord[]> {
  return db.sunnahRecords.where('date').equals(date).toArray();
}

/**
 * `type -> done` for one date's rows.
 *
 * The older single `rawatib_dhuhr` row is folded into its two halves so days
 * recorded before the split still read as done, and every surface (day list,
 * week grid, status sheet) agrees on that reading.
 */
export function sunnahDoneMap(rows: SunnahRecord[]): Record<string, boolean> {
  const map: Record<string, boolean> = Object.fromEntries(rows.map((r) => [r.type, r.done]));
  if (map.rawatib_dhuhr !== undefined) {
    map.rawatib_dhuhr_before ??= map.rawatib_dhuhr;
    map.rawatib_dhuhr_after ??= map.rawatib_dhuhr;
  }
  return map;
}

export async function setSunnah(date: string, type: string, done: boolean): Promise<void> {
  const existing = await getSunnahRecord(date, type);
  if (existing) {
    await db.sunnahRecords.update(existing.id!, { done });
  } else {
    await db.sunnahRecords.add({ date, type, done });
  }
}

export async function toggleSunnah(date: string, type: string): Promise<void> {
  const existing = await getSunnahRecord(date, type);
  if (existing) {
    await db.sunnahRecords.update(existing.id!, { done: !existing.done });
  } else {
    await db.sunnahRecords.add({ date, type, done: true });
  }
}

export interface PrayerStats {
  total: number;
  ontime: number;
  late: number;
  missed: number;
  unconfirmed: number;
  percentage: number;
}

/** The five obligatory prayers, in order. */
export const FIVE_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;

function emptyStats(): PrayerStats {
  return { total: 0, ontime: 0, late: 0, missed: 0, unconfirmed: 0, percentage: 0 };
}

/**
 * Tally every (day × prayer) slot for the given dates.
 *
 * A single `anyOf` query replaces one query per day — the monthly view used to issue 30
 * sequential IndexedDB round-trips.
 */
function tally(dates: string[], records: PrayerRecord[]): PrayerStats {
  const byDate = new Map<string, Map<string, PrayerStatus | null>>();
  for (const r of records) {
    let day = byDate.get(r.date);
    if (!day) {
      day = new Map();
      byDate.set(r.date, day);
    }
    day.set(r.prayer, r.status);
  }

  const stats = emptyStats();
  for (const date of dates) {
    const day = byDate.get(date);
    for (const prayer of FIVE_PRAYERS) {
      stats.total++;
      const status = day?.get(prayer);
      if (status === 'ontime') stats.ontime++;
      else if (status === 'late') stats.late++;
      else if (status === 'missed') stats.missed++;
      else stats.unconfirmed++;
    }
  }

  const confirmed = stats.ontime + stats.late + stats.missed;
  // A late prayer is still a prayer, so it counts towards the score — only missed ones
  // do not. This is why the numerator is ontime + late and not just ontime.
  stats.percentage = confirmed > 0 ? Math.round(((stats.ontime + stats.late) / confirmed) * 100) : 0;
  return stats;
}

export async function getWeeklyPrayerStats(): Promise<PrayerStats> {
  const dates = getLast7Days();
  const records = await db.prayerRecords.where('date').anyOf(dates).toArray();
  return tally(dates, records);
}

export async function getMonthlyPrayerStats(): Promise<PrayerStats> {
  const now = new Date();
  const dates: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(formatDateKey(d));
  }
  const records = await db.prayerRecords.where('date').anyOf(dates).toArray();
  return tally(dates, records);
}

// ---------------------------------------------------------------------------
// Per-day grid
// ---------------------------------------------------------------------------

export type PrayerKey = (typeof FIVE_PRAYERS)[number];

export const PRAYER_LABELS_AR: Record<PrayerKey, string> = {
  fajr: 'الفجر',
  dhuhr: 'الظهر',
  asr: 'العصر',
  maghrib: 'المغرب',
  isha: 'العشاء',
};

export interface RawatibSlot {
  /** Row key in `sunnahRecords`. */
  type: string;
  label: string;
}

export interface RawatibSlotState extends RawatibSlot {
  done: boolean;
}

/**
 * The sunnah al-rawatib attached to each fard prayer, in prayer order.
 *
 * One definition shared by the day list, the week grid and the status sheet, so
 * a slot can never appear under one surface and be missing from another.
 * `asr` is deliberately empty: it has no rawatib agreed upon by the schools.
 */
export const RAWATIB_BY_PRAYER: Record<PrayerKey, RawatibSlot[]> = {
  fajr: [{ type: 'rawatib_fajr', label: 'ركعتان قبل الفجر' }],
  dhuhr: [
    { type: 'rawatib_dhuhr_before', label: 'أربع ركعات قبل الظهر' },
    { type: 'rawatib_dhuhr_after', label: 'ركعتان بعد الظهر' },
  ],
  asr: [],
  maghrib: [{ type: 'rawatib_maghrib', label: 'ركعتان بعد المغرب' }],
  isha: [{ type: 'rawatib_isha', label: 'ركعتان بعد العشاء' }],
};

export interface DayPrayerGrid {
  /** `YYYY-MM-DD` */
  date: string;
  dayName: string;
  /** Arabic-Indic day of month, e.g. `٤`. */
  dayNumber: string;
  isToday: boolean;
  isPast: boolean;
  /**
   * Whether the prayer's time had already arrived on that day.
   *
   * This is the difference between "I did not pray this" and "this had not come
   * round yet". Without it, Dhuhr on the current day would be drawn as a failure
   * at 9am.
   */
  due: Record<PrayerKey, boolean>;
  status: Record<PrayerKey, PrayerStatus | null>;
  /**
   * The rawatib slots tied to each prayer that day, with their records.
   *
   * The grid records them per (day, prayer) rather than only for today, so a
   * forgotten slot on yesterday can still be corrected from the same cell that
   * shows its prayer.
   */
  sunnah: Record<PrayerKey, RawatibSlotState[]>;
}

export interface PrayerGridLocation {
  latitude: number;
  longitude: number;
  calcMethod: string;
  asrMadhab: 'standard' | 'hanafi';
  timeZone?: string;
}

const allDue = (): Record<PrayerKey, boolean> =>
  ({ fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true });

const noStatus = (): Record<PrayerKey, PrayerStatus | null> =>
  ({ fajr: null, dhuhr: null, asr: null, maghrib: null, isha: null });

/**
 * The last 7 days as a day × prayer matrix, with one query for the whole week.
 *
 * `location` is optional. Without it, today's `due` falls back to "everything is
 * due", which is wrong for the prayers still ahead — so callers that have a location
 * should always pass it.
 */
export async function getPrayerGrid(location?: PrayerGridLocation): Promise<DayPrayerGrid[]> {
  const now = new Date();
  const todayIso = formatDateKey(now);
  const dates = getLast7Days();

  const records = await db.prayerRecords.where('date').anyOf(dates).toArray();
  const byDate = new Map<string, Map<string, PrayerRecord>>();
  for (const r of records) {
    let day = byDate.get(r.date);
    if (!day) {
      day = new Map();
      byDate.set(r.date, day);
    }
    day.set(r.prayer, r);
  }

  // Same single-query pattern for the rawatib rows of the whole week.
  const sunnahRows = await db.sunnahRecords.where('date').anyOf(dates).toArray();
  const sunnahByDate = new Map<string, SunnahRecord[]>();
  for (const r of sunnahRows) {
    let day = sunnahByDate.get(r.date);
    if (!day) {
      day = [];
      sunnahByDate.set(r.date, day);
    }
    day.push(r);
  }

  // Today's `due` needs the actual prayer times, so compute them once outside the loop.
  let todayDue: Record<PrayerKey, boolean> | null = null;
  if (location) {
    const times = calculatePrayerTimes(
      location.latitude,
      location.longitude,
      now,
      location.calcMethod,
      location.asrMadhab,
      location.timeZone,
    );
    todayDue = noDue();
    for (const p of times.prayers) {
      if ((FIVE_PRAYERS as readonly string[]).includes(p.name)) {
        todayDue[p.name as PrayerKey] = p.passed;
      }
    }
  }

  const grid: DayPrayerGrid[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(now, -i);
    const date = formatDateKey(d);
    const isToday = date === todayIso;
    const isPast = date < todayIso;

    const day = byDate.get(date);
    const status = noStatus();
    for (const key of FIVE_PRAYERS) {
      const record = day?.get(key);
      status[key] = record?.status ?? null;
    }

    const sunnahDone = sunnahDoneMap(sunnahByDate.get(date) ?? []);
    const sunnah = noRawatib();
    for (const key of FIVE_PRAYERS) {
      sunnah[key] = RAWATIB_BY_PRAYER[key].map((slot) => ({
        ...slot,
        done: !!sunnahDone[slot.type],
      }));
    }

    let due: Record<PrayerKey, boolean>;
    if (isPast) due = allDue();
    else if (isToday && todayDue) due = todayDue;
    else due = allDue();

    grid.push({
      date,
      dayName: getDayNameShort(d.getDay()),
      dayNumber: toArabicDigits(d.getDate()),
      isToday,
      isPast,
      due,
      status,
      sunnah,
    });
  }
  return grid;
}

function noDue(): Record<PrayerKey, boolean> {
  return { fajr: false, dhuhr: false, asr: false, maghrib: false, isha: false };
}

function noRawatib(): Record<PrayerKey, RawatibSlotState[]> {
  return { fajr: [], dhuhr: [], asr: [], maghrib: [], isha: [] };
}

/** `4` -> `٤`. Local-only, so it must not use `toLocaleString` with an arbitrary locale. */
function toArabicDigits(value: number): string {
  return String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
}

/**
 * Count what a week actually adds up to, treating a past prayer that was never
 * recorded as a miss.
 *
 * This is deliberately different from {@link getWeeklyPrayerStats}: that one divides by
 * confirmed prayers only, so a user who logged one prayer out of thirty-five scored
 * 100%. The percentage the user sees on a tracking screen should treat silence as a
 * miss, otherwise it rewards not recording anything.
 */
export function summariseGrid(grid: DayPrayerGrid[]): PrayerStats {
  const stats = emptyStats();
  for (const day of grid) {
    for (const key of FIVE_PRAYERS) {
      if (!day.due[key]) continue;
      stats.total++;
      const status = day.status[key];
      if (status === 'ontime') stats.ontime++;
      else if (status === 'late') stats.late++;
      else if (status === 'missed') stats.missed++;
      else stats.unconfirmed++;
    }
  }
  const kept = stats.ontime + stats.late;
  stats.percentage = stats.total > 0 ? Math.round((kept / stats.total) * 100) : 0;
  return stats;
}
