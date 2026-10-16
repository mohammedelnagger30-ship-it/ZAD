// Word meanings (غريب القرآن) — download, store and locate a gloss for one tapped word.
//
// Upstream (quranpedia) publishes a single gzip file holding, for every ayah it covers,
// one entry per book: the book, and a list of `{ text, meaning }` fragments. Two facts
// about that shape decide everything here:
//
//   * A book annotates only the *unusual* words — Al-Fatihah's entry for ayah 2 is
//     "رَبِّ | الْعَالَمِينَ", not the whole ayah. So a gloss cannot be found by matching
//     the ayah against the source; the source's fragment has to be located *inside* the
//     ayah, and the meaning then belongs to whatever words that fragment covers.
//   * The two sides spell the same text differently (Tanzil's Uthmani alef wasla and
//     dagger alef versus the books' plain spelling), so matching runs on the folded form
//     from `foldForMatch` — never on display text, and never on a fuzzy match: a gloss
//     shown for the wrong word is worse than no gloss at all.
//
// Measured on the real dump (scripts/measure-word-meanings.ts): 91.3% of fragments are
// located by this algorithm, monotonically in text order; the rest are not shown, and
// the sheet says so plainly rather than guessing.
//
// Installation is all-or-nothing: 114 per-surah files are written, then a marker
// (`meanings:<source>:0`) carrying the upstream version. The marker is what
// `isWordMeaningsInstalled` reads, so a download interrupted halfway never presents
// itself as installed.

import {
  ContentDownloadError,
  downloadBinary,
  isDownloaded,
  isQuotaError,
  readText,
  removeGroup,
  writeText,
  type DownloadProgress,
} from './contentStore';
import {
  WORD_MEANINGS,
  WORD_MEANINGS_DEFAULT_BOOK,
} from '@/data/contentCatalog';
import { foldForMatch } from '@/utils/arabic';
import { splitBasmala } from '@/utils/basmala';
import { getAyah } from '@/data/quranText';

/** One gloss fragment as published: the words it covers and their meaning. */
export interface MeaningGloss {
  text: string;
  meaning: string;
}

interface StoredBook {
  book: number;
  words: MeaningGloss[];
}

interface StoredAyah {
  ayah: number;
  meanings: StoredBook[];
}

interface StoredSurah {
  surah: number;
  ayat: StoredAyah[];
}

export function wordMeaningsKey(surah: number): string {
  return `meanings:${WORD_MEANINGS.id}:${surah}`;
}

const MARKER_KEY = wordMeaningsKey(0);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// One parsed surah is up to a few hundred kilobytes of JSON and the sheet only ever
// works on the surah in play plus its neighbours, so — as in `tafsirService` — a small
// cache removes nearly every re-read without holding the Quran's worth of objects.
const SURAH_CACHE_LIMIT = 4;
const surahCache = new Map<string, Map<number, StoredAyah>>();

function touchSurah(key: string, value: Map<number, StoredAyah>): void {
  surahCache.delete(key);
  surahCache.set(key, value);
  while (surahCache.size > SURAH_CACHE_LIMIT) {
    const oldest = surahCache.keys().next();
    if (oldest.done) break;
    surahCache.delete(oldest.value);
  }
}

/** True once a complete copy is on the device. */
export function isWordMeaningsInstalled(): Promise<boolean> {
  return isDownloaded(MARKER_KEY);
}

/** The upstream version of the installed copy, or null when nothing is installed. */
export async function installedWordMeaningsVersion(): Promise<string | null> {
  const raw = await readText(MARKER_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : WORD_MEANINGS.version;
  } catch {
    return WORD_MEANINGS.version;
  }
}

function parseSurah(raw: string): Map<number, StoredAyah> {
  const parsed = JSON.parse(raw) as StoredSurah;
  const out = new Map<number, StoredAyah>();
  if (!parsed || !Array.isArray(parsed.ayat)) return out;
  for (const ayah of parsed.ayat) {
    if (typeof ayah?.ayah !== 'number' || !Array.isArray(ayah.meanings)) continue;
    out.set(ayah.ayah, ayah);
  }
  return out;
}

async function loadSurah(surah: number): Promise<Map<number, StoredAyah> | null> {
  const key = wordMeaningsKey(surah);
  const hit = surahCache.get(key);
  if (hit) {
    touchSurah(key, hit);
    return hit;
  }
  const raw = await readText(key);
  if (raw === null) return null;
  const parsed = parseSurah(raw);
  touchSurah(key, parsed);
  return parsed;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface WordMeaningHit {
  /** 0-based word index inside the ayah as the reader displays it (basmala lifted). */
  wordIndex: number;
  /** Upstream book id — `WORD_MEANINGS.books` describes it. */
  book: number;
  gloss: MeaningGloss;
}

const surahMeaningCache = new Map<number, Promise<Map<number, WordMeaningHit[]>>>();

/**
 * All aligned meanings for a surah, grouped by ayah. The mushaf uses this to mark
 * words that can open a meaning without repeating the stored-text read per word.
 */
export function getSurahWordMeanings(surah: number): Promise<Map<number, WordMeaningHit[]>> {
  const cached = surahMeaningCache.get(surah);
  if (cached) {
    surahMeaningCache.delete(surah);
    surahMeaningCache.set(surah, cached);
    return cached;
  }

  const request = (async () => {
    const storedAyat = await loadSurah(surah);
    const meanings = new Map<number, WordMeaningHit[]>();
    for (const [ayahNumber, stored] of storedAyat ?? []) {
      const text = getAyah(surah, ayahNumber)?.text;
      if (!text) continue;
      meanings.set(ayahNumber, alignAyahMeanings(text, stored));
    }
    return meanings;
  })();
  surahMeaningCache.set(surah, request);
  while (surahMeaningCache.size > SURAH_CACHE_LIMIT) {
    const oldest = surahMeaningCache.keys().next();
    if (oldest.done) break;
    surahMeaningCache.delete(oldest.value);
  }
  return request.catch((cause: unknown) => {
    if (surahMeaningCache.get(surah) === request) surahMeaningCache.delete(surah);
    throw cause;
  });
}

/** First index >= from at which `run` occurs in `hay`. */
function findRun(run: string[], hay: string[], from: number): number {
  outer: for (let k = Math.max(0, from); k + run.length <= hay.length; k++) {
    for (let i = 0; i < run.length; i++) if (hay[k + i] !== run[i]) continue outer;
    return k;
  }
  return -1;
}

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * Locates every gloss fragment inside one ayah and reports which words it covers.
 *
 * `ayahText` must be the text the reader shows for this ayah — for ayah 1 that means the
 * basmala has already been lifted out of it, because the word positions the reader hands
 * out are counted from the same string.
 *
 * Fragments are consumed in order (each starts no earlier than the last one ended), so
 * a word repeated inside an ayah resolves to the fragment that actually precedes it
 * rather than to its first occurrence. Two passes per fragment: an exact run of folded
 * words, then — for the fragments that drop a prefixed conjunction, "قدّره منازل" against
 * "وَقَدَّرَهُۥ مَنَازِلَ" — a folded substring, which covers the words it overlaps.
 * A fragment that fits neither way belongs to a differently spelled text and is not
 * shown at all.
 */
export function alignAyahMeanings(
  ayahText: string,
  stored: StoredAyah | null | undefined,
  bookId?: number,
): WordMeaningHit[] {
  if (!stored || !ayahText) return [];

  // The reader lifts the basmala out of ayah 1 (except in Al-Fatihah, where it *is*
  // the ayah), and counts word positions in what is left.
  const shown = splitBasmala(ayahText).rest || ayahText;
  const displayWords = wordsOf(shown);
  if (displayWords.length === 0) return [];

  const folded = displayWords.map(foldForMatch);
  const charStart: number[] = [];
  let joined = '';
  folded.forEach((word, index) => {
    if (index > 0) joined += ' ';
    charStart.push(joined.length);
    joined += word;
  });
  const charEnd = folded.map((word, index) => charStart[index] + word.length);

  const hits: WordMeaningHit[] = [];
  const seen = new Set<string>();

  for (const entry of stored.meanings) {
    if (bookId !== undefined && entry.book !== bookId) continue;
    if (!Array.isArray(entry.words)) continue;

    let wordCursor = 0;
    for (const gloss of entry.words) {
      const run = wordsOf(gloss.text).map(foldForMatch).filter(Boolean);
      if (run.length === 0) continue;

      const at = findRun(run, folded, wordCursor);
      if (at >= 0) {
        addHits(hits, seen, entry.book, gloss, at, at + run.length);
        wordCursor = at + run.length;
        continue;
      }

      const needle = run.join(' ');
      const from = wordCursor < charStart.length ? charStart[wordCursor] : joined.length;
      const hit = joined.indexOf(needle, from);
      if (hit < 0) continue;

      const end = hit + needle.length;
      let first = -1;
      let last = -1;
      for (let i = wordCursor; i < displayWords.length; i++) {
        if (charEnd[i] > hit && charStart[i] < end) {
          if (first < 0) first = i;
          last = i;
        }
        if (charStart[i] >= end) break;
      }
      if (first < 0) continue;
      addHits(hits, seen, entry.book, gloss, first, last + 1);
      wordCursor = last + 1;
    }
  }

  return hits.sort((a, b) => a.wordIndex - b.wordIndex || a.book - b.book);
}

function addHits(
  hits: WordMeaningHit[],
  seen: Set<string>,
  book: number,
  gloss: MeaningGloss,
  from: number,
  to: number,
): void {
  for (let i = from; i < to; i++) {
    const token = `${i}:${book}`;
    if (seen.has(token)) continue;
    seen.add(token);
    hits.push({ wordIndex: i, book, gloss });
  }
}

/**
 * Glosses for one tapped word, across every book (or just `bookId`).
 *
 * Never downloads: a device without the dump has no meanings, and a tap in the mushaf
 * must not turn into a network request. The sheet asks for the download itself.
 */
export async function getWordMeanings(
  surah: number,
  ayah: number,
  wordPosition: number,
  bookId?: number,
): Promise<WordMeaningHit[]> {
  const meanings = await getSurahWordMeanings(surah);
  return (meanings.get(ayah) ?? []).filter(
    (hit) => hit.wordIndex === wordPosition - 1 && (bookId === undefined || hit.book === bookId),
  );
}

/** The book the sheet opens on: the most complete one in the catalogue. */
export const DEFAULT_WORD_MEANINGS_BOOK = WORD_MEANINGS_DEFAULT_BOOK;

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

export interface WordMeaningsProgress {
  phase: 'download' | 'install';
  /** Bytes received (download phase) — `total` is the server's content-length. */
  received: number;
  total: number;
  /** Surahs written so far (install phase). */
  done: number;
  surahs: number;
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new ContentDownloadError('جهازك لا يدعم فك ضغط ملفات المعاني — حدّث المتصفح ثم أعد المحاولة');
  }
  let stream: ReadableStream<Uint8Array>;
  try {
    stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  } catch (err) {
    throw new ContentDownloadError('تعذّر فك ضغط ملف المعاني — الملف المنزَّل غير صالح', err);
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (err) {
    throw new ContentDownloadError('تعذّر فك ضغط ملف المعاني — الملف المنزَّل غير صالح', err);
  } finally {
    reader.releaseLock();
  }
  return text;
}

interface DumpAyah {
  surah?: unknown;
  ayah?: unknown;
  meanings?: unknown;
}

/**
 * Downloads the whole dump and writes it to the device, one file per surah, then the
 * marker. Nothing is deleted until the new copy is fully parsed, so a failed download
 * leaves the installed copy exactly as it was.
 */
export async function downloadWordMeanings(
  onProgress?: (progress: WordMeaningsProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const downloadProgress = (p: DownloadProgress) =>
    onProgress?.({ phase: 'download', received: p.received, total: p.total, done: 0, surahs: 114 });

  const bytes = await downloadBinary(WORD_MEANINGS.url, downloadProgress, signal);
  const text = await gunzip(bytes);

  let parsed: { schema?: unknown; data?: unknown };
  try {
    parsed = JSON.parse(text) as { schema?: unknown; data?: unknown };
  } catch (err) {
    throw new ContentDownloadError('ملف المعاني ليس صيغة صالحة', err);
  }
  if (typeof parsed.schema !== 'string' || !Array.isArray(parsed.data)) {
    throw new ContentDownloadError('ملف المعاني لا يحمل البنية التي يتوقعها البرنامج');
  }

  const bySurah = new Map<number, StoredAyah[]>();
  for (const item of parsed.data as DumpAyah[]) {
    const surah = item.surah;
    const ayah = item.ayah;
    if (typeof surah !== 'number' || typeof ayah !== 'number') continue;
    if (surah < 1 || surah > 114 || ayah < 1) continue;
    if (!Array.isArray(item.meanings)) continue;
    const list = bySurah.get(surah) ?? [];
    list.push({ ayah, meanings: item.meanings as StoredBook[] });
    bySurah.set(surah, list);
  }
  if (bySurah.size === 0) throw new ContentDownloadError('ملف المعاني فارغ');

  try {
    // Replacing an older copy, if there is one, only once the new one is proven good.
    await removeGroup('meanings', WORD_MEANINGS.id);
    surahCache.clear();
    surahMeaningCache.clear();

    let done = 0;
    const surahs = 114;
    for (let surah = 1; surah <= surahs; surah++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const entries = bySurah.get(surah) ?? [];
      await writeText(
        wordMeaningsKey(surah),
        JSON.stringify({ surah, ayat: entries }),
        { kind: 'meanings', group: WORD_MEANINGS.id, surah },
      );
      done++;
      onProgress?.({
        phase: 'install',
        received: bytes.length,
        total: bytes.length,
        done,
        surahs,
      });
    }

    await writeText(
      MARKER_KEY,
      JSON.stringify({
        version: WORD_MEANINGS.version,
        installedAt: Date.now(),
        books: WORD_MEANINGS.books.length,
      }),
      { kind: 'meanings', group: WORD_MEANINGS.id, surah: 0 },
    );
  } catch (err) {
    if (isQuotaError(err)) {
      throw new ContentDownloadError('مساحة التخزين ممتلئة — احذف محتوى ثم أعد التحميل', err);
    }
    throw err;
  }
}

/** Deletes the installed copy from the device. */
export async function deleteWordMeanings(): Promise<number> {
  surahCache.clear();
  surahMeaningCache.clear();
  return removeGroup('meanings', WORD_MEANINGS.id);
}
