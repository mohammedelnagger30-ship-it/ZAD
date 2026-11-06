/**
 * Unit tests for taskManager utility functions.
 * 
 * Note: These tests focus on pure/synchronous functions.
 * Async functions that interact with Dexie DB would require
 * mocking the database (see jest.config.js for setup).
 */
import { jest } from '@jest/globals';
import { describePortion, computeStreak } from '../taskManager';
import { formatDateKey } from '../dateUtils';
import type { DailyTask } from '@/db/database';

// Mock the surahs module
jest.mock('@/data/surahs', () => ({
  getSurah: (id: number) => {
    const surahs: Record<number, { name: string; ayahCount: number }> = {
      1: { name: 'الفاتحة', ayahCount: 7 },
      2: { name: 'البقرة', ayahCount: 286 },
      114: { name: 'الناس', ayahCount: 6 },
    };
    return surahs[id] || null;
  },
  getAyahsInJuz: jest.fn(),
  SURAHS: [],
  TOTAL_QURAN_PAGES: 604,
}));

// Mock the database
jest.mock('@/db/database', () => ({
  db: {
    plans: { toArray: jest.fn(), where: jest.fn() },
    tasks: { where: jest.fn(), add: jest.fn(), update: jest.fn(), get: jest.fn() },
    hifzProgress: { add: jest.fn() },
  },
}));

describe('taskManager', () => {
  describe('describePortion', () => {
    it('should describe a full surah', () => {
      expect(describePortion('surah:1')).toBe('سورة الفاتحة كاملة');
    });

    it('should describe a surah with ayah range', () => {
      expect(describePortion('surah:2:1-10')).toBe('سورة البقرة (آية 1-10)');
    });

    it('should describe a surah with single ayah', () => {
      expect(describePortion('surah:2:5')).toBe('سورة البقرة (آية 5)');
    });

    it('should describe a juz', () => {
      expect(describePortion('juz:1')).toBe('الجزء 1');
    });

    it('should describe a page', () => {
      expect(describePortion('page:50')).toBe('صفحة 50');
    });

    it('should return raw portion for unknown format', () => {
      expect(describePortion('custom:something')).toBe('custom:something');
    });

    it('should return raw portion for unknown surah', () => {
      expect(describePortion('surah:999')).toBe('surah:999');
    });
  });

  describe('computeStreak', () => {
    const NOW = new Date(2026, 2, 10, 15, 0, 0); // 2026-03-10, local time

    const dayKey = (daysAgo: number) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - daysAgo);
      return formatDateKey(d);
    };

    // The window getStreakCount loads: the last four days, newest first.
    const KEYS = [0, 1, 2, 3].map(dayKey);

    const task = (daysAgo: number, status: DailyTask['status']): DailyTask => ({
      planId: 1,
      date: dayKey(daysAgo),
      type: 'hifz',
      portion: 'surah:1',
      scheduledTime: '17:00',
      status,
      createdAt: 0,
    });

    const bucket = (...tasks: DailyTask[]) => {
      const byDate = new Map<string, DailyTask[]>();
      for (const t of tasks) {
        const list = byDate.get(t.date);
        if (list) list.push(t);
        else byDate.set(t.date, [t]);
      }
      return byDate;
    };

    it('counts the run ending yesterday while today is still in progress', () => {
      expect(computeStreak(bucket(task(0, 'pending'), task(1, 'done')), KEYS)).toBe(1);
    });

    it('counts today once every task is done', () => {
      expect(computeStreak(bucket(task(0, 'done'), task(1, 'done')), KEYS)).toBe(2);
    });

    it('an undone day older than yesterday ends the streak', () => {
      expect(
        computeStreak(bucket(task(0, 'done'), task(1, 'done'), task(2, 'pending')), KEYS),
      ).toBe(2);
    });

    it('a missed day ends the streak', () => {
      expect(
        computeStreak(bucket(task(0, 'done'), task(1, 'missed'), task(2, 'done')), KEYS),
      ).toBe(1);
    });

    it('a snoozed task counts as not done', () => {
      expect(computeStreak(bucket(task(0, 'done'), task(1, 'snoozed')), KEYS)).toBe(1);
    });

    it('rest days without tasks pass over instead of breaking the chain', () => {
      expect(computeStreak(bucket(task(0, 'done'), task(2, 'done')), KEYS)).toBe(2);
    });

    it('a day where only some tasks are done does not count', () => {
      // Yesterday is partial, so the chain breaks even though day-2 was complete.
      expect(
        computeStreak(
          bucket(task(0, 'pending'), task(1, 'done'), task(1, 'pending'), task(2, 'done')),
          KEYS,
        ),
      ).toBe(0);
    });

    it('no tasks at all is zero', () => {
      expect(computeStreak(new Map(), KEYS)).toBe(0);
    });
  });
});
