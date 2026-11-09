import { todayKey } from '@/utils/dateUtils';

/**
 * What the listener has actually heard of the الشيخ's library.
 *
 * A lecture is an hour of somebody's life, and «متابعة التقدم» has to mean something the
 * listener would recognise: this lesson I finished, this one I am halfway through, this
 * series I have been working through for a month. So every recording keeps a small record
 * of its own — how far in, how far the needle ever reached, whether it was carried to the
 * end, and how much of it has actually been listened to, counted in real seconds rather
 * than guessed from a percentage.
 *
 * The store is deliberately a plain localStorage map, the way the player already remembers
 * a paused position: this is the listener's own progress on their own device, and a
 * database table for it would be a migration to maintain for no one's benefit.
 *
 * Two figures are kept for each lecture, and the difference between them matters:
 *
 *  - `position` is where the needle rests, so playback resumes there. It moves both ways.
 *  - `furthest` is the high-water mark, and it only ever grows. It is what decides whether
 *    a lesson counts as heard — a listener who jumps back to re-hear a passage has not
 *    un-heard the rest of it.
 *
 * `listened` is the one that cannot be derived from the other two: it is the seconds of
 * genuine playback, accumulated as the clock ticks, and it is what makes the hours on the
 * progress card honest rather than the sum of every file's length.
 */

const STORAGE_KEY = 'huwaini-progress-v1';

/** A lecture counts as finished once this much of it has been heard. */
const COMPLETE_FRACTION = 0.95;

/** Anything past this fraction is "almost done", and shown as such. */
const ALMOST_FRACTION = 0.85;

export interface LectureRecord {
  /** Where playback resumes, in milliseconds. */
  position: number;
  /** The furthest point ever reached, in milliseconds — monotonic. */
  furthest: number;
  /**
   * Whether the lecture was carried to the end. For a file with no published duration
   * this is the only signal completion has, so it is stored rather than inferred.
   */
  completed: boolean;
  /** Seconds of real playback accumulated, across every sitting. */
  listened: number;
  /** When it was last touched, in epoch milliseconds. */
  updatedAt: number;
}

export interface LectureProgressStats {
  /** Lectures with any record at all. */
  started: number;
  /** Lectures carried to the end. */
  finished: number;
  /** Seconds of real playback, across the whole library. */
  listenedSeconds: number;
  /** Distinct days on which any listening happened. */
  activeDays: number;
  /** Consecutive days up to today on which anything was heard — the same idea as the app's streak. */
  streakDays: number;
}

type ProgressMap = Record<string, LectureRecord>;

/**
 * Whoever is showing the listener their progress listens here.
 *
 * Separate from the player's own stores on purpose: those change several times a second
 * while a lecture runs, and a progress card that redrew that often would be working for
 * nothing. This one fires only when a record is written, which is what the card needs.
 */
const progressListeners = new Set<() => void>();

export function subscribeLectureProgress(listener: () => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emitProgressChange(): void {
  for (const listener of progressListeners) listener();
}

/** Bumped on every write. A cheap value for `useSyncExternalStore` to compare. */
let progressRevision = 0;

export function lectureProgressRevision(): number {
  return progressRevision;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // A WebView with storage switched off is not a reason to fail: progress simply does
    // not persist, and everything else on the page still works.
    return null;
  }
}

/** A record as it must be, whatever an older or hand-edited file happened to hold. */
function sanitize(value: unknown): LectureRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<LectureRecord>;
  const position = Number(raw.position);
  const furthest = Number(raw.furthest);
  const listened = Number(raw.listened);
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(position) && !Number.isFinite(furthest) && !Number.isFinite(listened)) return null;
  const safePosition = Number.isFinite(position) && position > 0 ? position : 0;
  const safeFurthest = Number.isFinite(furthest) && furthest > 0 ? furthest : 0;
  return {
    position: safePosition,
    // The high-water mark can never sit below the resting position.
    furthest: Math.max(safeFurthest, safePosition),
    completed: raw.completed === true,
    listened: Number.isFinite(listened) && listened > 0 ? listened : 0,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0,
  };
}

export function readLectureProgress(): ProgressMap {
  const store = storage();
  if (!store) return {};
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: ProgressMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const record = sanitize(value);
      if (record) clean[id] = record;
    }
    return clean;
  } catch {
    // Unreadable progress is read as none — never as a crash on the page that shows it.
    return {};
  }
}

function write(map: ProgressMap): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or private mode: the record of this sitting is lost, nothing worse.
  }
  progressRevision += 1;
  emitProgressChange();
}

/** The record for one lecture, or a zeroed one when it has never been played. */
export function lectureRecord(id: string): LectureRecord {
  return (
    readLectureProgress()[id] ?? {
      position: 0,
      furthest: 0,
      completed: false,
      listened: 0,
      updatedAt: 0,
    }
  );
}

interface UpdateInput {
  id: string;
  /** Current playback position, in milliseconds. */
  position: number;
  /** Total length, in milliseconds — `0` when the source never published one. */
  duration: number;
  /** Seconds of playback to add since the last update. */
  listenedDelta: number;
}

/**
 * Fold one tick of playback into the record.
 *
 * Called from the player as the clock runs. It is cheap and idempotent: it reads, merges
 * and writes a single map, and every input is clamped, so a seek to a nonsense position or
 * a negative delta cannot corrupt what is stored.
 */
export function recordLectureProgress({ id, position, duration, listenedDelta }: UpdateInput): LectureRecord {
  const map = readLectureProgress();
  const previous = map[id] ?? { position: 0, furthest: 0, completed: false, listened: 0, updatedAt: 0 };
  const safePosition = Number.isFinite(position) && position > 0 ? Math.round(position) : 0;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const delta = Number.isFinite(listenedDelta) && listenedDelta > 0 ? listenedDelta : 0;

  const furthest = Math.max(previous.furthest, safePosition);
  // A file of unknown length can only be judged finished by the player saying so; a file
  // that knows its length is finished once the needle is near the end of it.
  const reachedEnd = safeDuration > 0 ? safePosition >= safeDuration * COMPLETE_FRACTION : false;

  const next: LectureRecord = {
    position: safePosition,
    furthest,
    completed: previous.completed || reachedEnd,
    listened: previous.listened + delta,
    updatedAt: Date.now(),
  };
  map[id] = next;
  write(map);
  return next;
}

/** Mark a lecture finished outright — the player reached the end of it. */
export function markLectureComplete(id: string, duration: number): LectureRecord {
  const map = readLectureProgress();
  const previous = map[id] ?? { position: 0, furthest: 0, completed: false, listened: 0, updatedAt: 0 };
  const length = Number.isFinite(duration) && duration > 0 ? duration : previous.furthest;
  const next: LectureRecord = {
    position: length,
    furthest: Math.max(previous.furthest, length),
    completed: true,
    listened: previous.listened,
    updatedAt: Date.now(),
  };
  map[id] = next;
  write(map);
  return next;
}

/**
 * Forget a lecture's progress.
 *
 * Offered beside the cards so a listener who wants to start a series afresh can, without
 * deleting the recording itself — progress and the file are two different things.
 */
export function clearLectureProgress(id: string): void {
  const map = readLectureProgress();
  if (!(id in map)) return;
  delete map[id];
  write(map);
}

/** How far through a lecture the listener is, `0`–`1`, judged by the furthest point heard. */
export function lectureFraction(id: string, durationMs: number): number {
  const record = lectureRecord(id);
  if (record.completed) return 1;
  // A file with no published length cannot be measured against one: it reads as started
  // and no further, which is the honest thing to show.
  if (durationMs <= 0) return 0;
  return Math.max(0, Math.min(1, record.furthest / durationMs));
}

export type LectureStatus = 'new' | 'in-progress' | 'almost' | 'done';

/** The four states a lecture row can be in, in the order a listener moves through them. */
export function lectureStatus(id: string, durationMs: number): LectureStatus {
  const record = lectureRecord(id);
  if (record.completed) return 'done';
  if (durationMs <= 0) return record.furthest > 0 || record.listened > 0 ? 'in-progress' : 'new';
  const fraction = record.furthest / durationMs;
  if (fraction >= COMPLETE_FRACTION) return 'done';
  if (fraction >= ALMOST_FRACTION) return 'almost';
  if (record.furthest > 0 || record.listened > 0) return 'in-progress';
  return 'new';
}

export interface CollectionProgress {
  /** Lectures carried to the end. */
  finished: number;
  /** Lectures with any progress but not finished. */
  started: number;
  total: number;
  /** `finished / total`, `0`–`1`. */
  fraction: number;
  /** Seconds actually listened within this collection. */
  listenedSeconds: number;
  /** The first unfinished lecture, the natural place to continue from. */
  nextId: string | null;
  /** True once every lecture in the collection is done. */
  complete: boolean;
}

/**
 * The progress of one course or series, from the ids of the lectures inside it.
 *
 * `nextId` is what makes the card useful: it is the lesson to resume from, so «أكمل من
 * حيث توقفت» can be a single tap rather than a scroll through a list to find the gap.
 */
export function collectionProgress(
  lectures: { id: string; seconds: number }[],
  record?: ProgressMap,
): CollectionProgress {
  const map = record ?? readLectureProgress();
  let finished = 0;
  let started = 0;
  let listenedSeconds = 0;
  let nextId: string | null = null;

  for (const lecture of lectures) {
    const entry = map[lecture.id];
    if (entry) listenedSeconds += entry.listened;
    const durationMs = lecture.seconds * 1000;
    const done = entry ? isDone(entry, durationMs) : false;
    if (done) {
      finished += 1;
    } else {
      if (entry && (entry.furthest > 0 || entry.listened > 0)) started += 1;
      if (nextId === null) nextId = lecture.id;
    }
  }

  const total = lectures.length;
  return {
    finished,
    started,
    total,
    fraction: total > 0 ? finished / total : 0,
    listenedSeconds,
    nextId,
    complete: total > 0 && finished === total,
  };
}

function isDone(entry: LectureRecord, durationMs: number): boolean {
  if (entry.completed) return true;
  if (durationMs <= 0) return false;
  return entry.furthest >= durationMs * COMPLETE_FRACTION;
}

/**
 * The library-wide figures the progress card shows.
 *
 * Kept apart from {@link readLectureProgress} so the screen can ask for the summary without
 * walking the whole map itself, and so the streak — which is the one figure a listener is
 * likely to care about daily — is computed once, in one place.
 */
export function lectureProgressStats(): LectureProgressStats {
  const map = readLectureProgress();
  let started = 0;
  let finished = 0;
  let listenedSeconds = 0;
  const days = new Set<string>();

  for (const entry of Object.values(map)) {
    if (entry.furthest > 0 || entry.listened > 0 || entry.completed) started += 1;
    if (entry.completed) finished += 1;
    listenedSeconds += entry.listened;
    if (entry.updatedAt > 0) days.add(dayKeyOf(entry.updatedAt));
  }

  return {
    started,
    finished,
    listenedSeconds: Math.round(listenedSeconds),
    activeDays: days.size,
    streakDays: streakOf(days),
  };
}

function dayKeyOf(epochMs: number): string {
  const date = new Date(epochMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Consecutive days ending today on which anything was heard.
 *
 * Today is allowed to be missing without breaking the run — a listener catching up at
 * midnight should not be told their streak is over before the day is out. Yesterday and
 * the days before it are what the count actually walks.
 */
function streakOf(days: Set<string>): number {
  if (days.size === 0) return 0;
  const today = todayKey();
  const cursor = new Date(`${today}T00:00:00`);
  if (!days.has(today)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKeyOf(cursor.getTime()))) return 0;
  }
  let streak = 0;
  while (days.has(dayKeyOf(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/**
 * The ids to play next, in order.
 *
 * «أكمل الاستماع» should offer the unfinished lessons of the thing the listener was last
 * working through, not a random file: so the record's most recent timestamp picks the
 * collection, and the collection's own order picks the lessons within it.
 */
export function recentlyTouched(limit = 8): { id: string; updatedAt: number }[] {
  const map = readLectureProgress();
  return Object.entries(map)
    .map(([id, record]) => ({ id, updatedAt: record.updatedAt }))
    .filter((entry) => entry.updatedAt > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// One lecture, as a list row needs to draw it
// ---------------------------------------------------------------------------

/**
 * Everything a single row of the catalogue needs to say where the listener stands.
 *
 * The catalogue is six hundred-odd rows long, and looking through it for the one lesson
 * that was left half-heard is the thing a progress system is for. Rather than have each
 * row recompute the fraction and the label from the raw record — and risk two rows
 * disagreeing with the dashboard — the derivation lives here, once.
 */
export interface LectureInsight {
  status: LectureStatus;
  /** `0`–`1` through the recording, judged by the furthest point heard. */
  fraction: number;
  /** Seconds heard of this lecture, from the high-water mark. */
  heardSeconds: number;
  /** Seconds still to go, or `0` when it is done or of unknown length. */
  remainingSeconds: number;
  /** When it was last touched, epoch milliseconds — `0` if never played. */
  updatedAt: number;
  /** True once anything at all has been heard of it. */
  touched: boolean;
}

export function lectureInsight(id: string, durationMs: number): LectureInsight {
  const record = lectureRecord(id);
  const fraction = lectureFraction(id, durationMs);
  const listenedSeconds = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const heardSeconds = fraction > 0 && listenedSeconds > 0 ? Math.round(fraction * listenedSeconds) : 0;
  const remainingSeconds = Math.max(0, listenedSeconds - heardSeconds);
  return {
    status: lectureStatus(id, durationMs),
    fraction,
    heardSeconds,
    remainingSeconds: record.completed ? 0 : remainingSeconds,
    updatedAt: record.updatedAt,
    touched: record.completed || record.furthest > 0 || record.listened > 0,
  };
}

/** The label an insight's status reads as, for a badge or an aria description. */
export const LECTURE_STATUS_LABEL: Record<LectureStatus, string> = {
  new: 'لم يبدأ',
  'in-progress': 'جارٍ الاستماع',
  almost: 'أوشك على الانتهاء',
  done: 'تمّ الاستماع',
};

// ---------------------------------------------------------------------------
// A day-by-day journal of listening
// ---------------------------------------------------------------------------

/** One day's listening: how much was heard, and across how many lectures. */
export interface ListeningDay {
  /** `YYYY-MM-DD`, the same key the app's streak uses. */
  day: string;
  /** Seconds of real playback recorded that day. */
  seconds: number;
  /** Distinct lectures touched that day. */
  lectures: number;
}

/**
 * The last `days` calendar days of listening, newest first, days with nothing included.
 *
 * A record only keeps when it was *last* touched, so the journal is an approximation: a
 * lecture heard across three days contributes its whole listened total to the last of them.
 * That is a deliberate trade — a per-day ledger would mean an array per record and a
 * migration — and the ordering it gives is right even where the exact split is not.
 *
 * Days are filled in even when empty, so a chart can show a week as a week rather than
 * collapsing the gaps the way a sparse list would.
 */
export function listeningJournal(days = 7): ListeningDay[] {
  const map = readLectureProgress();
  const byDay = new Map<string, { seconds: number; lectures: number }>();
  for (const record of Object.values(map)) {
    if (record.updatedAt <= 0) continue;
    const key = dayKeyOf(record.updatedAt);
    const entry = byDay.get(key) ?? { seconds: 0, lectures: 0 };
    entry.seconds += record.listened;
    entry.lectures += 1;
    byDay.set(key, entry);
  }

  const out: ListeningDay[] = [];
  const cursor = new Date(`${todayKey()}T00:00:00`);
  for (let index = 0; index < days; index += 1) {
    const key = dayKeyOf(cursor.getTime());
    const entry = byDay.get(key);
    out.push({ day: key, seconds: Math.round(entry?.seconds ?? 0), lectures: entry?.lectures ?? 0 });
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

/**
 * The lectures most listened to, in real seconds.
 *
 * «أكثر ما استمعت إليه» answers a question the totals cannot: not how far through the
 * library somebody is, but which of the الشيخ's lessons they keep returning to. The
 * catalogue is needed to turn an id back into a title, so the caller passes the lookup.
 */
export function mostListened(
  limit = 5,
  record?: ProgressMap,
): { id: string; listenedSeconds: number; updatedAt: number }[] {
  const map = record ?? readLectureProgress();
  return Object.entries(map)
    .map(([id, entry]) => ({ id, listenedSeconds: Math.round(entry.listened), updatedAt: entry.updatedAt }))
    .filter((entry) => entry.listenedSeconds > 0)
    .sort((a, b) => b.listenedSeconds - a.listenedSeconds)
    .slice(0, limit);
}
