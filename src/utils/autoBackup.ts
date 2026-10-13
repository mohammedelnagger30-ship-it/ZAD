/**
 * Automatic backup system for user data
 * Supports daily and weekly automatic backups
 */

import { db } from '@/db/database';
import {
  backupData,
  isValidAdhkarBackup,
  isValidBackupRow,
  BACKUP_TABLES,
  ADHKAR_STATE_KEY,
} from '@/utils/backup';
import { todayKey } from '@/utils/dateUtils';

const AUTO_BACKUP_KEY = 'zad:auto-backup-config';
const LAST_BACKUP_KEY = 'zad:last-backup';

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
    const backup = await backupData();
    const today = todayKey();
    const config = getAutoBackupConfig();

    // Store backup with timestamp
    const backupKey = `zad:backup:${today}`;
    localStorage.setItem(backupKey, JSON.stringify(backup));

    // Update last backup date
    setLastBackupDate(today);
    config.lastBackupDate = today;
    saveAutoBackupConfig(config);

    // Clean up old backups if exceeding maxBackups
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
      if (key?.startsWith('zad:backup:')) {
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
 * Get list of all automatic backups
 */
export function getAutoBackups(): Array<{ date: string; key: string }> {
  try {
    const backups: Array<{ date: string; key: string }> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('zad:backup:')) {
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
 */
export async function restoreFromBackup(key: string): Promise<boolean> {
  try {
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

    await db.transaction(
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
