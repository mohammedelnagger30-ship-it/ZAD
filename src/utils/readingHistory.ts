import { TOTAL_QURAN_PAGES, getSurah, toArabicNumber } from '@/data/surahs';
import { trustedNowMs } from '@/utils/clock';

/**
 * Recent reading positions — where the reader last was, and what it passed
 * through lately. This is the data behind the home screen's «متابعة القراءة»
 * card and its recent chips.
 *
 * Two sources feed the resume target:
 *
 *   * this history — every settled mushaf page and every surah opened in the
 *     ayah reader, newest first, bounded so it can never grow; and
 *   * `READING_STATE_KEY` — the reader screen's own saved state, which predates
 *     this module. An install upgrading into it has no history yet but does have
 *     a last page, and a resume button that ignores that would look broken on
 *     first open, so `resumeReading` falls back to it.
 *
 * localStorage rather than Dexie: it is read synchronously at first paint (the
 * home screen renders before IndexedDB opens), it is a bounded list of twelve
 * entries, and it is device-local reading recency — not account data, so it
 * never travels in backups or sync, and it is wiped at sign-out like the other
 * local-only traces (see `clearLocalUserData`).
 */

/** The reader screen's saved view/surah/page state, owned by `QuranScreen`. */
export const READING_STATE_KEY = 'zad:quran-reader-state';
const HISTORY_KEY = 'zad:reading-history';

/** How many entries the history keeps; older ones fall off the end. */
const MAX_ENTRIES = 12;

export type ReadingEntry =
  | { kind: 'page'; page: number; at: number }
  | { kind: 'surah'; surahId: number; ayah: number; at: number };

/** What a recording call can ask for — the `at` stamp belongs to the module. */
export type ReadingInput =
  | { kind: 'page'; page: number }
  | { kind: 'surah'; surahId: number; ayah?: number };

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * One stored entry, validated or rejected whole.
 *
 * The list is written by this module alone, but localStorage is shared ground:
 * a truncated write, a stale value from a future version, or a hand-edited key
 * must cost that entry, never the card that renders the list.
 */
function isValidEntry(value: unknown): value is ReadingEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  // A timestamp is checked for being a plausible number, not an integer:
  // `trustedNowMs()` projects monotonic perf time and carries fractions, and a
  // fractional `at` is data, not corruption. What must stay integral are the
  // *positions*, below — a page or an ayah is a count of things.
  if (typeof entry.at !== 'number' || !Number.isFinite(entry.at) || entry.at <= 0) return false;
  if (entry.kind === 'page') {
    return isInt(entry.page) && entry.page >= 1 && entry.page <= TOTAL_QURAN_PAGES;
  }
  if (entry.kind === 'surah') {
    const surah = isInt(entry.surahId) ? getSurah(entry.surahId) : null;
    return !!surah && isInt(entry.ayah) && entry.ayah >= 1 && entry.ayah <= surah.ayahCount;
  }
  return false;
}

/** Sorted newest-first, validated, bounded — how every read of the list is served. */
function parseHistory(raw: string | null): ReadingEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidEntry)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_ENTRIES);
  } catch {
    // A malformed list costs the history, not the screen showing it.
    return [];
  }
}

/** Two entries about the same place: re-reading it must move it up, not duplicate it. */
function samePosition(a: ReadingEntry, b: ReadingEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'page' && b.kind === 'page') return a.page === b.page;
  if (a.kind === 'surah' && b.kind === 'surah') return a.surahId === b.surahId && a.ayah === b.ayah;
  return false;
}

/**
 * Remembers a position the reader actually reached.
 *
 * Invalid input is dropped silently: a swallowed exception here would be a bug
 * in the caller's numbers, not something to surface over the reading itself.
 * Re-visiting a position refreshes its timestamp and lifts it to the front, so
 * «آخر قرأت» answers *when* as well as *where*.
 */
export function recordReading(input: ReadingInput): void {
  // Rounded: storage keeps whole milliseconds regardless of the perf-projected
  // fraction the clock reports, so entries compare and print cleanly.
  const at = Math.round(trustedNowMs());
  let entry: ReadingEntry;
  if (input.kind === 'page') {
    if (!isInt(input.page) || input.page < 1 || input.page > TOTAL_QURAN_PAGES) return;
    entry = { kind: 'page', page: input.page, at };
  } else {
    const surah = isInt(input.surahId) ? getSurah(input.surahId) : null;
    if (!surah) return;
    const ayah = isInt(input.ayah) ? input.ayah : 1;
    if (ayah < 1 || ayah > surah.ayahCount) return;
    entry = { kind: 'surah', surahId: surah.id, ayah, at };
  }

  try {
    const rest = parseHistory(localStorage.getItem(HISTORY_KEY)).filter((item) => !samePosition(item, entry));
    const next = [entry, ...rest].slice(0, MAX_ENTRIES);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // LocalStorage is best-effort: the reading itself is never blocked on it.
  }
}

/** Newest-first recent positions, at most `limit`. */
export function listReading(limit = 6): ReadingEntry[] {
  try {
    return parseHistory(localStorage.getItem(HISTORY_KEY)).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/** The newest position, or null when the device has never recorded one. */
export function lastReading(): ReadingEntry | null {
  return listReading(1)[0] ?? null;
}

/**
 * Where «متابعة القراءة» should go: the newest history entry, else the reader's
 * own saved state, else nothing to resume.
 *
 * The fallback exists for the upgrade case — an install that read pages long
 * before this module existed has a saved mushaf page but no history — and it is
 * parsed leniently for the same reason `QuranScreen` parses its own copy: the
 * value is untrusted storage, and anything that does not fit is simply not a
 * resumable position.
 */
export function resumeReading(): ReadingInput | null {
  const newest = lastReading();
  if (newest) {
    return newest.kind === 'page'
      ? { kind: 'page', page: newest.page }
      : { kind: 'surah', surahId: newest.surahId, ayah: newest.ayah };
  }

  try {
    const raw = localStorage.getItem(READING_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const isInt = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value);

    // The *active* view decides: a reader sitting on a surah with an older
    // mushaf page behind it resumes into the surah it is actually showing.
    if (parsed.viewMode === 'reader' || parsed.viewMode === 'hifz') {
      const surahId = isInt(parsed.surahId) ? parsed.surahId : 0;
      const surah = getSurah(surahId);
      if (surah) {
        const ayah = isInt(parsed.fromAyah) && parsed.fromAyah >= 1 && parsed.fromAyah <= surah.ayahCount
          ? parsed.fromAyah
          : 1;
        return { kind: 'surah', surahId, ayah };
      }
    }
    if (parsed.viewMode === 'mushaf' || parsed.hasMushafPosition === true) {
      const page = isInt(parsed.mushafPage) ? parsed.mushafPage : 0;
      if (page >= 1 && page <= TOTAL_QURAN_PAGES) return { kind: 'page', page };
    }
  } catch {
    // Unreadable saved state is simply nothing to resume.
  }
  return null;
}

/** Navigation params for `navigate('quran', …)` that land on this position. */
export function readingParams(input: ReadingInput): Record<string, number> {
  return input.kind === 'page'
    ? { openPage: input.page }
    : { openSurahId: input.surahId, openAyah: input.ayah ?? 1 };
}

/**
 * One position's name as the UI shows it: «الصفحة ٥٨» / «سورة البقرة · من الآية ١٥».
 *
 * Accepts a stored entry or a bare resume target — the two differ only by the
 * `at` stamp, which this label never shows.
 */
export function describeReading(entry: ReadingEntry | ReadingInput): string {
  if (entry.kind === 'page') return `الصفحة ${toArabicNumber(entry.page)}`;
  const surah = getSurah(entry.surahId);
  if (!surah) return '';
  const ayah = entry.ayah ?? 1;
  return ayah > 1
    ? `سورة ${surah.name} · من الآية ${toArabicNumber(ayah)}`
    : `سورة ${surah.name}`;
}

/**
 * Arabic plural agreement for a counted span: «منذ دقيقة», «منذ دقيقتان»,
 * «منذ ٣ دقائق», «منذ ١١ دقيقة». The count itself is Arabic-Indic, so the
 * branch has to run on the Western value before it is formatted.
 */
function counted(n: number, forms: { one: string; two: string; few: string; many: string }): string {
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  const tens = n % 100;
  if (tens >= 3 && tens <= 10) return `${toArabicNumber(n)} ${forms.few}`;
  return `${toArabicNumber(n)} ${forms.many}`;
}

/**
 * How long ago `at` was: «الآن», «منذ ٣ دقائق», «أمس», «منذ ٤ أيام».
 *
 * `now` is an argument so the card's clock and the test's clock are the same
 * clock — the app treats wall time as untrusted everywhere else and this label
 * is the first place a reader would notice it jumping.
 */
export function describeReadingAge(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) {
    return `منذ ${counted(minutes, { one: 'دقيقة', two: 'دقيقتان', few: 'دقائق', many: 'دقيقة' })}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `منذ ${counted(hours, { one: 'ساعة', two: 'ساعتان', few: 'ساعات', many: 'ساعة' })}`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return 'أمس';
  return `منذ ${counted(days, { one: 'يوم', two: 'يومان', few: 'أيام', many: 'يوماً' })}`;
}

/** Sign-out: reading recency is a trace of the previous account, like the adhkar counters. */
export function clearReadingHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(READING_STATE_KEY);
  } catch {
    // Nothing to clean if storage is unreachable.
  }
}
