/**
 * Ask the browser or the WebView not to evict this app's storage.
 *
 * Everything the app knows lives in IndexedDB — memorization progress, prayer records,
 * bookmarks, downloaded tafsir and recitation audio — and all of it is evictable by
 * default: "clear browsing data", storage pressure on a phone, or a private-mode restart
 * deletes the databases without a word and without an error. A granted persist() mark is
 * the only thing that takes that off the table, and it is granted once and remembered by
 * the browser thereafter.
 *
 * The request is silent and best-effort on purpose. Safari does not implement persist(),
 * a WebView may refuse it, and a refusal changes nothing about how the app behaves — it
 * simply keeps the risk it already had. So this never blocks, never prompts, and never
 * shows the reader a question they cannot answer.
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (!storage || typeof storage.persist !== 'function') return false;
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch (error) {
    console.warn('Persistent storage was not granted:', error);
    return false;
  }
}

/**
 * Whether this app's storage is protected from eviction — for a storage screen to say
 * so plainly, since the difference only ever shows up on the day it matters.
 */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    const storage = navigator.storage;
    if (!storage || typeof storage.persisted !== 'function') return null;
    return await storage.persisted();
  } catch {
    return null;
  }
}
