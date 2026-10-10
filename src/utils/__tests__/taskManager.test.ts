/**
 * Unit tests for taskManager utility functions.
 * 
 * Note: These tests focus on pure/synchronous functions.
 * Async functions that interact with Dexie DB would require
 * mocking the database (see jest.config.js for setup).
 */
import { jest } from '@jest/globals';
import { describePortion } from '../taskManager';

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
});
