import { describe, it, expect } from '@jest/globals';
import {
  buildQuizQuestion,
  describeIntervalDays,
  gradeChoiceResult,
  gradeOrderResult,
  GRADE_QUALITY,
  initialReviewState,
  isReviewDue,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  reviewRangeKey,
  scheduleReview,
  shuffle,
} from '@/utils/spacedRepetition';

/**
 * The SM-2 schedule behind the hifz quiz: the interval ladder (1 → 6 → ×ease),
 * the lapse behaviour, the caps, and the quiz generator's invariants — every
 * question type stays inside its portion, keeps four unique options, and hands
 * out grades that match the attempt.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const now = 1_700_000_000_000;

/** Runs `count` consecutive qualities through the scheduler, folding state. */
function runReviews(count: number, quality: number) {
  let state = initialReviewState();
  let dueAt = now;
  const intervals: number[] = [];
  for (let i = 0; i < count; i++) {
    const step = scheduleReview(state, quality, now);
    state = step.state;
    dueAt = step.dueAt;
    intervals.push(state.intervalDays);
  }
  return { state, dueAt, intervals };
}

describe('scheduleReview — the SM-2 ladder', () => {
  it('walks 1 → 6 → interval × ease for consecutive «good» answers', () => {
    // Quality 4 leaves ease at its 2.5 default, so the ladder is fully predictable:
    // 1, 6, 15 (6 × 2.5), 38, 95, 238, then the cap.
    const { intervals } = runReviews(6, GRADE_QUALITY.good);
    expect(intervals).toEqual([1, 6, 15, 38, 95, 238]);
  });

  it('caps the interval so a kept portion cannot schedule itself into oblivion', () => {
    const { intervals } = runReviews(12, GRADE_QUALITY.good);
    expect(Math.max(...intervals)).toBe(MAX_INTERVAL_DAYS);
    expect(intervals[intervals.length - 1]).toBe(MAX_INTERVAL_DAYS);
  });

  it('a lapse restarts the ladder at one day and counts itself', () => {
    const { state } = runReviews(4, GRADE_QUALITY.good);
    expect(state.repetitions).toBe(4);

    const lapsed = scheduleReview(state, GRADE_QUALITY.again, now);
    expect(lapsed.state.repetitions).toBe(0);
    expect(lapsed.state.intervalDays).toBe(1);
    expect(lapsed.state.lapses).toBe(1);
    expect(lapsed.dueAt).toBe(now + DAY_MS);
  });

  it('raises ease for «easy», keeps it for «good», floors it at 1.3', () => {
    const easy = scheduleReview(initialReviewState(), GRADE_QUALITY.easy, now);
    expect(easy.state.ease).toBeCloseTo(2.6, 5);

    const good = scheduleReview(initialReviewState(), GRADE_QUALITY.good, now);
    expect(good.state.ease).toBeCloseTo(2.5, 5);

    const { state } = runReviews(20, GRADE_QUALITY.again);
    expect(state.ease).toBe(MIN_EASE);
  });

  it('schedules every review into the future', () => {
    const { dueAt } = runReviews(3, GRADE_QUALITY.good);
    expect(dueAt).toBeGreaterThan(now);
  });
});

describe('isReviewDue', () => {
  it('fires only once the due moment has arrived', () => {
    expect(isReviewDue({ dueAt: now }, now - 1)).toBe(false);
    expect(isReviewDue({ dueAt: now }, now)).toBe(true);
    expect(isReviewDue({ dueAt: now }, now + 1)).toBe(true);
  });
});

describe('reviewRangeKey', () => {
  it('is the portion identity — one schedule per surah range', () => {
    expect(reviewRangeKey(67, 1, 5)).toBe('67:1-5');
    expect(reviewRangeKey(67, 1, 5)).toBe(reviewRangeKey(67, 1, 5));
    expect(reviewRangeKey(67, 1, 5)).not.toBe(reviewRangeKey(67, 1, 6));
  });
});

describe('describeIntervalDays', () => {
  it('speaks plain Arabic for each ladder rung', () => {
    expect(describeIntervalDays(0)).toBe('اليوم');
    expect(describeIntervalDays(1)).toBe('غدًا');
    expect(describeIntervalDays(2)).toBe('بعد يومين');
    expect(describeIntervalDays(5)).toBe('بعد ٥ أيام');
    expect(describeIntervalDays(7)).toBe('بعد أسبوع');
    expect(describeIntervalDays(14)).toBe('بعد أسبوعين');
    expect(describeIntervalDays(30)).toBe('بعد شهر');
    expect(describeIntervalDays(60)).toBe('بعد شهرين');
    expect(describeIntervalDays(365)).toBe('بعد سنة');
  });
});

/** A tiny LCG so shuffles in tests are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(items, seededRandom(42));
    expect([...result].sort((a, b) => a - b)).toEqual(items);
  });

  it('actually moves elements with a real draw', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const results = new Set<string>();
    for (let seed = 0; seed < 10; seed++) {
      results.add(shuffle(items, seededRandom(seed)).join(','));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe('buildQuizQuestion', () => {
  it('a one-ayah portion becomes a recall card', () => {
    expect(buildQuizQuestion(7, 3, 3, seededRandom(1))).toEqual({ type: 'recall', ayahNumber: 3 });
  });

  it('a two-ayah portion becomes a next-ayah choice with four unique options inside the surah', () => {
    const question = buildQuizQuestion(7, 2, 3, seededRandom(2));
    expect(question.type).toBe('choice');
    if (question.type !== 'choice') return;
    expect(question.promptAyah).toBe(2);
    expect(question.answerAyah).toBe(3);
    expect(question.options).toHaveLength(4);
    expect(new Set(question.options).size).toBe(4);
    expect(question.options).toContain(3);
    for (const option of question.options) {
      expect(option).toBeGreaterThanOrEqual(1);
      expect(option).toBeLessThanOrEqual(7);
    }
    // The distractors must be neighbours, not far-away giveaways.
    for (const option of question.options) {
      expect(Math.abs(option - 3)).toBeLessThanOrEqual(3);
    }
  });

  it('a larger portion becomes an order window that stays inside the portion', () => {
    const question = buildQuizQuestion(20, 5, 19, seededRandom(3));
    expect(question.type).toBe('order');
    if (question.type !== 'order') return;
    expect(question.shuffled.length).toBeLessThanOrEqual(5);
    expect(question.shuffled.length).toBeGreaterThanOrEqual(3);
    const sorted = [...question.shuffled].sort((a, b) => a - b);
    // A contiguous window, entirely inside the selected portion.
    expect(sorted[sorted.length - 1] - sorted[0]).toBe(sorted.length - 1);
    expect(sorted[0]).toBeGreaterThanOrEqual(5);
    expect(sorted[sorted.length - 1]).toBeLessThanOrEqual(19);
  });

  it('clamps a portion that runs past the surah boundary', () => {
    const question = buildQuizQuestion(5, 3, 99, seededRandom(4));
    // Whatever type comes out, every ayah referenced is within the surah.
    if (question.type === 'order') {
      for (const ayah of question.shuffled) expect(ayah).toBeLessThanOrEqual(5);
    } else if (question.type === 'choice') {
      expect(question.answerAyah).toBeLessThanOrEqual(5);
      for (const option of question.options) expect(option).toBeLessThanOrEqual(5);
    } else {
      expect(question.ayahNumber).toBeLessThanOrEqual(5);
    }
  });
});

describe('grading', () => {
  it('an order run loses one grade step per slip', () => {
    expect(gradeOrderResult(0)).toBe('easy');
    expect(gradeOrderResult(1)).toBe('good');
    expect(gradeOrderResult(2)).toBe('hard');
    expect(gradeOrderResult(3)).toBe('again');
    expect(gradeOrderResult(9)).toBe('again');
  });

  it('a choice quiz grades its hit rate', () => {
    expect(gradeChoiceResult(3)).toBe('good');
    expect(gradeChoiceResult(2)).toBe('hard');
    expect(gradeChoiceResult(1)).toBe('again');
    expect(gradeChoiceResult(0)).toBe('again');
  });
});
