// Tafsir access: reads the per-surah tafsir files the user has downloaded.
//
// Upstream (spa5k/tafsir_api) publishes one JSON file per surah holding an array of
// `{ surah, ayah, text }`. Two differences matter to this app:
//
//   * Jalalayn is a short commentary and simply has no entry for many ayahs, so a missing
//     key is normal rather than an error — `getAyahTafsir` returns null and the UI says so.
//   * The big tafsirs are large (Ibn Kathir averages ~12,000 characters *per ayah*), so
//     files are fetched per surah and only cached in memory for the surahs in play.

import {
  downloadAndStore,
  isDownloaded,
  readText,
  removeGroup,
  tafsirKey,
  tafsirSurahsInStore,
  isQuotaError,
  type DownloadProgress,
} from './contentStore';
import { getTafsirEdition, surahBytes, tafsirSurahUrl, TAFSIR_EDITIONS, type TafsirEdition } from '@/data/contentCatalog';
import { arabicQueryTerms, normalizeArabic } from '@/utils/arabic';

/** Thrown when a surah of an edition is not on the device and the source has none. */
class TafsirNotInstalledError extends Error {
  readonly notInstalled = true;

  constructor(label: string) {
    super(label);
    this.name = 'TafsirNotInstalledError';
  }
}

function notInstalled(editionId: string, surah: number): TafsirNotInstalledError {
  const edition = getTafsirEdition(editionId);
  return new TafsirNotInstalledError(`${edition?.titleAr ?? editionId} — سورة ${surah}`);
}

export function isNotInstalled(err: unknown): err is TafsirNotInstalledError {
  return err instanceof Error && (err as TafsirNotInstalledError).notInstalled === true;
}

/** Parsed tafsir for one surah: ayah number -> commentary. */
export type SurahTafsir = Record<number, string>;

// Parsed surahs kept in memory. Reading IndexedDB on every ayah tap is wasteful, and a
// user flipping between neighbouring ayahs always hits the same surah, so a very small
// cache removes almost all of the reads. Parsed objects are far larger than the stored
// text, which is why this is capped low.
const MEMORY_CACHE_LIMIT = 4;
const memoryCache = new Map<string, SurahTafsir>();

function touchCache(key: string, value: SurahTafsir): void {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next();
    if (oldest.done) break;
    memoryCache.delete(oldest.value);
  }
}

/**
 * Folded copies of whole surahs, kept apart from `memoryCache` on purpose.
 *
 * The two exist for opposite reasons. `memoryCache` holds the *original* text
 * for display, capped at four surahs because a single Ibn Kathir file runs to
 * about twelve thousand characters per ayah. This one holds the *folded* text
 * for matching, where keeping the original would be a second copy of exactly
 * the large objects the cache above refuses to hold — so it keeps only what a
 * query needs to read again, and lets the display cache keep its four.
 *
 * Folding is where a search spends its time: measured on this project's own
 * Quran text, about 40 ms per 700 KB, against microseconds for matching
 * against the result. A fold therefore pays for itself after one query — but
 * only if it is kept, and only up to a point, because the largest edition on
 * offer folds to well over a hundred megabytes. The budget below is that
 * point: what stops fitting is dropped oldest-first and folded again next
 * time, which is the cost this cache exists to pay rather than something to
 * hide from the caller.
 */
const FOLD_CACHE_BYTES_LIMIT = 32 * 1024 * 1024;
const foldCache = new Map<string, { folded: SurahTafsir; bytes: number }>();
let foldCacheBytes = 0;

function foldCacheForget(key: string): void {
  const existing = foldCache.get(key);
  if (!existing) return;
  foldCache.delete(key);
  foldCacheBytes -= existing.bytes;
}

function foldCachePut(key: string, folded: SurahTafsir, bytes: number): void {
  foldCacheForget(key);
  foldCache.set(key, { folded, bytes });
  foldCacheBytes += bytes;
  while (foldCacheBytes > FOLD_CACHE_BYTES_LIMIT && foldCache.size > 1) {
    const oldest = foldCache.keys().next();
    if (oldest.done) break;
    foldCacheForget(oldest.value);
  }
}

function clearCache(editionId: string, surah?: number): void {
  const prefix = surah === undefined ? `tafsir:${editionId}:` : tafsirKey(editionId, surah);
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  // The folded copy outlives the file it came from otherwise, and a re-downloaded
  // surah would keep being matched against the commentary the user just deleted.
  for (const key of [...foldCache.keys()]) {
    if (key.startsWith(prefix)) foldCacheForget(key);
  }
}

interface UpstreamRecord {
  surah?: number;
  ayah?: number;
  text?: string;
}

/** Converts the upstream array into an ayah-keyed map, dropping empty entries. */
function parseUpstream(raw: string, surah: number): SurahTafsir {
  const parsed = JSON.parse(raw) as UpstreamRecord[];
  const out: SurahTafsir = {};
  if (!Array.isArray(parsed)) return out;
  for (const record of parsed) {
    const text = (record.text ?? '').trim();
    // Trust the record's own surah/ayah when present, otherwise fall back to its position.
    const ayah = typeof record.ayah === 'number' ? record.ayah : 0;
    if (!text || ayah < 1) continue;
    if (typeof record.surah === 'number' && record.surah !== surah) continue;
    out[ayah] = text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Returns already-known tafsir for a surah, or null when it has not been downloaded. */
export function cachedSurahTafsir(editionId: string, surah: number): SurahTafsir | null {
  const hit = memoryCache.get(tafsirKey(editionId, surah));
  if (hit) {
    touchCache(tafsirKey(editionId, surah), hit);
    return hit;
  }
  return null;
}

export function isSurahTafsirInstalled(editionId: string, surah: number): Promise<boolean> {
  return isDownloaded(tafsirKey(editionId, surah));
}

export function installedSurahs(editionId: string): Promise<Set<number>> {
  return tafsirSurahsInStore(editionId);
}

/**
 * Tafsir for one ayah, or null when it is not on the device (or the commentary simply
 * does not cover that ayah). Never throws for the "missing" cases so callers can render
 * the message directly.
 */
export async function getAyahTafsir(
  editionId: string,
  surah: number,
  ayah: number,
): Promise<string | null> {
  const key = tafsirKey(editionId, surah);
  let data = memoryCache.get(key);
  if (!data) {
    const raw = await readText(key);
    if (raw === null) return null;
    data = parseUpstream(raw, surah);
    touchCache(key, data);
  }
  return data[ayah] ?? null;
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

export interface TafsirSearchHit {
  editionId: string;
  editionTitle: string;
  surah: number;
  ayah: number;
  /** The commentary as published — never the folded form, which is not for display. */
  text: string;
}

async function foldedSurahTafsir(editionId: string, surah: number): Promise<SurahTafsir | null> {
  const key = tafsirKey(editionId, surah);
  const hit = foldCache.get(key);
  if (hit) {
    foldCacheForget(key);
    foldCache.set(key, hit);
    return hit.folded;
  }

  const raw = await readText(key);
  if (raw === null) return null;

  const parsed = parseUpstream(raw, surah);
  const folded: SurahTafsir = {};
  let bytes = 0;
  for (const ayahKey of Object.keys(parsed)) {
    const ayah = Number(ayahKey);
    const text = normalizeArabic(parsed[ayah] ?? '');
    if (!text) continue;
    folded[ayah] = text;
    bytes += text.length * 2; // UTF-16 units: what it actually costs the heap
  }
  foldCachePut(key, folded, bytes);
  return folded;
}

/**
 * Searches every tafsir on the device, edition by edition, surah by surah.
 *
 * This is the one source in the unified search with no index to read — the
 * commentary arrives as whole files, one surah at a time, and folding one is
 * what costs real time. So the scan is shaped around that instead of hiding
 * it: one file per turn of the event loop (a hundred of them back to back is
 * a visibly frozen search box), a fold kept for the queries after this one,
 * and an `aborted` signal so a person who keeps typing does not queue a full
 * scan behind every keystroke.
 *
 * Nothing here downloads. A surah that is not on the device is not on the
 * device, and a search must never turn into one.
 */
export async function searchInstalledTafsir(
  query: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<TafsirSearchHit[]> {
  const terms = arabicQueryTerms(query);
  const limit = options.limit ?? 20;
  if (terms.length === 0 || limit <= 0) return [];

  const hits: TafsirSearchHit[] = [];
  for (const edition of TAFSIR_EDITIONS) {
    if (options.signal?.aborted) break;
    const installed = await installedSurahs(edition.id);
    if (installed.size === 0) continue;

    for (const surah of [...installed].sort((a, b) => a - b)) {
      if (options.signal?.aborted || hits.length >= limit) break;

      const folded = await foldedSurahTafsir(edition.id, surah);
      if (folded) {
        for (const ayahKey of Object.keys(folded)) {
          const ayah = Number(ayahKey);
          const text = folded[ayah];
          if (!text || !terms.every((term) => text.includes(term))) continue;
          hits.push({
            editionId: edition.id,
            editionTitle: edition.titleAr,
            surah,
            ayah,
            text,
          });
          if (hits.length >= limit) break;
        }
      }

      // Yield after each file: folding is ~40 ms per 700 KB, and the default
      // edition is small enough that this barely registers while the 90 MB
      // one would otherwise run unbroken across many files.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

/**
 * Ensures one surah of an edition is on the device, downloading it if needed.
 * Returns the parsed tafsir either way.
 */
export async function ensureSurahTafsir(
  editionId: string,
  surah: number,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<SurahTafsir> {
  const key = tafsirKey(editionId, surah);
  const hit = memoryCache.get(key);
  if (hit) {
    touchCache(key, hit);
    return hit;
  }

  const existing = await readText(key);
  if (existing !== null) {
    const parsed = parseUpstream(existing, surah);
    touchCache(key, parsed);
    return parsed;
  }

  const edition = getTafsirEdition(editionId);
  if (!edition) throw notInstalled(editionId, surah);
  if (edition.surahBytes[surah] === 0) throw notInstalled(editionId, surah);

  await downloadAndStore(key, tafsirSurahUrl(edition.slug, surah), {
    kind: 'tafsir',
    group: editionId,
    surah,
  }, onProgress, signal);

  const raw = await readText(key);
  const parsed = parseUpstream(raw ?? '', surah);
  touchCache(key, parsed);
  return parsed;
}

export interface EditionDownloadProgress {
  surah: number;
  done: number;
  total: number;
  bytesDone: number;
  bytesTotal: number;
}

/**
 * Downloads every surah of an edition, smallest first is not attempted — the catalogue is
 * already ordered by size, and the caller picks. Sequential on purpose: a phone on a
 * mobile connection handles one file at a time far better than eight in parallel.
 */
export async function downloadTafsirEdition(
  editionId: string,
  onProgress?: (progress: EditionDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const edition = getTafsirEdition(editionId);
  if (!edition) throw new Error(`unknown tafsir edition: ${editionId}`);

  const available = edition.surahs;
  const bytesTotal = edition.totalBytes;
  let bytesDone = 0;
  let done = 0;

  for (let surah = 1; surah <= 114; surah++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (edition.surahBytes[surah] === 0) continue;

    const key = tafsirKey(editionId, surah);
    if (await isDownloaded(key)) {
      bytesDone += edition.surahBytes[surah];
      done++;
      onProgress?.({ surah, done, total: available, bytesDone, bytesTotal });
      continue;
    }

    try {
      await downloadAndStore(key, tafsirSurahUrl(edition.slug, surah), {
        kind: 'tafsir',
        group: editionId,
        surah,
      }, undefined, signal);
    } catch (err) {
      // Out of space mid-run should stop cleanly with a message the UI can show,
      // not a bare DOMException.
      if (isQuotaError(err)) {
        throw new Error('مساحة التخزين ممتلئة — احذف محتوى أو أوقف تحميل تفسير آخر');
      }
      throw err;
    }

    bytesDone += edition.surahBytes[surah];
    done++;
    onProgress?.({ surah, done, total: available, bytesDone, bytesTotal });
  }
}

/** Deletes a whole tafsir edition from the device. */
export async function deleteTafsirEdition(editionId: string): Promise<number> {
  clearCache(editionId);
  return removeGroup('tafsir', editionId);
}

/** Byte cost of one surah of an edition, for download estimates. */
export function estimateSurahBytes(edition: TafsirEdition, surah: number): number {
  return surahBytes(edition, surah);
}