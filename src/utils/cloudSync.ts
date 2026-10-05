import type { Table } from 'dexie';
import { App } from '@capacitor/app';
import { db, DEFAULT_SETTINGS, type HifzPlan } from '@/db/database';
import { supabase } from '@/utils/supabaseClient';

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

const DELETE_QUEUE_PREFIX = 'zad-delete-queue:';
let activeUserId: string | null = null;
let applyingCloudChanges = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let syncInterval: ReturnType<typeof setInterval> | undefined;
let syncInFlight: Promise<void> | undefined;
let statusCallback: ((state: CloudSyncState) => void) | undefined;
let hooksInstalled = false;
let lastSyncedAt: string | null = null;

function publish(status: SyncStatus, error: string | null = null): void {
  statusCallback?.({ status, lastSyncedAt, error });
}

function syncIdFor(table: SyncTableName, row: SyncRow): string {
  if (typeof row.syncId === 'string' && row.syncId.length > 0) return row.syncId;
  switch (table) {
    case 'settings': return 'settings';
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

function queueDelete(table: SyncTableName, recordId: string): void {
  if (!activeUserId) return;
  const key = `${DELETE_QUEUE_PREFIX}${activeUserId}`;
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
  scheduleSync();
}

function installMutationHooks(): void {
  if (hooksInstalled) return;
  for (const name of SYNC_TABLES) {
    const table = db.table(name) as Table<SyncRow, number | string>;
    table.hook('creating').subscribe((_key, row) => {
      if (!applyingCloudChanges) {
        addMutationMetadata(name, row);
        scheduleSync();
      }
    });
    table.hook('updating').subscribe((changes, _key, row) => {
      if (!applyingCloudChanges) {
        changes.syncId = syncIdFor(name, row);
        changes.syncModifiedAt = Date.now();
        scheduleSync();
      }
    });
    table.hook('deleting').subscribe((_key, row) => {
      if (!applyingCloudChanges) queueDelete(name, syncIdFor(name, row));
    });
  }
  hooksInstalled = true;
}

function scheduleSync(): void {
  if (!activeUserId || applyingCloudChanges) return;
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

interface LocalTombstone {
  key: string;
  table: SyncTableName;
  recordId: string;
  modifiedAt: number;
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
      .range(start, start + pageSize - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const item = row as CloudRecord;
      if (!SYNC_TABLES.includes(item.table_name)) throw new Error('ظهر نوع سجل غير معروف في بيانات المزامنة.');
      records.set(`${item.table_name}:${item.record_id}`, item);
    }
    if (!data || data.length < pageSize) break;
  }
  return records;
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
        await db.plans.put(plan);
      }
      plansById.set(plan.id, id);
    }
  }
  for (const name of SYNC_TABLES) {
    const rows = await db.table(name).toArray() as SyncRow[];
    for (const row of rows) {
      if (name === 'tasks' && typeof row.planId === 'number' && typeof row.planSyncId !== 'string') {
        row.planSyncId = plansById.get(row.planId);
      }
      const recordId = syncIdFor(name, row);
      if (row.syncId !== recordId) {
        row.syncId = recordId;
        await db.table(name).put(row);
      }
      const key = `${name}:${recordId}`;
      if (local.has(key)) throw new Error(`تكرار معرّف مزامنة محلي في ${name}.`);
      local.set(key, { table: name, row });
    }
  }
  return local;
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
  const table = db.table(tableName);
  const row = await table.toCollection().filter((item: SyncRow) => item.syncId === recordId).first() as SyncRow | undefined;
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
  applyingCloudChanges = true;
  try {
    await db.transaction('rw', SYNC_TABLES.map((name) => db.table(name)), async () => {
      const applyPlan = async (remote: CloudRecord, placeholder: boolean) => {
        if (!remote.record_data || typeof remote.record_data !== 'object') {
          if (remote.is_deleted) return;
          throw new Error('وصل سجل سحابي ببنية غير صالحة.');
        }
        if (!isHifzPlan(remote.record_data)) throw new Error('وصلت خطة سحابية ببنية غير صالحة.');
        const existing = await db.plans.toCollection()
          .filter((item) => item.syncId === remote.record_id)
          .first();
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
        const localPlan = await db.plans.toCollection()
          .filter((item) => item.syncId === remote.record_id)
          .first();
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
          if (!taskData) throw new Error('تعذّر استعادة خطة مرتبطة بسجل حفظ.');
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
          await deleteLocalRecord(tableName, remote.record_id);
          continue;
        }
        if (!remote.record_data || typeof remote.record_data !== 'object') {
          throw new Error('وصل سجل سحابي ببنية غير صالحة.');
        }
        const table = db.table(tableName);
        const existing = await table.toCollection()
          .filter((item: SyncRow) => item.syncId === remote.record_id)
          .first() as SyncRow | undefined;
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
            throw new Error('وصلت مهمة من دون خطتها المرتبطة؛ المزامنة توقفت لحماية البيانات.');
          }
          row.planId = planIds.get(planSyncId);
          delete row.planSyncId;
        }
        if (tableName === 'settings') {
          row.id = 1;
        } else if (tableName === 'pageBookmarks') {
          if (typeof row.page !== 'number') throw new Error('علامة صفحة سحابية غير صالحة.');
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
    applyingCloudChanges = false;
  }
  localStorage.removeItem(`${DELETE_QUEUE_PREFIX}${activeUserId}`);
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
      ...parseDeleteQueue(userId),
    ];
    const changes = await makeCloudChanges(local, cloud, tombstones);
    for (let start = 0; start < changes.length; start += 200) {
      const { error } = await supabase.rpc('sync_user_records', { p_records: changes.slice(start, start + 200) });
      if (error) throw error;
    }
    const latest = await fetchCloudRecords(userId);
    await applyCloudRecords(latest);
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

export async function startCloudSync(
  userId: string,
  onStatus: (state: CloudSyncState) => void,
): Promise<() => void> {
  if (!supabase) throw new Error('إعداد الاتصال السحابي غير مكتمل.');
  activeUserId = userId;
  statusCallback = onStatus;
  installMutationHooks();
  publish('syncing');
  await synchronizeNow();
  syncInterval = setInterval(() => {
    void synchronizeNow().catch(() => {});
  }, 60_000);
  const handleOnline = () => { void synchronizeNow().catch(() => {}); };
  window.addEventListener('online', handleOnline);
  const resumeListener = App.addListener('resume', handleOnline);
  const realtimeChannel = supabase
    .channel(`user-sync-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_sync_records', filter: `user_id=eq.${userId}` },
      handleOnline,
    )
    .subscribe();
  return () => {
    if (syncTimer) clearTimeout(syncTimer);
    if (syncInterval) clearInterval(syncInterval);
    window.removeEventListener('online', handleOnline);
    void resumeListener.then((listener) => listener.remove());
    void supabase?.removeChannel(realtimeChannel);
    activeUserId = null;
    statusCallback = undefined;
  };
}

export async function clearLocalUserData(): Promise<void> {
  applyingCloudChanges = true;
  try {
    await db.transaction('rw', SYNC_TABLES.map((name) => db.table(name)), async () => {
      for (const name of SYNC_TABLES) await db.table(name).clear();
      await db.settings.put({ ...DEFAULT_SETTINGS, id: 1, syncId: 'settings', syncModifiedAt: 0 });
    });
  } finally {
    applyingCloudChanges = false;
  }
}
