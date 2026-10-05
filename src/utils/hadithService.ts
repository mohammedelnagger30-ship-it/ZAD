// Hadith access: reads the collections the user has downloaded.
//
// Upstream (fawazahmed0/hadith-api) publishes `{ metadata, hadiths }` per collection.
// Two things about that payload shape the code below:
//
//   * Book/chapter identity is a *number* in `reference.book`; the title lives in
//     `metadata.sections` keyed by that number. The titles are English in the source
//     (sunnah.com's section names), so they are kept as a secondary line in the UI rather
//     than presented as Arabic.
//   * Grades are English strings ("Sahih", "Sahih - Bukhari And Muslim") attached by the
//     grading scholar. `normalizeGrade` already understands both languages, so they are
//     carried through and shown with an Arabic label.

import {
  downloadAndStore,
  hadithKey,
  hadithBooksInStore,
  isDownloaded,
  readText,
  removeGroup,
  isQuotaError,
  type DownloadProgress,
} from './contentStore';
import { getHadithBook, HADITH_BOOKS } from '@/data/contentCatalog';
import { normalizeGrade, type HadithGrade } from '@/data/hadithCollections';
import { arabicQueryTerms, normalizeArabic } from './arabic';

export interface HadithRecord {
  /** `${collectionId}:${number}` — unique across the whole app. */
  id: string;
  collectionId: string;
  collectionTitle: string;
  /** The collection's own numbering. */
  number: number;
  /** Sunnah.com's arabicnumber, which differs from `number` in a few books. */
  arabicNumber: number;
  text: string;
  /** Section index; 0 when the source gives none. */
  section: number;
  /** Section title from the source (English). */
  sectionTitle: string;
  grades: HadithGrade[];
  /** Names of the scholars who graded it, for attribution. */
  graders: string[];
}

export interface HadithSection {
  number: number;
  title: string;
  count: number;
}

export interface HadithCollection {
  id: string;
  titleAr: string;
  authorAr: string;
  count: number;
  sections: HadithSection[];
  hadiths: HadithRecord[];
}

// Parsed collections held in memory. Two at a time is enough: browsing happens in one
// collection, and search only needs the folded text (cached separately, below).
const MEMORY_CACHE_LIMIT = 2;
const memoryCache = new Map<string, HadithCollection>();
const searchIndexCache = new Map<string, HadithSearchEntry[]>();

interface HadithSearchEntry {
  id: string;
  searchText: string;
  hasSahihGrade: boolean;
}

function touchCache(id: string, value: HadithCollection): void {
  memoryCache.delete(id);
  memoryCache.set(id, value);
  while (memoryCache.size > MEMORY_CACHE_LIMIT) {
    const oldest = memoryCache.keys().next();
    if (oldest.done) break;
    memoryCache.delete(oldest.value);
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface UpstreamHadith {
  hadithnumber?: number;
  arabicnumber?: number;
  text?: string;
  arabic?: string;
  grades?: { name?: string; grade?: string }[];
  reference?: { book?: number; hadith?: number };
}

interface UpstreamCollection {
  metadata?: { name?: string; sections?: Record<string, string> };
  hadiths?: UpstreamHadith[];
}

/**
 * Turns the upstream text into plain text safe to render.
 *
 * sunnah.com's data puts HTML in the text: every hadith of the Forty Nawawi ends with
 * `<br>` before its takhrij, and rendered literally that showed the user a raw `<br>` in
 * the middle of a hadith. A line break becomes a real newline instead, which is what the
 * source meant.
 *
 * Any other tag is removed rather than rendered. Rendering it as HTML would be an injection
 * risk from a third-party feed, and keeping it as text would show the user markup. Neither
 * is acceptable for content displayed as scripture-adjacent text, and the source currently
 * contains no other tag.
 */
export function cleanHadithText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCollection(collectionId: string, raw: string): HadithCollection {
  const book = getHadithBook(collectionId);
  const parsed = JSON.parse(raw) as UpstreamCollection;
  const sectionTitles = parsed.metadata?.sections ?? {};

  const sectionCounts = new Map<number, number>();
  const hadiths: HadithRecord[] = [];

  for (const item of parsed.hadiths ?? []) {
    const text = cleanHadithText(item.text ?? item.arabic ?? '');
    if (!text) continue;

    const section = typeof item.reference?.book === 'number' ? item.reference.book : 0;
    const number = item.hadithnumber ?? item.reference?.hadith ?? hadiths.length + 1;

    hadiths.push({
      id: `${collectionId}:${number}`,
      collectionId,
      collectionTitle: book?.titleAr ?? collectionId,
      number,
      arabicNumber: item.arabicnumber ?? number,
      text,
      section,
      sectionTitle: sectionTitles[String(section)] ?? '',
      grades: [...new Set((item.grades ?? []).map((g) => normalizeGrade(g.grade)))],
      graders: [...new Set((item.grades ?? []).map((g) => (g.name ?? '').trim()).filter(Boolean))],
    });

    sectionCounts.set(section, (sectionCounts.get(section) ?? 0) + 1);
  }

  const sections: HadithSection[] = [...sectionCounts.entries()]
    .map(([number, count]) => ({
      number,
      title: sectionTitles[String(number)] ?? '',
      count,
    }))
    .sort((a, b) => a.number - b.number);

  return {
    id: collectionId,
    titleAr: book?.titleAr ?? collectionId,
    authorAr: book?.authorAr ?? '',
    count: hadiths.length,
    sections,
    hadiths,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function cachedCollection(id: string): HadithCollection | null {
  const hit = memoryCache.get(id);
  if (hit) {
    touchCache(id, hit);
    return hit;
  }
  return null;
}

export function installedCollections(): Promise<Set<string>> {
  return hadithBooksInStore();
}

export function isCollectionInstalled(id: string): Promise<boolean> {
  return isDownloaded(hadithKey(id));
}

export interface SearchHit {
  hadith: HadithRecord;
  collection: HadithCollection;
}

/**
 * Searches every downloaded collection, most recently downloaded first.
 *
 * An empty query returns the first page of everything rather than everything, so a caller
 * that forgets to handle it cannot pull 36,000 rows into the DOM.
 */
export async function searchInstalledHadiths(
  query: string,
  options: {
    limit?: number;
    collectionId?: string;
    hadithIds?: ReadonlySet<string>;
    sahihOnly?: boolean;
  } = {},
): Promise<SearchHit[]> {
  const limit = Math.max(0, options.limit ?? 100);
  if (limit === 0) return [];
  const ids = await installedCollections();
  const wanted = options.collectionId
    ? [...ids].filter((id) => id === options.collectionId)
    : HADITH_BOOKS.filter((book) => ids.has(book.id)).map((book) => book.id);

  // Keep only folded text in the long-lived search index; full collection records stay LRU-cached.
  const collections = new Map<string, HadithCollection>();
  for (const id of wanted) {
    let index = searchIndexCache.get(id);
    if (!index) {
      const collection = await getHadithCollection(id);
      collections.set(id, collection);
      index = collection.hadiths.map((hadith) => ({
        id: hadith.id,
        searchText: normalizeArabic(
          `${hadith.text} ${hadith.sectionTitle} ${hadith.graders.join(' ')}`,
        ),
        hasSahihGrade: hadith.grades.includes('sahih'),
      }));
      searchIndexCache.set(id, index);
    }
  }

  const terms = arabicQueryTerms(query);
  const candidates: { id: string; collectionId: string }[] = [];
  for (const id of wanted) {
    const index = searchIndexCache.get(id) ?? [];
    for (const entry of index) {
      if (options.hadithIds && !options.hadithIds.has(entry.id)) continue;
      if (options.sahihOnly && !entry.hasSahihGrade) continue;
      if (terms.length > 0 && !terms.every((term) => entry.searchText.includes(term))) continue;
      candidates.push({ id: entry.id, collectionId: id });
      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }

  const recordsByCollection = new Map<string, Map<string, HadithRecord>>();
  for (const id of new Set(candidates.map((candidate) => candidate.collectionId))) {
    const collection = collections.get(id) ?? await getHadithCollection(id);
    collections.set(id, collection);
    recordsByCollection.set(id, new Map(collection.hadiths.map((hadith) => [hadith.id, hadith])));
  }

  return candidates.flatMap((candidate) => {
    const collection = collections.get(candidate.collectionId) ?? cachedCollection(candidate.collectionId);
    const hadith = recordsByCollection.get(candidate.collectionId)?.get(candidate.id);
    return collection && hadith ? [{ hadith, collection }] : [];
  });
}

export function countMatches(hadith: HadithRecord, query: string): number {
  const terms = arabicQueryTerms(query);
  if (terms.length === 0) return 0;
  const haystack = normalizeArabic(`${hadith.text} ${hadith.sectionTitle}`);
  return terms.filter((term) => haystack.includes(term)).length;
}

/** Collections currently parsed in memory, newest use first. */
export async function installedCollectionList(): Promise<HadithCollection[]> {
  const ids = await installedCollections();
  const out: HadithCollection[] = [];
  for (const id of ids) {
    const cached = cachedCollection(id);
    if (cached) out.push(cached);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot for synchronous callers
// ---------------------------------------------------------------------------
//
// The home screen shows a hadith of the day inline and should not have to become a
// loading state to do it. This snapshot holds the records of whatever has been parsed so
// far, so that screen can read it synchronously.

const snapshot = new Set<string>();
const snapshotRecords = new Map<string, HadithRecord>();

function addToSnapshot(collection: HadithCollection): void {
  snapshot.add(collection.id);
  for (const hadith of collection.hadiths) {
    snapshotRecords.set(hadith.id, hadith);
  }
  // Bound the snapshot: 36,000 records is more than any synchronous caller needs, and
  // unbounded growth here would duplicate every collection the user ever opened.
  while (snapshotRecords.size > 4000) {
    const oldest = snapshotRecords.keys().next();
    if (oldest.done) break;
    snapshotRecords.delete(oldest.value);
  }
}

/** Every record currently held in memory. Empty until something has been opened. */
export function loadedHadithRecords(): HadithRecord[] {
  return [...snapshotRecords.values()];
}

/**
 * A hadith for today, chosen from what is on the device so it works offline.
 * Returns null when nothing has been opened yet.
 */
export function hadithOfDay(): HadithRecord | null {
  return hadithOfDayFrom(loadedHadithRecords());
}

// ---------------------------------------------------------------------------
// Downloading
// ---------------------------------------------------------------------------

/** Returns the collection, downloading it first if it is not on the device. */
export async function getHadithCollection(
  id: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<HadithCollection> {
  const key = hadithKey(id);
  const hit = memoryCache.get(id);
  if (hit) {
    touchCache(id, hit);
    return hit;
  }

  const existing = await readText(key);
  if (existing !== null) {
    const parsed = parseCollection(id, existing);
    touchCache(id, parsed);
    addToSnapshot(parsed);
    return parsed;
  }

  const book = getHadithBook(id);
  if (!book) throw new Error(`unknown hadith collection: ${id}`);

  try {
    await downloadAndStore(
      key,
      `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${book.slug}.json`,
      { kind: 'hadith', group: id, surah: 0 },
      onProgress,
      signal,
    );
  } catch (err) {
    if (isQuotaError(err)) {
      throw new Error('مساحة التخزين ممتلئة — احذف مجموعة أخرى ثم أعد المحاولة');
    }
    throw err;
  }

  const raw = await readText(key);
  const parsed = parseCollection(id, raw ?? '');
  touchCache(id, parsed);
  addToSnapshot(parsed);
  return parsed;
}

/** Alias that reads better at the call site, where the user asked to download it. */
export function downloadHadithCollection(
  id: string,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<HadithCollection> {
  return getHadithCollection(id, onProgress, signal);
}

export async function deleteHadithCollection(id: string): Promise<number> {
  memoryCache.delete(id);
  searchIndexCache.delete(id);
  return removeGroup('hadith', id);
}

/** Releases parsed collections; called when the library screen unmounts. */
export function clearHadithMemory(): void {
  memoryCache.clear();
}

/**
 * Picks a hadith for today from a pool, deterministically by day of year.
 *
 * Graded-sahih entries are preferred: a "hadith of the day" that is weak or fabricated
 * would be misleading, so an ungraded pool is only used when nothing has been graded.
 */
function hadithOfDayFrom(hadiths: HadithRecord[]): HadithRecord | null {
  if (hadiths.length === 0) return null;
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const sahih = hadiths.filter((h) => h.grades.includes('sahih'));
  const pool = sahih.length > 0 ? sahih : hadiths;
  return pool[dayOfYear % pool.length];
}