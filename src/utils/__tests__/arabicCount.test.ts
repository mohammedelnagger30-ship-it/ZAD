import { describe, it, expect } from '@jest/globals';
import { arabicCount, countNoun, type ArabicCountForms } from '@/utils/arabicCount';

const SURAH: ArabicCountForms = { one: 'سورة', two: 'سورتان', few: 'سور', many: 'سورة' };

describe('arabicCount', () => {
  it('gives the form Arabic counts with', () => {
    expect(arabicCount(1, SURAH)).toBe('سورة');
    expect(arabicCount(2, SURAH)).toBe('سورتان');
    expect(arabicCount(3, SURAH)).toBe('سور');
    expect(arabicCount(10, SURAH)).toBe('سور');
    // Past ten the noun returns to the singular: «١١ سورة», never «١١ سور».
    expect(arabicCount(11, SURAH)).toBe('سورة');
    expect(arabicCount(12, SURAH)).toBe('سورة');
    // The range is read on the whole number. The last-two-digits version —
    // tempting, because it resembles the compound rule — would make «١٠٠٠٣
    // سور» out of ten thousand and three, so 103 and 1003 both take the
    // singular alongside 11.
    expect(arabicCount(103, SURAH)).toBe('سورة');
    expect(arabicCount(111, SURAH)).toBe('سورة');
    expect(arabicCount(1003, SURAH)).toBe('سورة');
  });

  it('takes the plural for zero, as «صفر سور» does', () => {
    expect(arabicCount(0, SURAH)).toBe('سور');
  });
});

describe('countNoun', () => {
  it('sets no numeral beside a form that already carries the count', () => {
    // «سورة» and «سورتان» say it by themselves; «٢ سورتان» is the mistake.
    expect(countNoun(1, SURAH)).toBe('سورة');
    expect(countNoun(2, SURAH)).toBe('سورتان');
  });

  it('sets the numeral from three on', () => {
    expect(countNoun(3, SURAH)).toBe('٣ سور');
    expect(countNoun(10, SURAH)).toBe('١٠ سور');
    expect(countNoun(11, SURAH)).toBe('١١ سورة');
  });
});
