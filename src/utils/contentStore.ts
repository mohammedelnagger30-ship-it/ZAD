// Downloadable content store — tafsir, hadith text and Quran audio kept on the device.
//
// The Quran text is bundled with the app (see `data/quranText.ts`), but the tafsirs and
// hadith collections are far too large for that: the eight Arabic tafsirs total ~316 MB
// and the nine hadith collections ~46 MB. So they are fetched from their open sources on
// demand and written here, which makes them part of the app for good — after a download
// they work with no network at all.
//
// A separate Dexie database is used (rather than adding a table to `db/database.ts`) so
// that clearing downloaded content can never touch the user's plans, bookmarks or records.

import Dexie, { type Table } from 'dexie';

/** One cached file. `text` holds the raw JSON exactly as downloaded. */
export interface ContentFile {
  /** `tafsir:<edition>:<surah>` or `hadith:<collection>`. */
  key: string;
  kind: 'tafsir' | 'hadith';
  /** Edition or collection id, without the kind prefix. */
  group: string;
  /** Surah number for tafsir files; 0 for whole-collection files. */
  surah: number;
  text: string;
  /** Byte length of the decoded UTF-8 text, for the storage summary. */
  bytes: number;
  savedAt: number;
}

export interface AudioTrack {
  key: string;
  reciterId: string;
  surah: number;
  blob: Blob;
  bytes: number;
  verseTimings: Array<{ ayah: number; startMs: number; endMs: number }>;
  savedAt: number;
}

class ContentDatabase extends Dexie {
  files!: Table<ContentFile, string>;
  audioTracks!: Table<AudioTrack, string>;

  constructor() {
    super('hifzi-content');
    this.version(1).stores({
      // `kind` and `group` are indexed so listing / deleting a whole edition is a query
      // rather than a full scan over hundreds of files.
      files: 'key, kind, group, [kind+group]',
    });
    this.version(2).stores({
      files: 'key, kind, group, [kind+group]',
      audioTracks: 'key, reciterId, surah, [reciterId+surah]',
    });
  }
}

let db: ContentDatabase | null = null;

function database(): ContentDatabase {
  db ??= new ContentDatabase();
  return db;
}

/** True when IndexedDB is usable. Private browsing modes can refuse it. */
export function isContentStoreAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function tafsirKey(editionId: string, surah: number): string {
  return `tafsir:${editionId}:${surah}`;
}

export function hadithKey(collectionId: string): string {
  return `hadith:${collectionId}`;
}

export function audioTrackKey(reciterId: string, surah: number): string {
  return `audio:${reciterId}:${surah}`;
}

export async function audioStatusInStore(reciterId: string): Promise<Set<number>> {
  if (!isContentStoreAvailable()) return new Set();
  const tracks = await database().audioTracks.where('reciterId').equals(reciterId).toArray();
  return new Set(tracks.map((track) => track.surah));
}

export async function readAudioTrack(
  reciterId: string,
  surah: number,
): Promise<AudioTrack | null> {
  if (!isContentStoreAvailable()) return null;
  return (await database().audioTracks.get(audioTrackKey(reciterId, surah))) ?? null;
}

export async function writeAudioTrack(
  reciterId: string,
  surah: number,
  blob: Blob,
  verseTimings: AudioTrack['verseTimings'],
): Promise<number> {
  const key = audioTrackKey(reciterId, surah);
  await database().audioTracks.put({
    key,
    reciterId,
    surah,
    blob,
    bytes: blob.size,
    verseTimings,
    savedAt: Date.now(),
  });
  return blob.size;
}

export async function removeAudioSurah(reciterId: string, surah: number): Promise<number> {
  if (!isContentStoreAvailable()) return 0;
  const count = await database().audioTracks
    .where('[reciterId+surah]')
    .equals([reciterId, surah])
    .delete();
  notify();
  return count;
}

export async function removeAudioReciter(reciterId: string): Promise<number> {
  if (!isContentStoreAvailable()) return 0;
  const count = await database().audioTracks.where('reciterId').equals(reciterId).delete();
  notify();
  return count;
}

export function notifyContentChanged(): void {
  notify();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** All cached files for a kind, newest first. */
export async function listFiles(kind?: 'tafsir' | 'hadith'): Promise<ContentFile[]> {
  if (!isContentStoreAvailable()) return [];
  const all = kind
    ? await database().files.where('kind').equals(kind).toArray()
    : await database().files.toArray();
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** Every cached tafsir surah of one edition, keyed by surah number. */
export async function tafsirSurahsInStore(editionId: string): Promise<Set<number>> {
  if (!isContentStoreAvailable()) return new Set();
  const rows = await database().files
    .where('[kind+group]')
    .equals(['tafsir', editionId])
    .primaryKeys();
  const out = new Set<number>();
  for (const key of rows) {
    const surah = Number(String(key).split(':')[2]);
    if (Number.isFinite(surah)) out.add(surah);
  }
  return out;
}

/** Every collection id that has been downloaded. */
export async function hadithBooksInStore(): Promise<Set<string>> {
  if (!isContentStoreAvailable()) return new Set();
  const rows = await database().files.where('kind').equals('hadith').primaryKeys();
  const out = new Set<string>();
  for (const key of rows) out.add(String(key).split(':')[1]);
  return out;
}

export async function readText(key: string): Promise<string | null> {
  if (!isContentStoreAvailable()) return null;
  const row = await database().files.get(key);
  return row?.text ?? null;
}

export async function isDownloaded(key: string): Promise<boolean> {
  if (!isContentStoreAvailable()) return false;
  return (await database().files.get(key)) !== undefined;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function writeText(
  key: string,
  text: string,
  meta: { kind: 'tafsir' | 'hadith'; group: string; surah: number },
): Promise<number> {
  const bytes = byteLength(text);
  await database().files.put({
    key,
    kind: meta.kind,
    group: meta.group,
    surah: meta.surah,
    text,
    bytes,
    savedAt: Date.now(),
  });
  notify();
  return bytes;
}

/** Removes every cached file of one group (an edition or a collection). */
export async function removeGroup(kind: 'tafsir' | 'hadith', group: string): Promise<number> {
  if (!isContentStoreAvailable()) return 0;
  const count = await database().files.where('[kind+group]').equals([kind, group]).delete();
  notify();
  return count;
}

/** Removes everything. Used by "clear all downloads" in the library screen. */
export async function removeAll(): Promise<number> {
  if (!isContentStoreAvailable()) return 0;
  const contentDb = database();
  const count = (await contentDb.files.count()) + (await contentDb.audioTracks.count());
  await contentDb.transaction('rw', contentDb.files, contentDb.audioTracks, async () => {
    await contentDb.files.clear();
    await contentDb.audioTracks.clear();
  });
  notify();
  return count;
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------
//
// Screens that show download state (the library, the tafsir sheet) subscribe with
// `useContentStore`, so a download finishing anywhere updates every open view without
// them having to poll.

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToContent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken subscriber must not abort the write that triggered it.
    }
  }
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  /** Bytes received so far. */
  received: number;
  /** Total bytes, or 0 when the server sends no content-length. */
  total: number;
}

export async function downloadSurahAudioFile(
  reciterId: string,
  surah: number,
  url: string,
  verseTimings: AudioTrack['verseTimings'],
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  let response: Response;
  try {
    response = await fetch(url, { signal, mode: 'cors', redirect: 'follow' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ContentDownloadError('تعذّر الاتصال بمصدر التلاوة', err);
  }

  if (!response.ok) {
    throw new ContentDownloadError(
      response.status === 404
        ? 'تلاوة هذه السورة غير متاحة لهذا القارئ'
        : `فشل تحميل التلاوة (${response.status})`,
    );
  }

  let blob: Blob;
  if (!response.body) {
    blob = await response.blob();
    onProgress?.({ received: blob.size, total: blob.size });
  } else {
    const declared = Number(response.headers.get('content-length') ?? 0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          onProgress?.({ received, total: declared });
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new ContentDownloadError('انقطع تحميل التلاوة', err);
    } finally {
      reader.releaseLock();
    }
    blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'audio/mpeg' });
    if (!declared || received === declared) {
      onProgress?.({ received, total: declared || received });
    }
  }
  if (blob.size === 0 || (blob.type && !blob.type.startsWith('audio/'))) {
    throw new ContentDownloadError('مصدر التلاوة أعاد ملفاً صوتياً غير صالح');
  }
  return writeAudioTrack(reciterId, surah, blob, verseTimings);
}

export class ContentDownloadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ContentDownloadError';
  }
}

/**
 * Downloads `url` and stores it under `key`, reporting progress as it arrives.
 *
 * Content is kept as the raw response text rather than a parsed object: re-parsing on
 * every read is cheap next to the space a 7,580-element object array would occupy in
 * IndexedDB, and it keeps exactly what the source published.
 */
export async function downloadAndStore(
  key: string,
  url: string,
  meta: { kind: 'tafsir' | 'hadith'; group: string; surah: number },
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  let response: Response;
  try {
    response = await fetch(url, { signal, mode: 'cors', redirect: 'follow' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ContentDownloadError('تعذّر الاتصال بالإنترنت', err);
  }

  if (!response.ok) {
    throw new ContentDownloadError(
      response.status === 404
        ? 'المحتوى غير متوفر في المصدر'
        : `فشل التحميل (${response.status})`,
    );
  }

  // Without a stream there is no progress to report; fall back to a single read.
  if (!response.body) {
    const text = await response.text();
    return writeText(key, text, meta);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress?.({ received, total: declared });
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ContentDownloadError('انقطع التحميل', err);
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder('utf-8').decode(joined);
  if (!text.trim()) throw new ContentDownloadError('الملف المنزَّل فارغ');

  onProgress?.({ received, total: declared || received });
  return writeText(key, text, meta);
}

// ---------------------------------------------------------------------------
// Storage summary
// ---------------------------------------------------------------------------

export interface StorageSummary {
  /** Bytes of downloaded content, measured from what is actually stored. */
  used: number;
  /** Device quota in bytes, or 0 when the browser will not say. */
  quota: number;
}

export async function storageSummary(): Promise<StorageSummary> {
  let used = 0;
  if (isContentStoreAvailable()) {
    const contentDb = database();
    const [files, audioTracks] = await Promise.all([
      contentDb.files.toArray(),
      contentDb.audioTracks.toArray(),
    ]);
    used =
      files.reduce((sum, f) => sum + f.bytes, 0) +
      audioTracks.reduce((sum, track) => sum + track.bytes, 0);
  }
  let quota = 0;
  try {
    const estimate = await navigator.storage?.estimate?.();
    quota = estimate?.quota ?? 0;
  } catch {
    quota = 0;
  }
  return { used, quota };
}

/**
 * Raised when a download would not fit. Callers show this instead of a raw DOMException
 * so the user is told what to do about it.
 */
export function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota|storage/i.test(err.message)
  );
}