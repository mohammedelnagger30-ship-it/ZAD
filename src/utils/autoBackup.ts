/**
 * Automatic backup system for user data
 * Supports daily and weekly automatic backups
 */

import { db } from '@/db/database';
// `@/utils/backup` is deliberately NOT imported statically: it pulls in the
// adhkar corpus, which in turn pulls in the full Quran text (adhkar quotes
// ayahs) — a 1.3 MB chain that used to sit in the main bundle for the sake of
// an hourly job. Both callers below are async, so the module is loaded on
// demand and the heavy data rides in a lazily-fetched chunk instead.
import { todayKey } from '@/utils/dateUtils';
import { withSyncSuppressed } from '@/utils/syncSuppression';

const AUTO_BACKUP_KEY = 'zad:auto-backup-config';
const LAST_BACKUP_KEY = 'zad:last-backup';
/** Every snapshot is stored under this prefix; the writer and every reader agree on it here, in one place. */
const AUTO_BACKUP_PREFIX = 'zad:backup:';

export interface AutoBackupConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  lastBackupDate: string | null;
  maxBackups: number;
}

const DEFAULT_CONFIG: AutoBackupConfig = {
  enabled: false,
  frequency: 'weekly',
  lastBackupDate: null,
  maxBackups: 5,
};

export function getAutoBackupConfig(): AutoBackupConfig {
  try {
    const raw = localStorage.getItem(AUTO_BACKUP_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveAutoBackupConfig(config: AutoBackupConfig): void {
  try {
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Failed to save auto-backup config:', error);
  }
}

export function getLastBackupDate(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

export function setLastBackupDate(date: string): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, date);
  } catch (error) {
    console.error('Failed to save last backup date:', error);
  }
}

/**
 * Check if a backup is needed based on the configured frequency
 */
export function shouldBackup(): boolean {
  const config = getAutoBackupConfig();
  if (!config.enabled) return false;

  const lastBackup = getLastBackupDate();
  if (!lastBackup) return true;

  const today = todayKey();
  const lastBackupDate = new Date(lastBackup);
  const currentDate = new Date(today);

  const diffTime = currentDate.getTime() - lastBackupDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  switch (config.frequency) {
    case 'daily':
      return diffDays >= 1;
    case 'weekly':
      return diffDays >= 7;
    case 'monthly':
      return diffDays >= 30;
    default:
      return false;
  }
}

/**
 * Perform automatic backup
 */
export async function performAutoBackup(): Promise<boolean> {
  try {
    const { backupData } = await import('@/utils/backup');
    const backup = await backupData();
    const today = todayKey();
    const config = getAutoBackupConfig();

    // Store backup with timestamp
    const backupKey = `${AUTO_BACKUP_PREFIX}${today}`;
    const payload = JSON.stringify(backup);

    // Write first, clean afterwards — and when the write is refused for want of
    // room, clean *then* and try once more. Cleanup used to run only after a
    // successful write, so a full store failed the write, skipped the very
    // step that would have made room, and failed identically every hour after:
    // the newest snapshot was never taken, and nothing anywhere said so.
    try {
      localStorage.setItem(backupKey, payload);
    } catch {
      console.warn('Auto backup hit the storage ceiling; trimming older snapshots to make room.');
      await cleanupOldBackups(Math.max(0, config.maxBackups - 1));
      localStorage.setItem(backupKey, payload);
    }

    // Update last backup date
    setLastBackupDate(today);
    config.lastBackupDate = today;
    saveAutoBackupConfig(config);

    // Trim to the configured count as well: the retry above may have left one
    // more than asked for when today's key was already the one being evicted.
    await cleanupOldBackups(config.maxBackups);

    return true;
  } catch (error) {
    console.error('Auto backup failed:', error);
    return false;
  }
}

/**
 * Remove old backups, keeping only the most recent ones
 */
async function cleanupOldBackups(maxBackups: number): Promise<void> {
  try {
    const backupKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(AUTO_BACKUP_PREFIX)) {
        backupKeys.push(key);
      }
    }

    // Sort by date (newest first)
    backupKeys.sort((a, b) => {
      const dateA = a.split(':')[2];
      const dateB = b.split(':')[2];
      return dateB.localeCompare(dateA);
    });

    // Remove old backups
    if (backupKeys.length > maxBackups) {
      const toRemove = backupKeys.slice(maxBackups);
      toRemove.forEach((key) => localStorage.removeItem(key));
    }
  } catch (error) {
    console.error('Failed to cleanup old backups:', error);
  }
}

/**
 * Removes every stored snapshot.
 *
 * Not a "keep the newest few" moment. These are full dumps of one person's
 * data, and the restore button is a single tap: when an account signs out on
 * a shared phone, anything left here is the previous owner's life one tap
 * away from being written over the next person's database. So signing out
 * empties the whole set rather than trimming it.
 *
 * Uses the same prefix the writer uses, so the two cannot drift apart.
 */
export function clearAllBackups(): void {
  try {
    // Walk backwards: removing a key shifts every index after it.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(AUTO_BACKUP_PREFIX)) localStorage.removeItem(key);
    }
  } catch (error) {
    console.error('Failed to clear backups:', error);
  }
}

/**
 * Get list of all automatic backups
 */
export function getAutoBackups(): Array<{ date: string; key: string }> {
  try {
    const backups: Array<{ date: string; key: string }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(AUTO_BACKUP_PREFIX)) {
        const date = key.split(':')[2];
        backups.push({ date, key });
      }
    }
    // Sort by date (newest first)
    return backups.sort((a, b) => b.date.localeCompare(a.date));
  } catch {
    return [];
  }
}

/**
 * Restore from an automatic backup.
 *
 * A stored backup is the last-resort recovery path, so this never trusts it: the
 * payload is parsed and every row is validated with the same `isValidBackupRow`
 * rules the file importer uses *before* a single existing row is touched. The
 * restore itself runs as one read-write transaction — if any write fails mid-way
 * IndexedDB rolls the whole thing back, so the previous data survives instead of
 * being replaced by a half-restored state. (This used to call `db.delete()` first,
 * which destroyed everything before the payload was even looked at.)
 *
 * The sync hooks are held quiet across that transaction, and this matters more
 * than the rollback does. `clear()` fires Dexie's `deleting` hook per row, and the
 * hook answers by enqueuing a tombstone into `localStorage` — outside the very
 * transaction doing the restore. So a restore that *failed* rolled the local rows
 * back while keeping every queued deletion, and the next sync round then deleted
 * the account's cloud data: the recovery path destroyed the other copy of what it
 * was meant to recover. Suppression is also what makes a successful restore a
 * local act, which is what a restore is — the two copies reconcile by their own
 * timestamps on the next round, instead of a week-old backup overwriting newer
 * work on every device the person owns.
 */
export async function restoreFromBackup(key: string): Promise<boolean> {
  try {
    const { isValidAdhkarBackup, isValidBackupRow, BACKUP_TABLES, ADHKAR_STATE_KEY } =
      await import('@/utils/backup');
    const raw = localStorage.getItem(key);
    if (!raw) return false;

    const backup: unknown = JSON.parse(raw);
    if (!backup || typeof backup !== 'object' || Array.isArray(backup)) return false;
    const data = backup as Record<string, unknown>;

    // Validate every table before touching the database.
    for (const table of BACKUP_TABLES) {
      const rows = data[table];
      if (rows === undefined || rows === null) continue;
      if (!Array.isArray(rows)) return false;
      if (!rows.every((row) => isValidBackupRow(table, row))) return false;
    }
    if (data.adhkar !== undefined && !isValidAdhkarBackup(data.adhkar)) return false;

    await withSyncSuppressed(() =>
      db.transaction(
        'rw',
        BACKUP_TABLES.map((name) => db.table(name)),
        async () => {
          for (const table of BACKUP_TABLES) {
            const rows = data[table];
            if (!Array.isArray(rows)) continue;
            const tableRef = db.table(table);
            await tableRef.clear();
            // Settings are stored as a one-row array; a missing row means "no
            // settings in this backup" and must not put a bare array into the table.
            const records = (rows as Record<string, unknown>[]).filter(
              (row) => row !== undefined && row !== null,
            );
            if (records.length > 0) await tableRef.bulkPut(records);
          }
        },
      ),
    );

    if (data.adhkar !== undefined) {
      localStorage.setItem(ADHKAR_STATE_KEY, JSON.stringify(data.adhkar));
    }

    return true;
  } catch (error) {
    console.error('Restore from backup failed:', error);
    return false;
  }
}

/**
 * Initialize auto-backup check on app startup
 */
let autoBackupStarted = false;
export function initAutoBackup(): void {
  // Guard against double-registration: the app calls this from the settings effect,
  // which re-runs on every settings change — without the latch each edit stacked
  // another hourly interval on top of the previous ones.
  if (autoBackupStarted) return;
  autoBackupStarted = true;

  // Check if backup is needed on startup
  if (shouldBackup()) {
    void performAutoBackup();
  }

  // Set up periodic check (every hour)
  setInterval(() => {
    if (shouldBackup()) {
      void performAutoBackup();
    }
  }, 60 * 60 * 1000);
}
