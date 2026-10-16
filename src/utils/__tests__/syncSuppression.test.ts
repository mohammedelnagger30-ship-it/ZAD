import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Restoring a backup must not delete anything from the cloud.
 *
 * A restore clears every synced table and puts the backup's rows back. Each
 * `clear()` raises Dexie's `deleting` hook per row, and the hook's answer is to
 * enqueue a tombstone — into `localStorage`, outside the very transaction doing
 * the restore. So a restore that *failed* rolled the local rows back while
 * keeping every queued deletion, and the next sync round then deleted the
 * account's cloud data: the recovery path destroyed the other copy of what it
 * was meant to recover. The same held for a successful restore, which turned a
 * local recovery into a wipe of every device the person owns.
 *
 * The first group pins the suppression primitive itself — depth, not a boolean,
 * because an apply round around a restore must not have the hooks handed back
 * when the restore finishes. The second proves the wiring: the restore runs its
 * writes under it, on the failure path included.
 *
 * Dexie and Supabase are stubbed for this file only. The stub records the
 * condition the real `deleting` hook tests, instead of acting on it.
 */

const tombstones: string[] = [];
const suppressedDuring: boolean[] = [];

const noteSuppression = (what: string) => {
  const quiet = isSyncSuppressed();
  suppressedDuring.push(quiet);
  if (!quiet) tombstones.push(what);
};

/**
 * Tables are memoized by name: `restoreFromBackup` calls `db.table()` afresh
 * for each one, so a fresh object per call would make its write unreachable to
 * a spy set up beforehand.
 */
const tables = new Map<string, ReturnType<typeof makeTable>>();

function makeTable(name: string) {
  return {
    clear: async () => noteSuppression(`${name}:cleared`),
    bulkPut: async (rows: unknown[]) => {
      for (const row of rows) noteSuppression(`${name}:put:${JSON.stringify(row)}`);
    },
  };
}

jest.unstable_mockModule('@/db/database', () => ({
  db: {
    table: (name: string) => {
      const existing = tables.get(name);
      if (existing) return existing;
      const fresh = makeTable(name);
      tables.set(name, fresh);
      return fresh;
    },
    transaction: (_mode: string, _tables: unknown, scope: () => Promise<void>) => scope(),
  },
  DEFAULT_SETTINGS: {},
}));

jest.unstable_mockModule('@/utils/backup', () => ({
  BACKUP_TABLES: ['settings', 'plans'],
  ADHKAR_STATE_KEY: 'hifzi-adhkar-state',
  isValidBackupRow: () => true,
  isValidAdhkarBackup: () => true,
}));

const { withSyncSuppressed, suppressSyncWrites, isSyncSuppressed } = await import(
  '@/utils/syncSuppression'
);
const { restoreFromBackup } = await import('@/utils/autoBackup');

const BACKUP_KEY = 'zad:backup:test';

describe('sync write suppression', () => {
  beforeEach(() => {
    tombstones.length = 0;
    suppressedDuring.length = 0;
    tables.clear();
    localStorage.clear();
    localStorage.setItem(
      BACKUP_KEY,
      JSON.stringify({ settings: [{ id: 1 }], plans: [{ id: 7 }] }),
    );
  });

  it('is off until something asks for it', () => {
    expect(isSyncSuppressed()).toBe(false);
  });

  it('holds for the whole of the work and releases afterwards', async () => {
    const inside = await withSyncSuppressed(async () => {
      await Promise.resolve();
      return isSyncSuppressed();
    });

    expect(inside).toBe(true);
    // Read outside the callback — inside it the guard is of course still held.
    expect(isSyncSuppressed()).toBe(false);
  });

  it('stays off even when the work throws', async () => {
    await expect(
      withSyncSuppressed(async () => {
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');

    expect(isSyncSuppressed()).toBe(false);
  });

  it('survives a double release, which would otherwise lift it early', () => {
    const release = suppressSyncWrites();
    release();
    release();

    expect(isSyncSuppressed()).toBe(false);

    const outer = suppressSyncWrites();
    expect(isSyncSuppressed()).toBe(true);
    outer();
    expect(isSyncSuppressed()).toBe(false);
  });

  it('is still on when a nested write releases inside a wider one', async () => {
    await withSyncSuppressed(async () => {
      await withSyncSuppressed(async () => {
        expect(isSyncSuppressed()).toBe(true);
      });
      // The inner write finishing must not hand the hooks back to whatever apply
      // round or sign-out wipe is still running underneath.
      expect(isSyncSuppressed()).toBe(true);
    });

    expect(isSyncSuppressed()).toBe(false);
  });

  it('runs a restore’s writes with the hooks quiet — no cloud deletions queued', async () => {
    const restored = await restoreFromBackup(BACKUP_KEY);

    expect(restored).toBe(true);
    expect(suppressedDuring.length).toBeGreaterThan(0);
    expect(suppressedDuring.every(Boolean)).toBe(true);
    expect(tombstones).toEqual([]);
  });

  it('queues nothing on the failure path, where the rows roll back anyway', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    // Make the writes happen after the clears have already run: the exact
    // sequence that used to leave every deletion behind for the next round.
    const plans = tables.get('plans') ?? makeTable('plans');
    const failing = jest
      .spyOn(plans, 'bulkPut')
      .mockRejectedValueOnce(new Error('a row the schema refuses'));
    tables.set('plans', plans);

    const restored = await restoreFromBackup(BACKUP_KEY);

    expect(restored).toBe(false);
    expect(suppressedDuring.length).toBeGreaterThan(0);
    expect(suppressedDuring.every(Boolean)).toBe(true);
    expect(tombstones).toEqual([]);
    // And the guard is handed back so the next round can run normally.
    expect(isSyncSuppressed()).toBe(false);

    failing.mockRestore();
    jest.restoreAllMocks();
  });
});
