import type { Table } from 'dexie';
import { App } from '@capacitor/app';
import { db, DEFAULT_SETTINGS, type HifzPlan } from '@/db/database';
import { supabase } from '@/utils/supabaseClient';
import { clearAllBackups } from '@/utils/autoBackup';
import { clearReadingHistory } from '@/utils/readingHistory';
import { isSyncSuppressed, suppressSyncWrites, withSyncSuppressed } from '@/utils/syncSuppression';

const SYNC_TABLES = [
  'settings',
  'plans',
  'tasks',
  'bookmarks',
  'pageBookmarks',
  'prayerRecords',
  'sunnahRecords',
  'hifzProgress',
  'hadithFavorites',
  'adhkar',
  // Joined in v2.0.6: both used to be device-local, so signing in on a second
  // device silently started a second khatmah and an independent SM-2 schedule
  // over the same ranges. The server constraint that admits these names is in
  // `supabase/migrations/20261019000000_sync_khatmah_hifz_reviews.sql` — run it
  // before this build ships, the same as the adhkar migration before it.
  'khatmah',
  'hifzReviews',
] as const;

type SyncTableName = (typeof SYNC_TABLES)[number];
type SyncStatus = 'syncing' | 'synced' | 'offline' | 'error';
type SyncRow = Record<string, unknown>;

export interface CloudRecord {
  table_name: SyncTableName;
  record_id: string;
  record_data: Record<string, unknown> | null;
  modified_at: string;
  is_deleted: boolean;
}

export interface CloudSyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  error: string | null;
}

/**
 * Signing out uploads this device's rows and then deletes the local copy, so the
 * upload is not an optimisation — it is the difference between the data surviving
 * the sign-out and it being gone. The attempt therefore reports which of the two
 * happened, and the screen asks the reader before continuing when it is the second.
 */
export interface SignOutOptions {
  /** Skip the pre-sign-out upload. Offered only after the reader was told it failed. */
  skipUpload?: boolean;
}

export type SignOutResult = 'signed-out' | 'upload-failed';

const DELETE_QUEUE_PREFIX = 'zad-delete-queue:';
const DEVICE_ID_KEY = 'zad:device-id';
const ADHKAR_STORAGE_KEY = 'hifzi-adhkar-state';
let activeUserId: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncInterval: ReturnType<typeof setInterval> | undefined;
let syncInFlight: Promise<void> | undefined;
/**
 * Every mounted view watching the sync, not just the last one to ask.
 *
 * The admin's dashboard and its «فتح التطبيق» view are the same account and
 * each asked for sync in turn; a single callback slot meant the second caller
 * stole it, and the first one's stop tore down a loop still in use — while the
 * interval it had itself created was orphaned and kept ticking.
 */
const statusSubscribers = new Set<(state: CloudSyncState) => void>();
/** How many callers currently hold the loop; teardown happens at zero. */
let syncRefCount = 0;
let syncRuntime: (() => void) | undefined;
let hooksInstalled = false;
let lastSyncedAt: string | null = null;

function publish(status: SyncStatus, error: string | null = null): void {
  const state: CloudSyncState = { status, lastSyncedAt, error };
  for (const subscriber of statusSubscribers) {
    try {
      subscriber(state);
    } catch (err) {
      // One view's bad handler must not take the sync down with it.
      console.error('Cloud sync status subscriber threw:', err);
    }
  }
}

function syncIdFor(table: SyncTableName, row: SyncRow): string {
  if (typeof row.syncId === 'string' && row.syncId.length > 0) return row.syncId;
  switch (table) {
    case 'adhkar': return 'adhkar';
    case 'settings': return 'settings';
    // A singleton the way `settings` is one: the table is cleared wholesale when
    // a plan ends, so every row that ever exists competes for the single slot
    // `khatmah` and merges by modified_at like every other singleton here. A
    // random id per row would leave both devices' plans alive forever — two
    // rows, both pushing, neither ever winning, and `loadKhatmah` silently
    // picking between them on every device for good.
    case 'khatmah': return 'khatmah';
    // Keyed by the range, so the two devices' SM-2 states for «البقرة ١-٥» are
    // one record rather than two rows that each keep rescheduling on their own.
    case 'hifzReviews': return typeof row.key === 'string' && row.key.length > 0
      ? row.key
      : crypto.randomUUID();
    case 'pageBookmarks': return `page:${row.page}`;
    case 'prayerRecords': return `${row.date}:${row.prayer}`;
    case 'sunnahRecords': return `${row.date}:${row.type}`;
    case 'hadithFavorites': return `${row.collection}:${row.hadithId}`;
    case 'tasks':
      return `task:${row.planSyncId ?? row.planId}:${row.date}:${row.type}:${row.portion}`;
    default: return crypto.randomUUID();
  }
}

function addMutationMetadata(table: SyncTableName, row: SyncRow): void {
  row.syncId = syncIdFor(table, row);
  row.syncModifiedAt = Date.now();
}

/**
 * Remembers a local deletion so the next round pushes a tombstone.
 *
 * This runs inside Dexie's `deleting` hook, where a thrown exception fails the
 * *user's* operation — `db.bookmarks.delete()` would reject because
 * `localStorage` was full or held a value `JSON.parse` refuses. Neither is a
 * reason to refuse a deletion the user already made, and neither is fixable
 * from here: the queue is bookkeeping for a later round, so it degrades to
 * "not remembered" and the row simply survives in the cloud until the next
 * edit. `readDeleteQueue` already drops a malformed entry on the read side;
 * this is the matching tolerance on the write side.
 */
function queueDelete(table: SyncTableName, recordId: string): void {
  if (!activeUserId) return;
  const key = `${DELETE_QUEUE_PREFIX}${activeUserId}`;
  try {
    const current = JSON.parse(localStorage.getItem(key) ?? '[]') as LocalTombstone[];
    const tombstone: LocalTombstone = {
      key: `${table}:${recordId}`,
      table,
      recordId,
      modifiedAt: Date.now(),
    };
    const index = current.findIndex((item) => item.key === tombstone.key);
    if (index >= 0) current[index] = tombstone;
    else current.push(tombstone);
    localStorage.setItem(key, JSON.stringify(current));
  } catch (error) {
    console.error('Could not record a local deletion for sync:', error);
    return;
  }
  scheduleSync();
}

function installMutationHooks(): void {
  if (hooksInstalled) return;
  for (const name of SYNC_TABLES) {
    if (name === 'adhkar') continue;
    const table = db.table(name) as Table<SyncRow, number | string>;
    table.hook('creating').subscribe((_key, row) => {
      if (!isSyncSuppressed()) {
        addMutationMetadata(name, row);
        scheduleSync();
      }
    });
    table.hook('updating').subscribe((changes, _key, row) => {
      if (!isSyncSuppressed()) {
        changes.syncId = syncIdFor(name, row);
        changes.syncModifiedAt = Date.now();
        scheduleSync();
      }
    });
    table.hook('deleting').subscribe((_key, row) => {
      if (!isSyncSuppressed()) queueDelete(name, syncIdFor(name, row));
    });
  }
  window.addEventListener('zad:adhkar-updated', scheduleSync);
  hooksInstalled = true;
}

function scheduleSync(): void {
  if (!activeUserId || isSyncSuppressed()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void synchronizeNow().catch((error: unknown) => {
      publish('error', error instanceof Error ? error.message : 'تعذّرت مزامنة البيانات.');
    });
  }, 800);
}

function parseDeleteQueue(userId: string): LocalTombstone[] {
  const key = `${DELETE_QUEUE_PREFIX}${userId}`;
  const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
  if (!Array.isArray(value)) throw new Error('سجل حذف البيانات المحلية غير صالح.');
  return value.filter((item): item is LocalTombstone =>
    typeof item === 'object' &&
    item !== null &&
    'table' in item &&
    typeof item.table === 'string' &&
    SYNC_TABLES.includes(item.table as SyncTableName) &&
    'recordId' in item &&
    typeof item.recordId === 'string' &&
    'modifiedAt' in item &&
    typeof item.modifiedAt === 'number'
  );
}

/**
 * The delete queue as the sync path reads it — never throwing.
 *
 * `parseDeleteQueue` rejects a value that is not an array (an interrupted write, a
 * corrupt key), and synchronizeNow used to let that rejection out: one malformed
 * localStorage entry then failed *every* sync round, forever, with no self-heal —
 * cloud sync silently dead while the app looked otherwise healthy. The queue only
 * remembers deletions; its contents are already unreadable by the time the shape
 * check fails, so the entry is dropped and the round proceeds. The cost is bounded
 * and one-sided: a record the user deleted locally can come back on the next pull
 * (and be deleted again), where the old behaviour cost all sync, permanently.
 *
 * `acknowledgeTombstones` already treats a bad queue as "nothing to acknowledge";
 * this is the same tolerance on the read side.
 *
 * Exported as the seam the sync-path resilience test pins down.
 */
export function readDeleteQueue(userId: string): LocalTombstone[] {
  try {
    return parseDeleteQueue(userId);
  } catch (err) {
    console.error('Malformed local delete queue — discarding it.', err);
    localStorage.removeItem(`${DELETE_QUEUE_PREFIX}${userId}`);
    return [];
  }
}

interface LocalTombstone {
  key: string;
  table: SyncTableName;
  recordId: string;
  modifiedAt: number;
}

/**
 * Drops tombstones the server has acknowledged, leaving the rest intact.
 *
 * The delete queue can gain entries while a sync round is in flight (a deletion
 * performed during the network round-trips) — clearing the whole queue after a
 * successful apply silently discarded those, and the deleted row resurrected on
 * the next pull. The queue is therefore re-read from disk after the push and only
 * the keys the server already has (pushed this round, or superseded by a newer
 * remote record) are removed.
 */
function acknowledgeTombstones(userId: string, acknowledged: Set<string>): void {
  if (acknowledged.size === 0) return;
  let current: LocalTombstone[];
  try {
    current = parseDeleteQueue(userId);
  } catch {
    // A malformed queue must not take the sync down with it.
    return;
  }
  const remaining = current.filter((item) => !acknowledged.has(item.key));
  if (remaining.length === current.length) return;
  localStorage.setItem(`${DELETE_QUEUE_PREFIX}${userId}`, JSON.stringify(remaining));
}

async function fetchCloudRecords(userId: string): Promise<Map<string, CloudRecord>> {
  if (!supabase) throw new Error('إعداد الاتصال السحابي غير مكتمل.');
  const records = new Map<string, CloudRecord>();
  const pageSize = 500;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from('user_sync_records')
      .select('table_name,record_id,record_data,modified_at,is_deleted')
      .eq('user_id', userId)
      // Postgres does not guarantee stable ordering for limit/offset queries, so
      // paging without an explicit order can skip or repeat rows between pages.
      // The sort must also be *unique* to be stable across pages: the table's key is
      // (user_id, table_name, record_id), so ordering by record_id alone leaves ties
      // between tables with no defined order — exactly the case that drops a row at a
      // page boundary. Sorting by the full key makes the pages exact; duplicates would
      // still self-heal via the map key, but they should no longer be needed.
      .order('table_name', { ascending: true })
      .order('record_id', { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const item = row as CloudRecord;
      // A table this build has never heard of is a *newer* build's data, not a
      // corrupt one. Throwing used to freeze cloud sync on every device still on
      // the previous release the moment a newer device wrote one row — and that
      // release had just added `adhkar`, so the failure was live in the wild.
      // Skipping costs the unknown rows for this round only; they return once
      // the build understands them.
      if (!SYNC_TABLES.includes(item.table_name)) {
        console.warn(`Skipping sync record from an unknown table: ${String(item.table_name)}`);
        continue;
      }
      records.set(`${item.table_name}:${item.record_id}`, item);
    }
    if (!data || data.length < pageSize) break;
  }
  return records;
}

/**
 * Runs a local *repair* write without the mutation hooks reacting to it.
 *
 * Collapsing duplicate rows and stamping missing timestamps are schema repairs, not
 * user edits: the 'updating' hook would otherwise bump syncModifiedAt to *now* (a
 * fresh repair masquerading as a fresh edit) and schedule another sync round, and the
 * 'deleting' hook would queue a tombstone for the very sync id the surviving row still
 * uses — telling the server to delete the record we just kept.
 */
async function repairSilently<T>(operation: () => Promise<T>): Promise<T> {
  return withSyncSuppressed(operation);
}

/**
 * Which of two rows sharing one sync id survives the repair.
 *
 * A real prayer answer beats an empty stub, the more recent confirmation beats an
 * older one, and anything else resolves to the later insert (the larger auto-increment
 * id), which is the order Dexie returns rows in anyway.
 */
function pickSyncRow(table: SyncTableName, a: SyncRow, b: SyncRow): SyncRow {
  if (table === 'prayerRecords') {
    const aBlank = a.status === null || a.status === undefined;
    const bBlank = b.status === null || b.status === undefined;
    if (aBlank !== bBlank) return aBlank ? b : a;
    const aAt = typeof a.confirmedAt === 'number' ? a.confirmedAt : 0;
    const bAt = typeof b.confirmedAt === 'number' ? b.confirmedAt : 0;
    if (aAt !== bAt) return aAt > bAt ? a : b;
  }
  if (table === 'khatmah') {
    // The plan last actually *read* is the plan the reader means to continue;
    // a later insert with an older `updatedAt` is a fresh row holding stale
    // progress, and the larger id would hand it the slot.
    const aAt = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
    const bAt = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
    if (aAt !== bAt) return aAt > bAt ? a : b;
  }
  return (typeof b.id === 'number' ? b.id : 0) > (typeof a.id === 'number' ? a.id : 0) ? b : a;
}

async function getLocalRecords(): Promise<Map<string, { table: SyncTableName; row: SyncRow }>> {
  const local = new Map<string, { table: SyncTableName; row: SyncRow }>();
  const plansById = new Map<number, string>();
  const storedPlans = await db.plans.toArray();
  for (const plan of storedPlans) {
    if (typeof plan.id === 'number') {
      const id = syncIdFor('plans', { ...plan });
      if (plan.syncId !== id) {
        plan.syncId = id;
        // Silent write is mandatory here: the 'updating' hook recomputes the id from
        // the *pre-write* row, which for a legacy plan (no syncId) generates a second,
        // different random UUID and overwrites the one just assigned — leaving tasks
        // pointing at planSyncId A while the plan syncs as B, which failed every apply
        // round with "task without its plan" forever.
        await repairSilently(() => db.plans.put(plan));
      }
      plansById.set(plan.id, id);
    }
  }
  const storedTasks = await db.tasks.toArray();
  const tasksByMissingPlan = new Map<number, typeof storedTasks>();
  for (const task of storedTasks) {
    if (!Number.isInteger(task.planId) || plansById.has(task.planId)) continue;
    const relatedTasks = tasksByMissingPlan.get(task.planId) ?? [];
    relatedTasks.push(task);
    tasksByMissingPlan.set(task.planId, relatedTasks);
  }
  for (const [missingPlanId, relatedTasks] of tasksByMissingPlan) {
    const linkedPlanIds = new Set(
      relatedTasks.flatMap((task) =>
        typeof task.planSyncId === 'string' && task.planSyncId.length > 0 ? [task.planSyncId] : [],
      ),
    );
    if (linkedPlanIds.size > 1) {
      throw new Error('تتعارض روابط مهام الحفظ مع خطط مختلفة؛ لم تُرفع البيانات لحمايتها.');
    }
    const syncId = linkedPlanIds.values().next().value ?? crypto.randomUUID();
    const task = relatedTasks[0];
    const recoveredPlan: HifzPlan = {
      name: 'خطة مستعادة',
      type: task.type,
      portion: task.portion,
      daysOfWeek: [],
      time: task.scheduledTime,
      createdAt: task.createdAt,
      active: false,
      syncPlaceholder: true,
      syncId,
      syncModifiedAt: Date.now(),
    };
    const key = await db.plans.add(recoveredPlan);
    plansById.set(missingPlanId, syncId);
    if (typeof key !== 'number') throw new Error('تعذّر استعادة الخطة المرتبطة بمهمة الحفظ.');
  }
  for (const name of SYNC_TABLES) {
    if (name === 'adhkar') continue;
    const rows = await db.table(name).toArray() as SyncRow[];
    for (const row of rows) {
      if (name === 'tasks' && typeof row.planId === 'number' && plansById.has(row.planId)) {
        row.planSyncId = plansById.get(row.planId);
      }
      const recordId = syncIdFor(name, row);
      let changed = false;
      if (row.syncId !== recordId) {
        row.syncId = recordId;
        changed = true;
      }
      // Rows written before sync existed carry no modification time. Pushed as-is
      // they would reach the cloud stamped 1970, and every later conflict would
      // resolve against that baseline instead of when the row actually changed.
      // Stamp once, with the best evidence of when it really was written. The
      // khatmah plan knows it as `updatedAt` and the SM-2 schedule as
      // `lastReviewedAt`; stamping those two with `Date.now()` instead would
      // make an untouched plan or a long-dormant range look freshly edited and
      // beat a genuinely newer copy from another device.
      if (typeof row.syncModifiedAt !== 'number') {
        row.syncModifiedAt = typeof row.confirmedAt === 'number'
          ? row.confirmedAt
          : typeof row.createdAt === 'number'
            ? row.createdAt
            : typeof row.updatedAt === 'number'
              ? row.updatedAt
              : typeof row.lastReviewedAt === 'number'
                ? row.lastReviewedAt
                : Date.now();
        changed = true;
      }
      if (changed) await repairSilently(() => db.table(name).put(row));

      const key = `${name}:${recordId}`;
      const duplicate = local.get(key);
      if (duplicate) {
        // Two rows for one logical slot: a racing double-confirm from before writes
        // were serialised (see prayerTracker's write chain). Repair the table instead
        // of throwing — the old unconditional throw aborted the entire sync on every
        // attempt, so one stray duplicate silenced cloud sync forever, and with no
        // repair the next duplicate would bring the outage straight back.
        const keeper = pickSyncRow(name, duplicate.row, row);
        const loser = keeper === duplicate.row ? row : duplicate.row;
        if (typeof loser.id === 'number') {
          await repairSilently(() => db.table(name).delete(loser.id as number));
        }
        if (keeper !== duplicate.row) local.set(key, { table: name, row: keeper });
        continue;
      }
      local.set(key, { table: name, row });
    }
  }
  const rawAdhkar = localStorage.getItem(ADHKAR_STORAGE_KEY);
  if (rawAdhkar) {
    let adhkar: unknown;
    try {
      adhkar = JSON.parse(rawAdhkar);
    } catch {
      console.error('Skipping cloud sync for malformed local adhkar data.');
    }
    if (isAdhkarState(adhkar)) {
      const row: SyncRow = { ...adhkar, id: 1, syncId: 'adhkar' };
      if (typeof row.syncModifiedAt !== 'number') {
        row.syncModifiedAt = Date.now();
        localStorage.setItem(ADHKAR_STORAGE_KEY, JSON.stringify(row));
      }
      local.set('adhkar:adhkar', { table: 'adhkar', row });
    } else if (adhkar !== undefined) {
      console.error('Skipping cloud sync for local adhkar data with an invalid shape.');
    }
  }
  return local;
}

function isAdhkarState(value: unknown): value is Record<string, unknown> & {
  day: string;
  counts: Record<string, number>;
  favorites: string[];
  fontSize: number;
  haptics: boolean;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.day === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(state.day)
    && !!state.counts
    && typeof state.counts === 'object'
    && !Array.isArray(state.counts)
    && Object.values(state.counts).every((count) =>
      typeof count === 'number' && Number.isFinite(count) && count >= 0,
    )
    && Array.isArray(state.favorites)
    && state.favorites.every((favorite) => typeof favorite === 'string')
    && typeof state.fontSize === 'number'
    && Number.isFinite(state.fontSize)
    && state.fontSize >= 18
    && state.fontSize <= 32
    && typeof state.haptics === 'boolean'
    && (state.syncModifiedAt === undefined
      || (typeof state.syncModifiedAt === 'number' && Number.isFinite(state.syncModifiedAt)));
}

function isHifzPlan(value: Record<string, unknown>): value is Record<string, unknown> & HifzPlan {
  return typeof value.name === 'string'
    && (value.type === 'hifz' || value.type === 'muraja')
    && typeof value.portion === 'string'
    && Array.isArray(value.daysOfWeek)
    && typeof value.time === 'string'
    && typeof value.createdAt === 'number'
    && typeof value.active === 'boolean';
}

function serializeLocalRow(
  table: SyncTableName,
  row: SyncRow,
  plans: Map<number, string>,
): Record<string, unknown> {
  const data = { ...row };
  delete data.id;
  if (table === 'tasks') {
    const planId = data.planId;
    const planSyncId = typeof data.planSyncId === 'string'
      ? data.planSyncId
      : typeof planId === 'number' ? plans.get(planId) : undefined;
    if (!planSyncId) throw new Error('تعذّر العثور على خطة مرتبطة بمهمة للحفظ السحابي.');
    data.planSyncId = planSyncId;
    delete data.planId;
  }
  return data;
}

async function makeCloudChanges(
  local: Map<string, { table: SyncTableName; row: SyncRow }>,
  cloud: Map<string, CloudRecord>,
  tombstones: LocalTombstone[],
): Promise<Record<string, unknown>[]> {
  const plans = new Map<number, string>();
  for (const { table, row } of local.values()) {
    if (table === 'plans' && typeof row.id === 'number' && typeof row.syncId === 'string') {
      plans.set(row.id, row.syncId);
    }
  }

  const changes: Record<string, unknown>[] = [];
  for (const [key, { table, row }] of local) {
    const modifiedAt = typeof row.syncModifiedAt === 'number' ? row.syncModifiedAt : 0;
    const remote = cloud.get(key);
    if (remote && Date.parse(remote.modified_at) >= modifiedAt) continue;
    changes.push({
      table_name: table,
      record_id: row.syncId,
      record_data: serializeLocalRow(table, row, plans),
      modified_at: new Date(modifiedAt || 1).toISOString(),
      is_deleted: false,
    });
  }

  for (const tombstone of tombstones) {
    const key = `${tombstone.table}:${tombstone.recordId}`;
    const remote = cloud.get(key);
    if (remote && Date.parse(remote.modified_at) >= tombstone.modifiedAt) continue;
    changes.push({
      table_name: tombstone.table,
      record_id: tombstone.recordId,
      record_data: null,
      modified_at: new Date(tombstone.modifiedAt).toISOString(),
      is_deleted: true,
    });
  }
  return changes;
}

async function deleteLocalRecord(tableName: SyncTableName, recordId: string): Promise<boolean> {
  if (tableName === 'adhkar') {
    localStorage.removeItem(ADHKAR_STORAGE_KEY);
    return true;
  }
  const table = db.table(tableName);
  // Indexed since v8: the old collection filter scanned every row of the table
  // once per incoming record.
  const row = await table.where('syncId').equals(recordId).first() as SyncRow | undefined;
  if (!row) return false;
  if (tableName === 'pageBookmarks' && typeof row.page === 'number') {
    await db.pageBookmarks.delete(row.page);
    return true;
  } else if (tableName === 'settings') {
    await db.settings.put({ ...DEFAULT_SETTINGS, id: 1, syncId: 'settings', syncModifiedAt: Date.now() });
    return true;
  } else if (tableName === 'plans' && typeof row.id === 'number') {
    const childTasks = await db.tasks.where('planId').equals(row.id).count();
    if (childTasks > 0) {
      await db.plans.update(row.id, {
        active: false,
        syncPlaceholder: true,
        syncModifiedAt: Date.now(),
      });
      return true;
    } else {
      await db.plans.delete(row.id);
      return true;
    }
  } else if (typeof row.id === 'number') {
    await table.delete(row.id);
    return true;
  }
  return false;
}

async function applyCloudRecords(records: Map<string, CloudRecord>): Promise<void> {
  const plans = [...records.values()].filter((row) => row.table_name === 'plans');
  const otherRows = [...records.values()].filter((row) => row.table_name !== 'plans');
  const planIds = new Map<string, number>();
  let changed = false;
  // Save-and-restore, not assign-and-clear: `clearLocalUserData` (sign-out),
  // `repairSilently` and a backup restore all quiet the same hooks, and an
  // unconditional release in a `finally` would re-enable them for whatever was
  // still running underneath — turning a sign-out's remaining `clear()` calls
  // into a storm of tombstones against the account being signed out of.
  const releaseHooks = suppressSyncWrites();
  try {
    await db.transaction('rw', SYNC_TABLES.filter((name) => name !== 'adhkar').map((name) => db.table(name)), async () => {
      /**
       * One record this build cannot make sense of must not stop the round.
       *
       * Every shape failure used to `throw` inside this transaction: it rolled
       * back, the round errored, and the next tick met the same server row —
       * so a single bad record froze sync *forever* on every device, with no
       * quarantine and no skip. The row stays on the server untouched (the
       * server is the source of truth and validates nothing but "object"), so
       * skipping costs that one record for this round, and the log names it.
       */
      const skip = (remote: CloudRecord, why: string): void => {
        console.error(
          `Skipping cloud record ${remote.table_name}:${remote.record_id} — ${why}`,
        );
      };
      const applyPlan = async (remote: CloudRecord, placeholder: boolean) => {
        if (!remote.record_data || typeof remote.record_data !== 'object') {
          if (remote.is_deleted) return;
          skip(remote, 'record has no usable payload');
          return;
        }
        if (!isHifzPlan(remote.record_data)) {
          skip(remote, 'plan payload does not match the plan shape');
          return;
        }
        const existing = await db.plans.where('syncId').equals(remote.record_id).first();
        const remoteModifiedAt = Date.parse(remote.modified_at);
        if (existing && (existing.syncModifiedAt ?? 0) >= remoteModifiedAt && !placeholder) {
          if (typeof existing.id === 'number') planIds.set(remote.record_id, existing.id);
          return;
        }
        const row: HifzPlan = {
          ...remote.record_data,
          syncId: remote.record_id,
          syncModifiedAt: remoteModifiedAt,
          ...(placeholder ? { active: false, syncPlaceholder: true } : {}),
        };
        if (existing && typeof existing.id === 'number') row.id = existing.id;
        else delete row.id;
        const key = await db.plans.put(row);
        planIds.set(remote.record_id, Number(key));
        changed = true;
      };

      for (const remote of plans.filter((record) => !record.is_deleted)) {
        await applyPlan(remote, false);
      }

      for (const remote of plans.filter((record) => record.is_deleted)) {
        const localPlan = await db.plans.where('syncId').equals(remote.record_id).first();
        const localHasTasks = localPlan?.id !== undefined
          && await db.tasks.where('planId').equals(localPlan.id).count() > 0;
        const hasCloudTasks = [...records.values()].some((record) =>
          record.table_name === 'tasks' &&
          !record.is_deleted &&
          record.record_data?.planSyncId === remote.record_id
        );
        if (localPlan && (localHasTasks || hasCloudTasks)) {
          if (!localPlan.syncPlaceholder || (localPlan.syncModifiedAt ?? 0) < Date.parse(remote.modified_at)) {
            await db.plans.update(localPlan.id!, {
              active: false,
              syncPlaceholder: true,
              syncModifiedAt: Date.parse(remote.modified_at),
            });
            changed = true;
          }
          planIds.set(remote.record_id, localPlan.id!);
        } else if (hasCloudTasks) {
          const task = [...records.values()].find((record) =>
            record.table_name === 'tasks' &&
            !record.is_deleted &&
            record.record_data?.planSyncId === remote.record_id
          );
          const taskData = task?.record_data;
          if (!taskData) {
            skip(remote, 'a cloud task points at a plan that is neither here nor in the payload');
            continue;
          }
          const key = await db.plans.add({
            id: undefined,
            name: 'خطة محذوفة',
            type: taskData.type === 'muraja' ? 'muraja' : 'hifz',
            portion: typeof taskData.portion === 'string' ? taskData.portion : '',
            daysOfWeek: [],
            time: typeof taskData.scheduledTime === 'string' ? taskData.scheduledTime : '00:00',
            createdAt: typeof taskData.createdAt === 'number' ? taskData.createdAt : 0,
            active: false,
            syncPlaceholder: true,
            syncId: remote.record_id,
            syncModifiedAt: Date.parse(remote.modified_at),
          });
          planIds.set(remote.record_id, Number(key));
          changed = true;
        } else {
          changed = (await deleteLocalRecord('plans', remote.record_id)) || changed;
        }
      }

      for (const remote of otherRows) {
        const tableName = remote.table_name;
        if (remote.is_deleted) {
          changed = (await deleteLocalRecord(tableName, remote.record_id)) || changed;
          continue;
        }
        if (!remote.record_data || typeof remote.record_data !== 'object') {
          skip(remote, 'record has no usable payload');
          continue;
        }
        if (tableName === 'adhkar') {
          if (!isAdhkarState(remote.record_data)) {
            skip(remote, 'adhkar payload does not match the adhkar shape');
            continue;
          }
          const remoteModifiedAt = Date.parse(remote.modified_at);
          const rawLocal = localStorage.getItem(ADHKAR_STORAGE_KEY);
          let localModifiedAt = 0;
          if (rawLocal) {
            let localData: unknown;
            try {
              localData = JSON.parse(rawLocal);
            } catch {
              console.error('Replacing malformed local adhkar data with the valid cloud copy.');
            }
            if (isAdhkarState(localData)) {
              localModifiedAt = typeof localData.syncModifiedAt === 'number' ? localData.syncModifiedAt : 0;
            } else if (localData !== undefined) {
              console.error('Replacing invalid local adhkar data with the valid cloud copy.');
            }
          }
          if (localModifiedAt >= remoteModifiedAt) continue;
          localStorage.setItem(ADHKAR_STORAGE_KEY, JSON.stringify({
            ...remote.record_data,
            syncId: 'adhkar',
            syncModifiedAt: remoteModifiedAt,
          }));
          window.dispatchEvent(new Event('zad:adhkar-updated'));
          changed = true;
          continue;
        }
        const table = db.table(tableName);
        const existing = await table.where('syncId').equals(remote.record_id).first() as SyncRow | undefined;
        const remoteModifiedAt = Date.parse(remote.modified_at);
        if (existing && (typeof existing.syncModifiedAt === 'number' ? existing.syncModifiedAt : 0) >= remoteModifiedAt) {
          continue;
        }
        const row: SyncRow = {
          ...remote.record_data,
          syncId: remote.record_id,
          syncModifiedAt: remoteModifiedAt,
        };
        if (tableName === 'tasks') {
          const planSyncId = row.planSyncId;
          if (typeof planSyncId !== 'string' || !planIds.has(planSyncId)) {
            skip(remote, 'task has no plan this round could resolve');
            continue;
          }
          row.planId = planIds.get(planSyncId);
          delete row.planSyncId;
        }
        if (tableName === 'settings') {
          row.id = 1;
        } else if (tableName === 'pageBookmarks') {
          if (typeof row.page !== 'number') {
            skip(remote, 'page bookmark has no page number');
            continue;
          }
        } else if (existing && typeof existing.id === 'number') {
          row.id = existing.id;
        } else {
          delete row.id;
        }
        const key = await table.put(row);
        void key;
        changed = true;
      }
    });
  } finally {
    releaseHooks();
  }
  if (changed) window.dispatchEvent(new Event('zad:cloud-sync-complete'));
}

export async function synchronizeNow(): Promise<void> {
  if (!activeUserId || !supabase) return;
  if (syncInFlight) return syncInFlight;
  if (!navigator.onLine) {
    publish('offline');
    return;
  }

  const userId = activeUserId;
  syncInFlight = (async () => {
    publish('syncing');
    const cloud = await fetchCloudRecords(userId);
    const local = await getLocalRecords();
    const tombstones = [
      ...readDeleteQueue(userId),
    ];
    const changes = await makeCloudChanges(local, cloud, tombstones);
    // Tombstones this round hands to the server (plus the ones the server already
    // outranks with a newer record) are the only ones safe to forget afterwards —
    // anything else in the queue may have been added mid-flight and must survive.
    const acknowledgedTombstones = new Set<string>();
    for (const change of changes) {
      if (change.is_deleted) acknowledgedTombstones.add(`${change.table_name}:${change.record_id}`);
    }
    for (const tombstone of tombstones) {
      const remote = cloud.get(tombstone.key);
      if (remote && Date.parse(remote.modified_at) >= tombstone.modifiedAt) {
        acknowledgedTombstones.add(tombstone.key);
      }
    }
    for (let start = 0; start < changes.length; start += 200) {
      const { error } = await supabase.rpc('sync_user_records', { p_records: changes.slice(start, start + 200) });
      if (error) throw error;
    }
    // Nothing was pushed, so the records pulled a moment ago are still the server's
    // current state — a second full pull would only re-download what we already hold.
    // This is the common case (an idle device's round pushes nothing), so it halves
    // the pull traffic of every 60-second tick. A concurrent write by another device
    // is not missed: it arrives through the realtime subscription, which starts a
    // round of its own. After a real push the refetch is required — the server is
    // what decides the merged row and its modified_at.
    const latest = changes.length > 0 ? await fetchCloudRecords(userId) : cloud;
    await applyCloudRecords(latest);
    acknowledgeTombstones(userId, acknowledgedTombstones);
    lastSyncedAt = new Date().toISOString();
    publish('synced');
  })();
  try {
    await syncInFlight;
  } catch (error) {
    publish('error', error instanceof Error ? error.message : 'تعذّرت مزامنة البيانات.');
    throw error;
  } finally {
    syncInFlight = undefined;
  }
}

/**
 * Starts the background sync loop, or joins the one already running.
 *
 * The loop is a module-level singleton — one interval, one realtime channel,
 * one set of listeners — because the account is one account. Two views can
 * ask for it at once (the admin's dashboard and its «فتح التطبيق» view are
 * the same session), and the second call used to overwrite `syncInterval` and
 * the status callback: the first interval was then unreachable and leaked for
 * the life of the document, while the first caller's stop tore down a loop the
 * second one was still using. Ref-counting makes the loop belong to the count,
 * not to whoever asked last, and each caller gets a stop that releases exactly
 * what it took.
 */
export async function startCloudSync(
  userId: string,
  onStatus: (state: CloudSyncState) => void,
): Promise<() => void> {
  if (!supabase) throw new Error('إعداد الاتصال السحابي غير مكتمل.');

  const joining = syncRefCount > 0;
  statusSubscribers.add(onStatus);
  syncRefCount += 1;
  activeUserId = userId;

  const release = (): void => {
    if (!statusSubscribers.has(onStatus)) return;
    statusSubscribers.delete(onStatus);
    syncRefCount = Math.max(0, syncRefCount - 1);
    if (syncRefCount === 0) {
      teardownSyncRuntime();
    }
  };

  if (joining) {
    // Someone already owns the loop; just report where it stands so the new
    // view is not left showing its own "syncing" placeholder forever.
    publish(syncInFlight ? 'syncing' : lastSyncedAt ? 'synced' : 'syncing');
    return release;
  }

  installMutationHooks();
  publish('syncing');
  // A cloud failure is not a reason to keep the app closed. Everything the app reads is
  // already in IndexedDB, a pull that fails partway leaves local data untouched, and the
  // push never ran — so nothing is lost, it just has not reached the cloud yet. Failing
  // here used to replace the whole app with a retry screen, which meant a 401, a 5xx or a
  // captive portal at launch locked the user out of their own Quran. The interval, the
  // online listener and the realtime channel below all retry, so the only thing this await
  // buys is the first merge landing before the first paint.
  await synchronizeNow().catch(() => {});
  syncInterval = setInterval(() => {
    void synchronizeNow().catch(() => {});
  }, 60_000);
  const handleOnline = () => { void synchronizeNow().catch(() => {}); };
  window.addEventListener('online', handleOnline);
  // Not awaited: the stop below removes it either way, and awaiting here held the
  // first paint behind a network round trip.
  let disposed = false;
  const resumeListener = App.addListener('resume', handleOnline).then((listener) => {
    if (disposed) void listener.remove();
    return listener;
  });
  // A burst, not a series of events. Saving row after row on another device
  // fires one realtime event per row, and each one used to start a full round
  // of its own — pull, diff, push, apply — so a bulk save drove this device
  // through dozens of back-to-back rounds for what was one write. Coalescing
  // turns the burst into a single round that runs once the stream goes quiet,
  // through the same window an ordinary local write already uses.
  const handleRemoteChange = () => scheduleSync();
  const realtimeChannel = supabase
    .channel(`user-sync-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_sync_records', filter: `user_id=eq.${userId}` },
      handleRemoteChange,
    )
    .subscribe();
  syncRuntime = () => {
    disposed = true;
    if (syncTimer) clearTimeout(syncTimer);
    if (syncInterval) clearInterval(syncInterval);
    window.removeEventListener('online', handleOnline);
    void resumeListener.then((listener) => listener.remove());
    void supabase?.removeChannel(realtimeChannel);
    activeUserId = null;
  };
  return release;
}

/** Drops everything the singleton loop owns. Runs only when the last holder releases. */
function teardownSyncRuntime(): void {
  syncRuntime?.();
  syncRuntime = undefined;
  syncInterval = undefined;
  syncTimer = undefined;
}

/**
 * Empties the device of one account's data, at sign-out.
 *
 * The dialog promises "رفع بياناتك إلى حسابك أولًا، ثم تُحذف من هذا الجهاز",
 * so this must cover *everything* the account left behind. `khatmah` (the
 * reading plan) and `hifzReviews` (the memorisation schedule, `lapses` and all)
 * sync now but are still wiped here for the same reason the synced tables are:
 * the next person on this phone must not inherit the previous owner's progress,
 * one tap from being restored over their own. The hooks stay quiet for the
 * whole wipe, so none of it becomes tombstones against the account being
 * signed *out* of. The stored snapshots go too: they are full dumps, one tap
 * from being written over the next account.
 *
 * The table names are listed rather than imported from `@/utils/backup`: that
 * module pulls in the adhkar corpus, which pulls in the full Quran text — a
 * 1.3 MB chain that has no business sitting behind a sign-out button. They are
 * duplicated here deliberately; `backup.test.ts` keeps the two lists honest.
 */
export async function clearLocalUserData(): Promise<void> {
  // Quiet for the whole wipe: without this every `clear()` below would queue a
  // tombstone against the account the person is signing *out* of.
  const releaseHooks = suppressSyncWrites();
  try {
    await db.transaction(
      'rw',
      SYNC_TABLES.filter((name) => name !== 'adhkar').map((name) => db.table(name)),
      async () => {
        for (const name of SYNC_TABLES) {
          if (name !== 'adhkar') await db.table(name).clear();
        }
        await db.settings.put({ ...DEFAULT_SETTINGS, id: 1, syncId: 'settings', syncModifiedAt: 0 });
      },
    );
    localStorage.removeItem(ADHKAR_STORAGE_KEY);
    // Reading recency and the reader's saved position are local-only by design
    // (see `readingHistory`), so they are in no sync table and would otherwise
    // outlive the account on a shared phone.
    clearReadingHistory();
  } finally {
    releaseHooks();
  }

  // Outside the transaction: these are storage decisions, not database rows, and
  // `clearAllBackups` is the only thing that answers "whose phone is this?".
  //
  // Every queue goes, not just this account's: `activeUserId` is only set while
  // the sync loop is actually running, so a sign-out after a failed start would
  // have left the previous owner's queued deletions behind under a key nobody
  // would ever read again.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(DELETE_QUEUE_PREFIX)) localStorage.removeItem(key);
    }
    localStorage.removeItem(DEVICE_ID_KEY);
  } catch (error) {
    console.error('Could not clear local sync bookkeeping at sign-out:', error);
  }
  clearAllBackups();
}
