import { db, type HifzGrade, type HifzReview } from '@/db/database';
import { toArabicNumber } from '@/data/surahs';
import { trustedNowMs } from '@/utils/clock';

/**
 * Spaced repetition (SM-2) for hifz portions, plus the quiz generator it feeds.
 *
 * The app already records how well a surah's portion is memorised
 * (`hifzProgress`), but nothing ever *asked* the user to prove it — the rating
 * sat there and decayed. This module turns that into a loop: quiz a portion,
 * grade the attempt, and schedule the next review with the classic SM-2
 * interval ladder (1 day → 6 days → interval × ease), so a strong portion
 * drifts to monthly reviews while a lapsed one comes back tomorrow.
 *
 * Everything from the interval math to the question builder is pure and takes
 * its randomness/clock as arguments — the tests here check the schedule and
 * the quiz invariants without a database or a timer.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** SM-2's floor for the easiness factor — below 1.3 intervals stop growing meaningfully. */
export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;
/** A memorised portion that needs a year between checks is "kept"; beyond that it is forgotten. */
export const MAX_INTERVAL_DAYS = 365;

/** SM-2 answers are qualities 0–5; anything below 3 is a lapse. */
export const GRADE_QUALITY: Record<HifzGrade, number> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
};

export const GRADE_LABELS_AR: Record<HifzGrade, string> = {
  again: 'نسيتها',
  hard: 'صعبة',
  good: 'جيدة',
  easy: 'سهلة',
};

export interface ReviewState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

export function initialReviewState(): ReviewState {
  return { ease: DEFAULT_EASE, intervalDays: 0, repetitions: 0, lapses: 0 };
}

export function reviewRangeKey(surahId: number, fromAyah: number, toAyah: number): string {
  return `${surahId}:${fromAyah}-${toAyah}`;
}

/**
 * One SM-2 step: the state after answering with `quality`, and when the range
 * is next due. A lapse (< 3) restarts the ladder at one day and counts itself;
 * a success walks 1 → 6 → previous × ease, capped so a kept portion cannot
 * schedule itself into next year's oblivion.
 */
export function scheduleReview(
  state: ReviewState,
  quality: number,
  now: number,
): { state: ReviewState; dueAt: number } {
  const q = Math.min(5, Math.max(0, quality));
  const easeDelta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  const ease = Math.max(MIN_EASE, state.ease + easeDelta);

  let repetitions: number;
  let intervalDays: number;
  let lapses = state.lapses;

  if (q < 3) {
    repetitions = 0;
    intervalDays = 1;
    lapses += 1;
  } else {
    repetitions = state.repetitions + 1;
    if (repetitions === 1) intervalDays = 1;
    else if (repetitions === 2) intervalDays = 6;
    else intervalDays = Math.round(state.intervalDays * ease);
    intervalDays = Math.min(intervalDays, MAX_INTERVAL_DAYS);
  }

  return {
    state: { ease, intervalDays, repetitions, lapses },
    dueAt: now + intervalDays * DAY_MS,
  };
}

/** True when a stored review has reached (or passed) its next due moment. */
export function isReviewDue(review: Pick<HifzReview, 'dueAt'>, now: number): boolean {
  return review.dueAt <= now;
}

/** Arabic description of an interval — «غدًا», «بعد أسبوع», «بعد شهر». */
export function describeIntervalDays(days: number): string {
  if (days <= 0) return 'اليوم';
  if (days === 1) return 'غدًا';
  if (days === 2) return 'بعد يومين';
  if (days < 7) return `بعد ${toArabicNumber(days)} أيام`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    if (weeks === 1) return 'بعد أسبوع';
    if (weeks === 2) return 'بعد أسبوعين';
    return `بعد ${toArabicNumber(weeks)} أسابيع`;
  }
  if (days < 365) {
    const months = Math.round(days / 30);
    if (months === 1) return 'بعد شهر';
    if (months === 2) return 'بعد شهرين';
    return `بعد ${toArabicNumber(months)} أشهر`;
  }
  return 'بعد سنة';
}

// ---- Quiz generation ----

export interface OrderQuestion {
  type: 'order';
  /** Ayahs shown shuffled — the user must tap them back in ascending order. */
  shuffled: number[];
}

export interface ChoiceQuestion {
  type: 'choice';
  promptAyah: number;
  answerAyah: number;
  /** Four ayah numbers, shuffled; one of them is `answerAyah`. */
  options: number[];
}

export interface RecallQuestion {
  type: 'recall';
  ayahNumber: number;
}

export type QuizQuestion = OrderQuestion | ChoiceQuestion | RecallQuestion;

/** Fisher–Yates with an injectable source of randomness (tests pass a seeded one). */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Builds one quiz question for a portion.
 *
 * The question type follows the portion's size because each test only means
 * something at the size it can actually probe:
 * - ≥3 ayahs → an *order* quiz over a 5-ayah window (or the whole portion if
 *   smaller): reciting in sequence is the core hifz skill.
 * - exactly 2 → a *next-ayah* choice: given the first, pick the second from
 *   four neighbours.
 * - exactly 1 → a *recall* card: hide the ayah, reveal, self-grade.
 */
export function buildQuizQuestion(
  surahAyahCount: number,
  fromAyah: number,
  toAyah: number,
  random: () => number = Math.random,
): QuizQuestion {
  const from = Math.max(1, Math.min(fromAyah, surahAyahCount));
  const to = Math.max(from, Math.min(toAyah, surahAyahCount));
  const size = to - from + 1;

  if (size === 1) {
    return { type: 'recall', ayahNumber: from };
  }

  if (size === 2) {
    const answer = to;
    // Distractors are the answer's nearest neighbours outside the portion:
    // a hifz mistake confuses *adjacent* ayahs, so distant random options
    // would make the question a giveaway.
    const pool: number[] = [];
    for (let offset = 1; pool.length < 3 && offset <= surahAyahCount; offset++) {
      if (answer - offset >= 1) pool.push(answer - offset);
      if (answer + offset <= surahAyahCount && pool.length < 3) pool.push(answer + offset);
    }
    return { type: 'choice', promptAyah: from, answerAyah: answer, options: shuffle([answer, ...pool], random) };
  }

  const windowSize = Math.min(5, size);
  const start = from + Math.floor(random() * (size - windowSize + 1));
  const sequence = Array.from({ length: windowSize }, (_, index) => start + index);
  return { type: 'order', shuffled: shuffle(sequence, random) };
}

/** Perfect order run → «easy»; each slip costs one grade step. */
export function gradeOrderResult(errors: number): HifzGrade {
  if (errors === 0) return 'easy';
  if (errors === 1) return 'good';
  if (errors === 2) return 'hard';
  return 'again';
}

/** A choice quiz scores its correct answers out of three questions. */
export function gradeChoiceResult(correct: number): HifzGrade {
  if (correct >= 3) return 'good';
  if (correct === 2) return 'hard';
  return 'again';
}

// ---- Persistence ----

export async function getHifzReview(
  surahId: number,
  fromAyah: number,
  toAyah: number,
): Promise<HifzReview | null> {
  const row = await db.hifzReviews.where('key').equals(reviewRangeKey(surahId, fromAyah, toAyah)).first();
  return row ?? null;
}

/**
 * Applies a quiz grade to a portion's schedule: updates the stored SM-2 state
 * in place (one row per portion) and returns the new row so the result screen
 * can show the next due interval immediately.
 */
export async function recordQuizResult(
  surahId: number,
  fromAyah: number,
  toAyah: number,
  grade: HifzGrade,
): Promise<HifzReview> {
  const key = reviewRangeKey(surahId, fromAyah, toAyah);
  const existing = await db.hifzReviews.where('key').equals(key).first();
  const now = trustedNowMs();
  const { state, dueAt } = scheduleReview(
    existing
      ? { ease: existing.ease, intervalDays: existing.intervalDays, repetitions: existing.repetitions, lapses: existing.lapses }
      : initialReviewState(),
    GRADE_QUALITY[grade],
    now,
  );
  const row = {
    key,
    surahId,
    fromAyah,
    toAyah,
    ...state,
    dueAt,
    lastGrade: grade,
    lastReviewedAt: now,
  };
  if (existing?.id !== undefined) {
    await db.hifzReviews.put({ ...row, id: existing.id });
    return { ...row, id: existing.id };
  }
  const id = await db.hifzReviews.add(row);
  return { ...row, id };
}
