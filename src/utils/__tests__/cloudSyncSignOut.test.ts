import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Sign-out must leave nothing of the previous account on the device.
 *
 * The dialog tells the user their data is uploaded and then removed from this
 * device. It used to clear only the nine tables that *sync* — leaving the
 * reading plan (`khatmah`), the memorisation schedule (`hifzReviews`), every
 * stored auto-backup snapshot and the queued deletions behind. On a shared
 * phone that is the previous owner's progress, one tap from being restored
 * over the next person's database.
 *
 * Dexie and Supabase are stubbed for this file only (a global moduleNameMapper
 * would leak the stubs into the tests that exercise the real database). The
 * stub records which tables were cleared rather than simulating storage — the
 * question under test is "what does sign-out touch", not "does IndexedDB work".
 */

const cleared: string[] = [];

const stubTable = (name: string) => ({
  clear: async () => {
    cleared.push(name);
  },
  put: async () => undefined,
});

jest.unstable_mockModule('@/db/database', () => ({
  db: {
    table: (name: string) => stubTable(name),
    khatmah: stubTable('khatmah'),
    hifzReviews: stubTable('hifzReviews'),
    settings: stubTable('settings'),
    transaction: async (_mode: string, _tables: unknown, scope: () => Promise<void>) => scope(),
  },
  DEFAULT_SETTINGS: { id: 1 },
}));

jest.unstable_mockModule('@/utils/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

const { clearLocalUserData } = await import('@/utils/cloudSync');

const AUTO_BACKUP_PREFIX = 'zad:backup:';

describe('clearLocalUserData', () => {
  beforeEach(() => {
    cleared.length = 0;
    localStorage.clear();
  });

  it('clears the local-only tables the sync set never covered', async () => {
    await clearLocalUserData();

    expect(cleared).toEqual(
      expect.arrayContaining(['khatmah', 'hifzReviews', 'settings']),
    );
  });

  it('clears every synced table, not only the local-only ones', async () => {
    await clearLocalUserData();

    for (const table of ['plans', 'tasks', 'bookmarks', 'pageBookmarks',
      'prayerRecords', 'sunnahRecords', 'hifzProgress', 'hadithFavorites']) {
      expect(cleared).toContain(table);
    }
  });

  it('removes every stored auto-backup snapshot', async () => {
    localStorage.setItem(`${AUTO_BACKUP_PREFIX}2026-10-01`, '{"settings":[]}');
    localStorage.setItem(`${AUTO_BACKUP_PREFIX}2026-10-02`, '{"settings":[]}');
    localStorage.setItem('zad:auto-backup-config', '{"enabled":true}');

    await clearLocalUserData();

    expect(localStorage.getItem(`${AUTO_BACKUP_PREFIX}2026-10-01`)).toBeNull();
    expect(localStorage.getItem(`${AUTO_BACKUP_PREFIX}2026-10-02`)).toBeNull();
    // The configuration is a preference, not a dump of the account's data.
    expect(localStorage.getItem('zad:auto-backup-config')).not.toBeNull();
  });

  it('removes queued deletions and the device identity, whatever account they belonged to', async () => {
    localStorage.setItem('zad-delete-queue:user-a', '[{"table":"tasks"}]');
    localStorage.setItem('zad-delete-queue:user-b', '[{"table":"plans"}]');
    localStorage.setItem('zad:device-id', 'a-device-id');

    await clearLocalUserData();

    expect(localStorage.getItem('zad-delete-queue:user-a')).toBeNull();
    expect(localStorage.getItem('zad-delete-queue:user-b')).toBeNull();
    expect(localStorage.getItem('zad:device-id')).toBeNull();
  });

  it('leaves the adhkar counters cleared too', async () => {
    localStorage.setItem('hifzi-adhkar-state', '{"categories":{}}');

    await clearLocalUserData();

    expect(localStorage.getItem('hifzi-adhkar-state')).toBeNull();
  });
});
