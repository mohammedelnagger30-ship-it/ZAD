import { describe, it, expect } from '@jest/globals';
import { BACKUP_TABLES, isValidBackupRow } from '@/utils/backup';
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
  });
});
