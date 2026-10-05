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
import { getTafsirEdition, surahBytes, tafsirSurahUrl, type TafsirEdition } from '@/data/contentCatalog';

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

function clearCache(editionId: string, surah?: number): void {
  const prefix = surah === undefined ? `tafsir:${editionId}:` : tafsirKey(editionId, surah);
  for (const key of [...memoryCache.keys()]) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
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