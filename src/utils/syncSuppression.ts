/**
 * Quiets the sync mutation hooks for writes that are not the person editing
 * their data.
 *
 * Dexie's `creating`/`updating`/`deleting` hooks are what turn an ordinary local
 * write into something cloud sync reacts to: a stamp, a scheduled round, a
 * tombstone pushed to the server. That is right for an edit and wrong for four
 * other kinds of write:
 *
 *   * applying a round pulled from the server (echoing it back would loop);
 *   * a schema repair inside the database (a "repair" that re-stamps rows as
 *     brand-new edits, or tombstones the very row that just survived);
 *   * wiping the device at sign-out (a storm of tombstones against the account
 *     being signed out of);
 *   * **restoring a backup** — the one this module exists for. Restoring clears
 *     every synced table and puts the backup's rows back. Without suppression
 *     each `clear()` enqueues a tombstone per row, into `localStorage`, *outside*
 *     the Dexie transaction that carries the restore. If the restore then failed
 *     and rolled back — a row that passes validation but violates the schema —
 *     the local data survived while the queued deletions did not, and the next
 *     sync round quietly deleted the account's cloud data. A recovery path that
 *     destroys the other copy of the data is worse than no recovery path.
 *
 * The depth is a counter rather than a boolean because these nest: a restore
 * inside an apply round must not hand the hooks back when it finishes.
 */
let depth = 0;

/**
 * Suppresses the hooks until the returned function is called.
 *
 * Call it before the first write and release it in a `finally` — the release is
 * idempotent, so a double cleanup cannot lift the guard early and expose the
 * writes still running underneath.
 */
export function suppressSyncWrites(): () => void {
  depth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth -= 1;
  };
}

/** True while the hooks and `scheduleSync` must stay quiet. */
export function isSyncSuppressed(): boolean {
  return depth > 0;
}

/** Runs `work` under suppression, releasing it on the way out whatever happens. */
export async function withSyncSuppressed<T>(work: () => Promise<T>): Promise<T> {
  const release = suppressSyncWrites();
  try {
    return await work();
  } finally {
    release();
  }
}
