import { DEFAULT_BADGES, type CustomBadge } from '@/data/customBadges';

/** Everything a badge counts, as figures the app already keeps somewhere. */
export interface BadgeMetrics {
  /** Consecutive days on which every task was done. */
  streak: number;
  /** Distinct ayahs in the memorisation record. */
  memorizedAyahs: number;
  /** Tasks ever completed, across all days. */
  completedTasks: number;
  /** Prayers confirmed «في وقتها» across every recorded day. */
  ontimePrayers: number;
  /** Quran completions that reached the last page. */
  completedKhatmahs: number;
  /** Days on which every daily dhikr was carried through. */
  adhkarDays: number;
}

export interface BadgeProgress {
  badge: CustomBadge;
  /** What has been achieved so far, in the requirement's own unit. */
  value: number;
  target: number;
  unlocked: boolean;
  /** `value / target`, never above 1 — how far the bar under a badge should fill. */
  fraction: number;
}

/**
 * What each badge asks for, and in what it is measured.
 *
 * The thresholds are not new: seven of these were already how the screen
 * decided what to display. The other three — a hundred prayers on time, ten
 * days of adhkar, a finished khatmah — had a badge written for them and no
 * line anywhere that could ever award it, which is what happens when only
 * earned badges are drawn: nothing notices that the rest are unreachable,
 * because nobody is shown they exist.
 */
const REQUIREMENTS: Record<string, { metric: keyof BadgeMetrics; target: number }> = {
  'first-day': { metric: 'streak', target: 3 },
  'week-streak': { metric: 'streak', target: 7 },
  'month-streak': { metric: 'streak', target: 30 },
  'small-hafiz': { metric: 'memorizedAyahs', target: 10 },
  'dedicated-hafiz': { metric: 'memorizedAyahs', target: 100 },
  'expert-hafiz': { metric: 'memorizedAyahs', target: 500 },
  'persistent': { metric: 'completedTasks', target: 50 },
  'prayer-champion': { metric: 'ontimePrayers', target: 100 },
  'dhikr-lover': { metric: 'adhkarDays', target: 10 },
  'khatmah-hero': { metric: 'completedKhatmahs', target: 1 },
};

/**
 * Scores every badge against the same snapshot, in catalogue order.
 *
 * The order is the catalogue's, not the progress ones — a badge that moves
 * as you approach it is a badge whose position you cannot learn, and the
 * grid is read by people who are looking for the one they are closest to.
 *
 * A badge with no requirement scores at zero and never unlocks. That is
 * deliberate rather than fatal: it is the state the screen must be able to
 * show honestly, and `evaluateBadgesCoversEveryBadge` is what stops it
 * lasting.
 */
export function evaluateBadges(metrics: BadgeMetrics): BadgeProgress[] {
  return DEFAULT_BADGES.map((badge) => {
    const requirement = REQUIREMENTS[badge.id];
    const value = requirement ? metrics[requirement.metric] : 0;
    const target = requirement?.target ?? 1;
    return {
      badge,
      value,
      target,
      unlocked: value >= target,
      fraction: target > 0 ? Math.min(value / target, 1) : 0,
    };
  });
}

/** Ids that have a requirement, exposed so the coverage can be asserted. */
export function scoredBadgeIds(): string[] {
  return Object.keys(REQUIREMENTS);
}
