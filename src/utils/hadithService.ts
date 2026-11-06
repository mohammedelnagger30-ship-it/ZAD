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
import {
  getHadithBook,
  hadithUrl,
  HADITH_BOOKS,
  HADITH_OF_DAY_BOOK,
  type HadithBook,
} from '@/data/contentCatalog';
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
 * Searches every downloaded collection, the default collection first.
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
  // Catalogue order, lifted so the base collection leads: with several books on the
  // device, صحيح مسلم should reach the first page before a smaller booklet does.
  const order = HADITH_BOOKS.filter((book) => ids.has(book.id)).map((book) => book.id);
  const wanted = options.collectionId
    ? [...ids].filter((id) => id === options.collectionId)
    : [
        ...order.filter((id) => id === HADITH_OF_DAY_BOOK),
        ...order.filter((id) => id !== HADITH_OF_DAY_BOOK),
      ];

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

/**
 * Whether `hadith` carries every long term of `query` — the terms that name a narration
 * rather than merely fill it.
 *
 * Length stands in for rarity here: «ما» and «لم» occur in almost every text in the
 * library, so finding two of them together identifies nothing, while «كنته» or «الوضوء»
 * identify a specific one. Without this, a tap on Anas's «ما قال لشيء كُنتُه ولا قال
 * لشيء لم أفعله: أف» counted six shared words against the narration of the man who
 * urinated in the mosque — same words, different hadith — and opened it.
 *
 * It also settles the case where the quoted source is not installed. الترمذي cannot be
 * opened on a device holding only مسلم, the distinctive term never appears, and the
 * caller keeps its results list instead of guessing. No distinctive term at all (a short
 * citation) leaves the older word-count test in charge.
 */
export function carriesDistinctiveTerms(hadith: HadithRecord, query: string): boolean {
  const distinctive = arabicQueryTerms(query).filter((term) => term.length >= 5);
  if (distinctive.length === 0) return true;
  const haystack = normalizeArabic(`${hadith.text} ${hadith.sectionTitle}`);
  return distinctive.every((term) => haystack.includes(term));
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
// Downloading
// ---------------------------------------------------------------------------

/**
 * Where a collection that is not yet on the device is fetched from.
 *
 * The essential collection (صحيح مسلم) is bundled inside the app itself:
 * `public/hadith/<slug>.json` ships in the webDir, so on Android it is on
 * disk from the first launch with no network at all, and the daily card,
 * search and browsing read it from IndexedDB once the file has been copied
 * there on first use. On the web build that copy is one fetch: the file is
 * deliberately left out of the service worker's precache (it is 8.3MB and
 * read exactly once) and served from a runtime cache after it, so a reader
 * who has opened the tab online once can read it offline forever after. The
 * source CDN stays the fallback (for web deploys that predate the bundled
 * asset; the payload is byte-for-byte the same) and remains the only source
 * for every other book, which the user still downloads on demand.
 */
function collectionDownloadUrls(book: HadithBook): string[] {
  const urls: string[] = [];
  if (book.bundled) {
    urls.push(`${import.meta.env.BASE_URL}hadith/${book.slug}.json`);
  }
  urls.push(hadithUrl(book.slug));
  return urls;
}

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
    return parsed;
  }

  const book = getHadithBook(id);
  if (!book) throw new Error(`unknown hadith collection: ${id}`);

  // Try the bundled asset first, then the source CDN. A missing bundled
  // asset (older web deploy) is not worth surfacing as an error — the CDN
  // copy is the same payload. Aborts and quota errors still propagate.
  let failure: unknown;
  let stored = false;
  for (const url of collectionDownloadUrls(book)) {
    try {
      await downloadAndStore(
        key,
        url,
        { kind: 'hadith', group: id, surah: 0 },
        onProgress,
        signal,
        book.sha256,
      );
      stored = true;
      break;
    } catch (err) {
      if (isQuotaError(err)) {
        throw new Error('مساحة التخزين ممتلئة — احذف مجموعة أخرى ثم أعد المحاولة');
      }
      if ((err as Error).name === 'AbortError') throw err;
      failure = err;
    }
  }
  if (!stored) throw failure;

  const raw = await readText(key);
  const parsed = parseCollection(id, raw ?? '');
  touchCache(id, parsed);
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

const SHORT_HADITH_MAX_CHARS = 180;
let dailyHadithCache: { key: string; hadith: HadithRecord | null } | null = null;

interface RankedHadith {
  hadith: HadithRecord;
  rank: number;
}

interface HadithPool {
  any: RankedHadith | null;
  sahih: RankedHadith | null;
}

function dayOfYear(date: Date): number {
  return Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
      Date.UTC(date.getFullYear(), 0, 0)) /
      86400000,
  );
}

function dateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function dailyRank(date: Date, id: string): number {
  let hash = 2166136261;
  for (const character of `${dateKey(date)}:${id}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}

/**
 * Alternates short and longer narrations by calendar day and prefers sahih
 * reports within each length group. Ranking by the date and record id keeps
 * the choice stable for the whole day without retaining every downloaded book.
 */
export async function selectDailyHadith(
  hadiths: Iterable<HadithRecord> | AsyncIterable<HadithRecord>,
  date: Date,
): Promise<HadithRecord | null> {
  const pools: Record<'short' | 'long' | 'all', HadithPool> = {
    short: { any: null, sahih: null },
    long: { any: null, sahih: null },
    all: { any: null, sahih: null },
  };
  const shortDay = dayOfYear(date) % 2 === 1;

  for await (const hadith of hadiths) {
    const bucket = Array.from(hadith.text).length <= SHORT_HADITH_MAX_CHARS ? 'short' : 'long';
    const rank = dailyRank(date, hadith.id);
    for (const pool of [pools[bucket], pools.all]) {
      if (!pool.any || rank < pool.any.rank) pool.any = { hadith, rank };
      if (hadith.grades.includes('sahih') && (!pool.sahih || rank < pool.sahih.rank)) {
        pool.sahih = { hadith, rank };
      }
    }
  }

  const preferred = pools[shortDay ? 'short' : 'long'];
  return preferred.sahih?.hadith
    ?? preferred.any?.hadith
    ?? pools.all.sahih?.hadith
    ?? pools.all.any?.hadith
    ?? null;
}

async function* installedHadiths(collectionIds: string[]): AsyncGenerator<HadithRecord> {
  for (const id of collectionIds) {
    const collection = await getHadithCollection(id);
    yield* collection.hadiths;
  }
}

/**
 * Chooses from every collection already downloaded to this device. A fresh
 * install seeds the bundled Muslim collection once; additional books are
 * never fetched just to fill the daily card.
 */
export async function getDailyHadith(date = new Date()): Promise<HadithRecord | null> {
  const installed = await installedCollections();
  let collectionIds = HADITH_BOOKS
    .filter((book) => installed.has(book.id))
    .map((book) => book.id);

  if (collectionIds.length === 0) {
    await getHadithCollection(HADITH_OF_DAY_BOOK);
    collectionIds = [HADITH_OF_DAY_BOOK];
  }

  const key = `${dateKey(date)}:${collectionIds.join(',')}`;
  if (dailyHadithCache?.key === key) return dailyHadithCache.hadith;

  const hadith = await selectDailyHadith(installedHadiths(collectionIds), date);
  dailyHadithCache = { key, hadith };
  return hadith;
}