import { describe, it, expect } from '@jest/globals';
import { BACKUP_TABLES, isValidBackupRow, pickSettingsRow } from '@/utils/backup';
import { DEFAULT_SETTINGS } from '@/db/database';
import { TOTAL_QURAN_PAGES } from '@/data/surahs';

/**
 * The import path's gate: user-supplied JSON only reaches Dexie through
 * `isValidBackupRow`. Rows here mirror the shapes the app itself writes —
 * bounds are taken from the bundled mushaf data, not hardcoded folklore.
 */
describe('isValidBackupRow', () => {
  it('accepts a khatmah plan row shaped like the table', () => {
    expect(isValidBackupRow('khatmah', { startDate: '2026-10-10', targetDate: null, currentPage: 12, updatedAt: 1 })).toBe(true);
    expect(isValidBackupRow('khatmah', { startDate: '2026-10-10', targetDate: '2026-11-08', currentPage: 0, updatedAt: 1 })).toBe(true);
  });

  it('rejects impossible dates and negative progress', () => {
    expect(isValidBackupRow('khatmah', { startDate: '2026-02-30', targetDate: null, currentPage: 0, updatedAt: 1 })).toBe(false);
    expect(isValidBackupRow('khatmah', { startDate: '2026-10-10', targetDate: null, currentPage: -1, updatedAt: 1 })).toBe(false);
    expect(isValidBackupRow('khatmah', { startDate: 'yesterday', targetDate: null, currentPage: 0, updatedAt: 1 })).toBe(false);
  });

  it('bounds page bookmarks to the bundled page count', () => {
    expect(isValidBackupRow('pageBookmarks', { page: TOTAL_QURAN_PAGES, createdAt: 1 })).toBe(true);
    expect(isValidBackupRow('pageBookmarks', { page: TOTAL_QURAN_PAGES + 1, createdAt: 1 })).toBe(false);
    expect(isValidBackupRow('pageBookmarks', { page: 0, createdAt: 1 })).toBe(false);
  });

  it('enforces HH:MM times on plans', () => {
    const plan = { name: 'ورد', type: 'hifz', portion: 'الكهف', daysOfWeek: [0, 5], createdAt: 1, active: true };
    expect(isValidBackupRow('plans', { ...plan, time: '05:30' })).toBe(true);
    expect(isValidBackupRow('plans', { ...plan, time: '25:00' })).toBe(false);
    expect(isValidBackupRow('plans', { ...plan, time: '5:30' })).toBe(false);
  });

  it('lists every table the exporter writes', () => {
    expect(BACKUP_TABLES).toContain('settings');
    expect(BACKUP_TABLES).toContain('khatmah');
    expect(BACKUP_TABLES).toContain('hadithFavorites');
    // The spaced-repetition schedule, and the one a second hand-written copy
    // of the exporter once dropped: an export that omitted it left the import
    // reporting success over a database still holding the old intervals.
    expect(BACKUP_TABLES).toContain('hifzReviews');
  });
});

describe('pickSettingsRow', () => {
  it('returns the canonical row when the table holds only it', () => {
    const row = { ...DEFAULT_SETTINGS, id: 1 };
    expect(pickSettingsRow([row])).toBe(row);
  });

  // The regression this rule exists for: the exporter used to ask for id 1 by name, so
  // an install still carrying a legacy row id exported `[null]`, and the validator on
  // the restoring device then threw the entire file away.
  it('finds a legacy row the old exporter missed, and the validator still accepts it', () => {
    const legacy = { ...DEFAULT_SETTINGS, id: 7 };
    const picked = pickSettingsRow([{ ...DEFAULT_SETTINGS, id: 12 }, legacy]);
    expect(picked).toBe(legacy);
    expect(isValidBackupRow('settings', picked)).toBe(true);
  });

  it('prefers the lowest id, matching what getSettings() reads back', () => {
    const lowest = { ...DEFAULT_SETTINGS, id: 2 };
    expect(pickSettingsRow([{ ...DEFAULT_SETTINGS, id: 5 }, lowest])).toBe(lowest);
  });

  it('reports an empty table rather than inventing a row', () => {
    expect(pickSettingsRow([])).toBeUndefined();
  });
});
