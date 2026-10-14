/**
 * The point of this module is that no badge can quietly become unreachable.
 * Three of them already had: their names were in the catalogue, their
 * requirements were written in prose, and nothing in the app could ever
 * award them — invisible, so never noticed.
 *
 * These tests hold the catalogue and the requirements together, and pin the
 * thresholds so that changing one is a decision rather than an accident.
 */
import { describe, it, expect } from '@jest/globals';
import { DEFAULT_BADGES } from '@/data/customBadges';
import { evaluateBadges, scoredBadgeIds, type BadgeMetrics } from '@/utils/badgeProgress';

const zeros: BadgeMetrics = {
  streak: 0,
  memorizedAyahs: 0,
  completedTasks: 0,
  ontimePrayers: 0,
  completedKhatmahs: 0,
  adhkarDays: 0,
};

/** `with` is a reserved word in JavaScript, hence the longer name. */
const metricsWith = (patch: Partial<BadgeMetrics>): BadgeMetrics => ({ ...zeros, ...patch });

const find = (results: ReturnType<typeof evaluateBadges>, id: string) => {
  const found = results.find((entry) => entry.badge.id === id);
  if (!found) throw new Error(`no badge scored for ${id}`);
  return found;
};

describe('evaluateBadges', () => {
  it('gives every badge in the catalogue a requirement', () => {
    expect(scoredBadgeIds().sort()).toEqual(DEFAULT_BADGES.map((badge) => badge.id).sort());
  });

  it('keeps the catalogue order', () => {
    expect(evaluateBadges(zeros).map((entry) => entry.badge.id)).toEqual(
      DEFAULT_BADGES.map((badge) => badge.id),
    );
  });

  it('holds every threshold where it was written', () => {
    expect(evaluateBadges(zeros).map((entry) => [entry.badge.id, entry.target])).toEqual([
      ['first-day', 3],
      ['week-streak', 7],
      ['month-streak', 30],
      ['small-hafiz', 10],
      ['dedicated-hafiz', 100],
      ['expert-hafiz', 500],
      ['persistent', 50],
      ['prayer-champion', 100],
      ['dhikr-lover', 10],
      ['khatmah-hero', 1],
    ]);
  });

  it('unlocks at the threshold and not one step before', () => {
    expect(find(evaluateBadges(metricsWith({ streak: 2 })), 'first-day').unlocked).toBe(false);
    expect(find(evaluateBadges(metricsWith({ streak: 3 })), 'first-day').unlocked).toBe(true);

    expect(find(evaluateBadges(metricsWith({ adhkarDays: 9 })), 'dhikr-lover').unlocked).toBe(false);
    expect(find(evaluateBadges(metricsWith({ adhkarDays: 10 })), 'dhikr-lover').unlocked).toBe(true);

    // The badge with no middle ground: a khatmah is finished or it is not.
    expect(find(evaluateBadges(metricsWith({ completedKhatmahs: 0 })), 'khatmah-hero').unlocked).toBe(false);
    expect(find(evaluateBadges(metricsWith({ completedKhatmahs: 1 })), 'khatmah-hero').unlocked).toBe(true);
  });

  it('keeps one measure per badge, so a thousand tasks cannot buy a streak', () => {
    const results = evaluateBadges(metricsWith({ completedTasks: 500, memorizedAyahs: 900 }));

    expect(find(results, 'persistent').unlocked).toBe(true);
    expect(find(results, 'expert-hafiz').unlocked).toBe(true);
    expect(find(results, 'first-day').unlocked).toBe(false);
    expect(find(results, 'week-streak').unlocked).toBe(false);
    expect(find(results, 'prayer-champion').unlocked).toBe(false);
  });

  it('fills the bar from the requirement’s own unit and never past it', () => {
    expect(find(evaluateBadges(metricsWith({ memorizedAyahs: 50 })), 'dedicated-hafiz').fraction).toBeCloseTo(0.5);
    expect(find(evaluateBadges(metricsWith({ memorizedAyahs: 5000 })), 'expert-hafiz').fraction).toBe(1);
    expect(find(evaluateBadges(zeros), 'month-streak').fraction).toBe(0);
  });
});
