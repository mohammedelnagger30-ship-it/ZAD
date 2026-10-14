import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * The sync path must survive a corrupt delete queue.
 *
 * `parseDeleteQueue` rejects anything that is not an array, and synchronizeNow
 * used to let that rejection escape: one malformed localStorage entry then failed
 * *every* sync round — permanently, silently, with no self-heal — while the app
 * otherwise looked perfectly healthy. These cases pin down the tolerant read that
 * replaced it: a bad queue costs at most one resurrected record on the next pull,
 * never the whole of cloud sync.
 *
 * cloudSync itself pulls in Vite's `import.meta.env` (via supabaseClient) and the
 * Dexie handle, neither of which exists under Jest — the queue is pure localStorage,
 * so both are stubbed *for this file only*. A global moduleNameMapper would leak the
 * stubs into the tests that do exercise the real database.
 */
jest.unstable_mockModule('@/utils/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));
jest.unstable_mockModule('@/db/database', () => ({
  db: {},
  DEFAULT_SETTINGS: {},
}));

const { readDeleteQueue } = await import('@/utils/cloudSync');

const KEY = 'zad-delete-queue:user-1';

describe('readDeleteQueue', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it('returns an empty queue when nothing is stored', () => {
    expect(readDeleteQueue('user-1')).toEqual([]);
  });

  it('reads a well-formed queue', () => {
    const row = { key: 'tasks:task-1', table: 'tasks', recordId: 'task-1', modifiedAt: 17 };
    localStorage.setItem(KEY, JSON.stringify([row]));
    expect(readDeleteQueue('user-1')).toEqual([row]);
  });

  it('drops entries whose shape is wrong, keeping the rest', () => {
    const good = { key: 'tasks:task-1', table: 'tasks', recordId: 'task-1', modifiedAt: 17 };
    const wrongTable = { key: 'x', table: 'not-a-sync-table', recordId: 'x', modifiedAt: 1 };
    const noRecordId = { key: 'y', table: 'tasks', modifiedAt: 1 };
    localStorage.setItem(KEY, JSON.stringify([good, wrongTable, noRecordId]));
    expect(readDeleteQueue('user-1')).toEqual([good]);
  });

  it('discards a value that is not an array instead of failing the sync round', () => {
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(readDeleteQueue('user-1')).toEqual([]);
    // The unreadable entry is cleared, so the next round is quiet rather than
    // logging the same dead-end every sixty seconds.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('survives storage contents that do not even parse', () => {
    localStorage.setItem(KEY, '{not json at all');
    expect(readDeleteQueue('user-1')).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
