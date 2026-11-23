import { describe, it, expect } from '@jest/globals';
import {
  XP_WEIGHTS,
  computeXp,
  xpBreakdown,
  xpForLevel,
  levelFromXp,
  levelName,
  describeLevel,
} from '@/utils/gamification';
import type { BadgeMetrics } from '@/utils/badgeProgress';

const empty: BadgeMetrics = {
  streak: 0,
  memorizedAyahs: 0,
  completedTasks: 0,
  ontimePrayers: 0,
  completedKhatmahs: 0,
  adhkarDays: 0,
};

const sample: BadgeMetrics = {
  streak: 7,
  memorizedAyahs: 120,
  completedTasks: 40,
  ontimePrayers: 90,
  completedKhatmahs: 1,
  adhkarDays: 12,
};

describe('computeXp', () => {
  it('awards nothing on an empty record', () => {
    expect(computeXp(empty)).toBe(0);
  });

  it('weights every source as declared', () => {
    expect(computeXp(sample)).toBe(
      7 * XP_WEIGHTS.streakDay
      + 120 * XP_WEIGHTS.memorizedAyah
      + 40 * XP_WEIGHTS.completedTask
      + 90 * XP_WEIGHTS.ontimePrayer
      + 1 * XP_WEIGHTS.completedKhatmah
      + 12 * XP_WEIGHTS.adhkarDay,
    );
    // 175 + 1200 + 320 + 450 + 1000 + 180 = 3325
    expect(computeXp(sample)).toBe(3325);
  });

  it('is monotone in every metric', () => {
    const base = computeXp(sample);
    expect(computeXp({ ...sample, streak: 8 })).toBeGreaterThan(base);
    expect(computeXp({ ...sample, memorizedAyahs: 121 })).toBeGreaterThan(base);
    expect(computeXp({ ...sample, completedTasks: 41 })).toBeGreaterThan(base);
    expect(computeXp({ ...sample, ontimePrayers: 91 })).toBeGreaterThan(base);
    expect(computeXp({ ...sample, completedKhatmahs: 2 })).toBeGreaterThan(base);
    expect(computeXp({ ...sample, adhkarDays: 13 })).toBeGreaterThan(base);
  });
});

describe('xpBreakdown', () => {
  it('sums back to the total', () => {
    const lines = xpBreakdown(sample);
    expect(lines.reduce((sum, line) => sum + line.xp, 0)).toBe(computeXp(sample));
  });

  it('drops sources at zero and sorts by contribution', () => {
    const lines = xpBreakdown({ ...empty, completedTasks: 3, ontimePrayers: 20 });
    expect(lines.map((line) => line.source)).toEqual(['ontimePrayer', 'completedTask']);
    expect(lines[0]).toMatchObject({ count: 20, xp: 100 });
    expect(lines[1]).toMatchObject({ count: 3, xp: 24 });
  });

  it('is empty on an empty record', () => {
    expect(xpBreakdown(empty)).toEqual([]);
  });
});

describe('level curve', () => {
  it('places the documented thresholds', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(399)).toBe(2);
    expect(levelFromXp(400)).toBe(3);
    expect(levelFromXp(900)).toBe(4);
    expect(levelFromXp(1600)).toBe(5);
  });

  it('keeps xpForLevel and levelFromXp inverses at every boundary', () => {
    for (let level = 1; level <= 30; level++) {
      const floor = xpForLevel(level);
      expect(levelFromXp(floor)).toBe(level);
      expect(levelFromXp(floor + 1)).toBe(level);
      // The last XP of a level stays in it; the next one does not.
      if (level < 30) {
        expect(levelFromXp(xpForLevel(level + 1) - 1)).toBe(level);
      }
    }
  });

  it('is monotone: more XP never means a lower level', () => {
    let previous = 1;
    for (let xp = 0; xp <= 50_000; xp += 137) {
      const level = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('treats nonsense XP as nothing earned', () => {
    expect(levelFromXp(-5)).toBe(1);
    expect(levelFromXp(Number.NaN)).toBe(1);
    expect(levelFromXp(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('levelName', () => {
  it('holds the tier at each named rung', () => {
    expect(levelName(1)).toBe('مبتدئ');
    expect(levelName(2)).toBe('مبتدئ');
    expect(levelName(3)).toBe('قارئ');
    expect(levelName(5)).toBe('حافظ');
    expect(levelName(8)).toBe('مُتقن');
    expect(levelName(11)).toBe('مرسِل');
    expect(levelName(15)).toBe('خازِن القرآن');
    expect(levelName(99)).toBe('خازِن القرآن');
  });
});

describe('describeLevel', () => {
  it('reports level 1 with nothing earned', () => {
    expect(describeLevel(0)).toMatchObject({
      level: 1,
      name: 'مبتدئ',
      totalXp: 0,
      intoLevel: 0,
      span: 100,
      fraction: 0,
      toNextLevel: 100,
    });
  });

  it('measures progress inside the current level', () => {
    // 3105 XP: floor(√31.05)=5 → level 6 (floor 2500, ceil 3600 → span 1100).
    const state = describeLevel(3105);
    expect(state.level).toBe(6);
    expect(state.intoLevel).toBe(605);
    expect(state.span).toBe(1100);
    expect(state.fraction).toBeCloseTo(605 / 1100, 10);
    expect(state.toNextLevel).toBe(495);
  });

  it('pins the fill between 0 and 1 for any XP', () => {
    for (let xp = 0; xp <= 100_000; xp += 613) {
      const state = describeLevel(xp);
      expect(state.fraction).toBeGreaterThanOrEqual(0);
      expect(state.fraction).toBeLessThanOrEqual(1);
      expect(state.span).toBeGreaterThan(0);
      expect(state.toNextLevel).toBeGreaterThanOrEqual(0);
    }
  });

  it('clamps nonsense totals instead of propagating them', () => {
    expect(describeLevel(Number.NaN).totalXp).toBe(0);
    expect(describeLevel(-100).totalXp).toBe(0);
  });
});
