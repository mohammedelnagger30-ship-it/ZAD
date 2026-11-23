// شرح الحديث — hadith explanations, benefits and word meanings.
//
// The app's hadith collections carry the matn only. What the reader wants next —
// the explanation, the benefits (فوائد), the difficult words and the reference
// list — comes from a separate open source: the Hadeeth Encyclopedia
// (hadeethenc.com), fetched through its public JSON API (it answers with
// `access-control-allow-origin: *`) and cached in the content store, so a
// downloaded explanation works with no network afterwards.
//
// Matching an explanation to a hadith is by title containment. The source lists
// every entry as an id plus a short title lifted verbatim from its own text, so a
// title that survives Arabic folding and appears *whole* (word boundaries on both
// sides) inside the matn identifies the entry; the longest matching title wins so
// a short generic title never claims a hadith it only partly covers. When nothing
// matches, the app says so plainly instead of showing an explanation that may
// belong to another hadith — religious text is never substituted or guessed
// (SOURCES.md).
//
// Source terms: no modification of the published content, clear attribution to
// HadeethEnc.com. Both are honoured — fields are stored and displayed as the
// source publishes them, and the UI names the source under the explanation.

import { foldForMatch } from './arabic';
import {
  readText,
  writeText,
  removeGroup,
  ContentDownloadError,
  isContentStoreAvailable,
} from './contentStore';

const API = 'https://hadeethenc.com/api/v1';

/** Attribution shown under every explanation, as the source's terms require. */
export const SHARH_SOURCE = {
  nameAr: 'الموسوعة الحديثية',
  url: 'https://hadeethenc.com',
};

const INDEX_KEY = 'sharh:index';
const ENTRY_PREFIX = 'sharh:';
const SHARH_GROUP = 'hadeethenc';
const PER_PAGE = 100;

/** Titles shorter than this (after folding) match far too much to be trusted. */
const MIN_TITLE_CHARS = 10;

/** One entry of the cached title index: source id + the title it is listed under. */
export interface SharhIndexItem {
  i: string;
  t: string;
}

export interface SharhEntry {
  id: string;
  title: string;
  /** Full matn as the source publishes it (used only for display context). */
  hadeeth: string;
  attribution: string;
  grade: string;
  explanation: string;
  hints: string[];
  wordsMeanings: Array<{ word: string; meaning: string }>;
  reference: string;
}

export type SharhOutcome =
  /** The explanation is here; show it verbatim with the source line. */
  | { state: 'ready'; entry: SharhEntry }
  /** Index is on the device but no title matches this hadith — say so honestly. */
  | { state: 'none' }
  /** The index has never been downloaded — offer the one-time download. */
  | { state: 'need-index' }
  /** Network or storage failure; the UI offers a retry. */
  | { state: 'error'; message: string };

export interface SharhProgress {
  /** Unique hadiths collected so far. */
  found: number;
  /** Unique hadiths the source reports across its categories. */
  total: number;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', redirect: 'follow' });
  } catch (err) {
    throw new ContentDownloadError('تعذّر الاتصال بالإنترنت', err);
  }
  if (!response.ok) {
    throw new ContentDownloadError(
      response.status === 404 ? 'المحتوى غير متوفر في المصدر' : `فشل التحميل (${response.status})`,
    );
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/**
 * Folds a string for whole-phrase containment: the same lossy fold the
 * word-meanings matcher uses (no harakat, one alef spelling, ة→ه, ى→ي), then
 * every non-letter becomes a space and runs collapse. Both sides of the
 * comparison go through this, so punctuation and tashkeel differences between
 * the two publishers cannot break a match, and word boundaries stay intact for
 * the padded `includes` below.
 */
export function foldForSharh(input: string): string {
  return foldForMatch(input)
    .replace(/[^\u0621-\u064A\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

interface ListResponse {
  data: Array<{ id: string; title: string }>;
  meta: { current_page: string; last_page: number; total_items: string };
}

interface RootCategory {
  id: string;
  title: string;
  hadeeths_count: string;
}

let indexInFlight: Promise<SharhIndexItem[]> | null = null;

async function readCachedIndex(): Promise<SharhIndexItem[] | null> {
  const raw = await readText(INDEX_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SharhIndexItem[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    // A corrupt index is worth replacing, not keeping.
    return null;
  }
}

/**
 * The whole id/title index: cached after the first download, otherwise fetched
 * by walking every root category (the list endpoint returns a root's entire
 * branch). Roots are walked in parallel because each one is a page sequence of
 * its own — one root has 19 pages, and serialising all seven made the one-time
 * wait visibly long.
 */
async function loadIndex(onProgress?: (progress: SharhProgress) => void): Promise<SharhIndexItem[]> {
  const cached = await readCachedIndex();
  if (cached) return cached;

  const roots = (await fetchJson(`${API}/categories/roots/?language=ar`)) as RootCategory[];
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new ContentDownloadError('المصدر لم يُعد فهرس الشروح');
  }
  // The roots' own counts include duplicates across categories; `total` is only
  // the progress denominator, so an upper bound is the honest number for it.
  const total = roots.reduce((sum, root) => sum + (Number(root.hadeeths_count) || 0), 0);
  const byId = new Map<string, string>();

  const report = () => onProgress?.({ found: byId.size, total: total || byId.size });

  await Promise.all(
    roots.map(async (root) => {
      let page = 1;
      for (;;) {
        const list = (await fetchJson(
          `${API}/hadeeths/list/?language=ar&category_id=${root.id}&page=${page}&per_page=${PER_PAGE}`,
        )) as ListResponse;
        for (const item of list.data ?? []) {
          if (item?.id && item?.title) byId.set(item.id, item.title);
        }
        report();
        if (page >= (list.meta?.last_page ?? 1)) break;
        page += 1;
      }
    }),
  );

  const index: SharhIndexItem[] = [...byId].map(([i, t]) => ({ i, t }));
  if (index.length === 0) throw new ContentDownloadError('المصدر لم يُعد فهرس الشروح');
  await writeText(INDEX_KEY, JSON.stringify(index), {
    kind: 'sharh',
    group: SHARH_GROUP,
    surah: 0,
  });
  return index;
}

/** Shares one download between every caller (React StrictMode mounts twice). */
function ensureIndex(onProgress?: (progress: SharhProgress) => void): Promise<SharhIndexItem[]> {
  indexInFlight ??= loadIndex(onProgress).catch((err) => {
    indexInFlight = null;
    throw err;
  });
  return indexInFlight;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The source id whose title sits whole inside `text`, or null when none does.
 * Longest match wins; titles below `MIN_TITLE_CHARS` are ignored entirely.
 */
export function findSharhId(text: string, index: SharhIndexItem[]): string | null {
  const haystack = ` ${foldForSharh(text)} `;
  if (haystack.trim().length === 0) return null;
  let bestId: string | null = null;
  let bestLength = 0;
  for (const item of index) {
    const title = foldForSharh(item.t);
    if (title.length < MIN_TITLE_CHARS || title.length <= bestLength) continue;
    if (haystack.includes(` ${title} `)) {
      bestId = item.i;
      bestLength = title.length;
    }
  }
  return bestId;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

function parseEntry(id: string, raw: string): SharhOutcome {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { state: 'error', message: 'تعذّر قراءة الشرح المحفوظ' };
  }
  const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : '';
  if (!explanation) return { state: 'none' };
  const hints = Array.isArray(data.hints) ? (data.hints as unknown[]).filter((h): h is string => typeof h === 'string') : [];
  const words = Array.isArray(data.words_meanings)
    ? (data.words_meanings as Array<Record<string, unknown>>)
        .filter((w) => typeof w?.word === 'string' && typeof w?.meaning === 'string')
        .map((w) => ({ word: w.word as string, meaning: w.meaning as string }))
    : [];
  return {
    state: 'ready',
    entry: {
      id,
      title: typeof data.title === 'string' ? data.title : '',
      hadeeth: typeof data.hadeeth === 'string' ? data.hadeeth : '',
      attribution: typeof data.attribution === 'string' ? data.attribution : '',
      grade: typeof data.grade === 'string' ? data.grade : '',
      explanation,
      hints,
      wordsMeanings: words,
      reference: typeof data.reference === 'string' ? data.reference : '',
    },
  };
}

async function loadEntry(id: string): Promise<SharhOutcome> {
  const key = `${ENTRY_PREFIX}${id}`;
  const cached = await readText(key);
  if (cached) return parseEntry(id, cached);
  const data = await fetchJson(`${API}/hadeeths/one/?language=ar&id=${encodeURIComponent(id)}`);
  const raw = JSON.stringify(data);
  await writeText(key, raw, { kind: 'sharh', group: SHARH_GROUP, surah: 0 });
  return parseEntry(id, raw);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up the explanation without touching the network: what the detail screen
 * runs on mount. `need-index` means "the one-time index has not been fetched
 * yet" and is the UI's cue to offer it, not an error.
 */
export async function getSharh(text: string): Promise<SharhOutcome> {
  if (!isContentStoreAvailable()) {
    return { state: 'error', message: 'التخزين المحلي غير متاح، فلا يمكن حفظ الشروح' };
  }
  const index = await readCachedIndex();
  if (!index) return { state: 'need-index' };
  const id = findSharhId(text, index);
  if (!id) return { state: 'none' };
  try {
    return await loadEntry(id);
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof ContentDownloadError ? err.message : 'تعذّر تحميل الشرح',
    };
  }
}

/**
 * Download whatever is missing (the index on first use, then the single entry)
 * and return the outcome. `onProgress` reports index collection, which is the
 * only slow part — roughly 1.3 MB once, then a few kilobytes per hadith.
 */
export async function fetchSharh(
  text: string,
  onProgress?: (progress: SharhProgress) => void,
): Promise<SharhOutcome> {
  if (!isContentStoreAvailable()) {
    return { state: 'error', message: 'التخزين المحلي غير متاح، فلا يمكن حفظ الشروح' };
  }
  try {
    const index = await ensureIndex(onProgress);
    const id = findSharhId(text, index);
    if (!id) return { state: 'none' };
    return await loadEntry(id);
  } catch (err) {
    return {
      state: 'error',
      message: err instanceof ContentDownloadError ? err.message : 'تعذّر تحميل الشرح',
    };
  }
}

/** Drops the index and every cached explanation (library "clear downloads"). */
export async function removeSharhContent(): Promise<number> {
  return removeGroup('sharh', SHARH_GROUP);
}
