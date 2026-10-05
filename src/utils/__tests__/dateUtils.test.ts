import {
  formatDateKey,
  getDayName,
  getDayNameShort,
  formatArabicDate,
  getDaysInMonth,
  isSameDay,
  addDays,
} from '../dateUtils';

describe('dateUtils', () => {
  describe('formatDateKey', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date(2024, 0, 5); // Jan 5, 2024
      expect(formatDateKey(date)).toBe('2024-01-05');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date(2024, 2, 3); // Mar 3, 2024
      expect(formatDateKey(date)).toBe('2024-03-03');
    });

    it('should handle double-digit months and days', () => {
      const date = new Date(2024, 11, 25); // Dec 25, 2024
      expect(formatDateKey(date)).toBe('2024-12-25');
    });
  });

  describe('getDayName', () => {
    it('should return Arabic day name for Sunday (0)', () => {
      const sunday = new Date(2024, 0, 7); // Sunday
      expect(getDayName(sunday)).toBe('الأحد');
    });

    it('should return Arabic day name for Friday (5)', () => {
      const friday = new Date(2024, 0, 5); // Friday
      expect(getDayName(friday)).toBe('الجمعة');
    });
  });

  describe('getDayNameShort', () => {
    it('should return short Arabic day name', () => {
      expect(getDayNameShort(0)).toBe('أحد');
      expect(getDayNameShort(5)).toBe('جمعة');
      expect(getDayNameShort(6)).toBe('سبت');
    });

    it('should return empty string for invalid day number', () => {
      expect(getDayNameShort(7)).toBe('');
      expect(getDayNameShort(-1)).toBe('');
    });
  });

  describe('formatArabicDate', () => {
    it('should format date in Arabic', () => {
      const date = new Date(2024, 0, 15); // Jan 15, 2024
      expect(formatArabicDate(date)).toBe('15 يناير 2024');
    });

    it('should handle December', () => {
      const date = new Date(2024, 11, 1);
      expect(formatArabicDate(date)).toBe('1 ديسمبر 2024');
    });
  });

  describe('getDaysInMonth', () => {
    it('should return 31 for January', () => {
      expect(getDaysInMonth(2024, 0)).toBe(31);
    });

    it('should return 29 for February in a leap year', () => {
      expect(getDaysInMonth(2024, 1)).toBe(29);
    });

    it('should return 28 for February in a non-leap year', () => {
      expect(getDaysInMonth(2023, 1)).toBe(28);
    });

    it('should return 30 for April', () => {
      expect(getDaysInMonth(2024, 3)).toBe(30);
    });
  });

  describe('isSameDay', () => {
    it('should return true for same date', () => {
      const d1 = new Date(2024, 0, 15, 10, 30);
      const d2 = new Date(2024, 0, 15, 22, 45);
      expect(isSameDay(d1, d2)).toBe(true);
    });

    it('should return false for different dates', () => {
      const d1 = new Date(2024, 0, 15);
      const d2 = new Date(2024, 0, 16);
      expect(isSameDay(d1, d2)).toBe(false);
    });

    it('should return false for different months', () => {
      const d1 = new Date(2024, 0, 15);
      const d2 = new Date(2024, 1, 15);
      expect(isSameDay(d1, d2)).toBe(false);
    });
  });

  describe('addDays', () => {
    it('should add positive days', () => {
      const date = new Date(2024, 0, 15);
      const result = addDays(date, 5);
      expect(result.getDate()).toBe(20);
      expect(result.getMonth()).toBe(0);
    });

    it('should subtract days with negative value', () => {
      const date = new Date(2024, 0, 15);
      const result = addDays(date, -5);
      expect(result.getDate()).toBe(10);
    });

    it('should cross month boundary', () => {
      const date = new Date(2024, 0, 30);
      const result = addDays(date, 3);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(2);
    });

    it('should not mutate original date', () => {
      const date = new Date(2024, 0, 15);
      const original = date.getTime();
      addDays(date, 10);
      expect(date.getTime()).toBe(original);
    });
  });
});
