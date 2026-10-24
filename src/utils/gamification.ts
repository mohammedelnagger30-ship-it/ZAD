import type { BadgeMetrics } from '@/utils/badgeProgress';

/**
 * XP and levels — the motivational layer over figures the app already keeps.
 *
 * Deliberately *derived*, not stored: the score is recomputed from the same
 * snapshot the badges and the progress percentages read, so it can never drift
 * from the underlying record, never need a migration, and never disagree with
 * the streak it is meant to reward. There is nothing to exploit and nothing to
 * lose on a reinstall — the XP is a different view of the same achievements.
 *
 * The weights answer one question each: how much is this kind of effort worth
 * *relative to the others*? An ayah actually memorised (10) outranks a single
 * completed task (8), because the ayah is the product this app exists for; a
 * task outranks an on-time prayer (5), being a commitment made for today and
 * kept; a whole day of either is worth a streak day (25), since it is every
 * commitment for a day rather than one of them; and a finished khatmah (1000)
 * is a milestone, weighted like a hundred memorised ayahs because completing
 * the mushaf is exactly that long a road.
 */

export const XP_WEIGHTS = {
  /** One day on which every task was done. */
  streakDay: 25,
  /** One distinct ayah in the memorisation record. */
  memorizedAyah: 10,
  /** One task carried through. */
  completedTask: 8,
  /** One prayer confirmed «في وقتها». */
  ontimePrayer: 5,
  /** One Quran completion that reached the last page. */
  completedKhatmah: 1000,
  /** One day on which every daily dhikr was carried through. */
  adhkarDay: 15,
} as const;

export type XpSource = keyof typeof XP_WEIGHTS;

const XP_LABELS: Record<XpSource, string> = {
  streakDay: 'يوم متتالٍ',
  memorizedAyah: 'آية محفوظة',
  completedTask: 'مهمة مكتملة',
  ontimePrayer: 'صلاة في وقتها',
  completedKhatmah: 'ختمة كاملة',
  adhkarDay: 'يوم أذكار',
};

/** One source's contribution, ready to render: «مهمة مكتملة × ١٢ = ٩٦ نقطة». */
export interface XpLine {
  source: XpSource;
  label: string;
  count: number;
  xp: number;
}

/** The snapshot's total XP. */
export function computeXp(metrics: BadgeMetrics): number {
  return metrics.streak * XP_WEIGHTS.streakDay
    + metrics.memorizedAyahs * XP_WEIGHTS.memorizedAyah
    + metrics.completedTasks * XP_WEIGHTS.completedTask
    + metrics.ontimePrayers * XP_WEIGHTS.ontimePrayer
    + metrics.completedKhatmahs * XP_WEIGHTS.completedKhatmah
    + metrics.adhkarDays * XP_WEIGHTS.adhkarDay;
}

/**
 * Every source that has actually earned something, largest first.
 *
 * Sources at zero are dropped: a breakdown whose rows all read ×٠ teaches
 * nothing, and the card has one job — showing where the score came from.
 */
export function xpBreakdown(metrics: BadgeMetrics): XpLine[] {
  const counts: Record<XpSource, number> = {
    streakDay: metrics.streak,
    memorizedAyah: metrics.memorizedAyahs,
    completedTask: metrics.completedTasks,
    ontimePrayer: metrics.ontimePrayers,
    completedKhatmah: metrics.completedKhatmahs,
    adhkarDay: metrics.adhkarDays,
  };
  return (Object.keys(XP_WEIGHTS) as XpSource[])
    .map((source) => ({
      source,
      label: XP_LABELS[source],
      count: counts[source],
      xp: counts[source] * XP_WEIGHTS[source],
    }))
    .filter((line) => line.count > 0)
    .sort((a, b) => b.xp - a.xp);
}

/**
 * Cumulative XP needed to *reach* `level`.
 *
 * Quadratic on purpose: each level costs 100 XP more than the last (100, 300,
 * 500, …), so the early levels arrive quickly enough to teach the loop and the
 * late ones stay worth wanting. Level 1 costs nothing — everyone starts there.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  const step = level - 1;
  return 100 * step * step;
}

/** The level this XP has reached: level 1 at 0, level 2 at 100, level 3 at 400. */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

/**
 * The tier a level wears, by *level* rather than XP — a tier is a rung, and
 * the highest tier at or below the level is the one shown.
 */
const LEVEL_NAMES: { min: number; name: string }[] = [
  { min: 1, name: 'مبتدئ' },
  { min: 3, name: 'قارئ' },
  { min: 5, name: 'حافظ' },
  { min: 8, name: 'مُتقن' },
  { min: 11, name: 'مرسِل' },
  { min: 15, name: 'خازِن القرآن' },
];

export function levelName(level: number): string {
  let name = LEVEL_NAMES[0].name;
  for (const tier of LEVEL_NAMES) {
    if (level >= tier.min) name = tier.name;
  }
  return name;
}

export interface LevelState {
  level: number;
  name: string;
  totalXp: number;
  /** XP earned within the current level. */
  intoLevel: number;
  /** XP this level spans, always > 0 for any reachable level. */
  span: number;
  /** `intoLevel / span`, clamped to 0..1 — the fill of the level bar. */
  fraction: number;
  /** XP still required for the next level. */
  toNextLevel: number;
}

/** Everything the level card shows, derived in one pass from the total. */
export function describeLevel(totalXp: number): LevelState {
  const xp = Number.isFinite(totalXp) && totalXp > 0 ? totalXp : 0;
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  const span = Math.max(1, ceil - floor);
  const intoLevel = Math.max(0, xp - floor);
  return {
    level,
    name: levelName(level),
    totalXp: xp,
    intoLevel,
    span,
    fraction: Math.min(1, intoLevel / span),
    toNextLevel: Math.max(0, ceil - xp),
  };
}
