import { describe, it, expect } from '@jest/globals';
import { buildBookmarksExport } from '@/utils/bookmarkExport';
import { toArabicNumber } from '@/data/surahs';

/**
 * The whole collection, as one block of text that can leave the app. What is
 * checked here is what a pasted list has to get right to be worth pasting: the
 * mushaf's spelling kept, the grouping and the order matching the screen, and
 * the counts said the way Arabic says them.
 */

/** n ayahs of الفاتحة, numbered 1..n. */
function ayahs(n: number) {
  return Array.from({ length: n }, (_, index) => ({ surahId: 1, ayahNumber: index + 1 }));
}

describe('buildBookmarksExport', () => {
  it('has nothing to say for an empty collection', () => {
    expect(buildBookmarksExport([], [])).toBe('');
  });

  it('names the surah and keeps the mushaf spelling of the ayah', () => {
    const result = buildBookmarksExport(
      [{ surahId: 1, ayahNumber: 1, text: 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ' }],
      [],
    );
    expect(result).toContain('محفوظاتي — قُرّة');
    expect(result).toContain('سورة الفاتحة');
    expect(result).toContain('﴿بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ﴾');
    expect(result).toContain('الآية');
  });

  it('groups by surah and orders each group by ayah, whatever order it was handed', () => {
    const result = buildBookmarksExport(
      [
        { surahId: 2, ayahNumber: 5, text: 'خامسة' },
        { surahId: 1, ayahNumber: 7, text: 'سابعة' },
        { surahId: 2, ayahNumber: 2, text: 'ثانية' },
      ],
      [],
    );
    const quoted = result.split('\n').filter((line) => line.includes('﴿'));
    // الفاتحة before البقرة, and inside البقرة the earlier ayah first.
    expect(quoted[0]).toContain('سابعة');
    expect(quoted[1]).toContain('ثانية');
    expect(quoted[2]).toContain('خامسة');
  });

  it('still gives a line for an ayah the app has no text for', () => {
    const result = buildBookmarksExport([{ surahId: 1, ayahNumber: 3 }], []);
    expect(result).toContain('الآية');
    expect(result).not.toContain('﴿');
  });

  /**
   * Arabic counts a noun one, two, then the plural for three to ten, and the
   * singular again from eleven on — «١١ آية», never «١١ آيات».
   */
  it('counts the way Arabic counts', () => {
    const countLine = (n: number) => buildBookmarksExport(ayahs(n), []).split('\n')[2];

    expect(countLine(1).endsWith('آية')).toBe(true);
    expect(countLine(2).endsWith('آيتان')).toBe(true);
    expect(countLine(3).endsWith('آيات')).toBe(true);
    expect(countLine(10).endsWith('آيات')).toBe(true);
    expect(countLine(11).endsWith('آية')).toBe(true);
    expect(countLine(12).endsWith('آية')).toBe(true);
  });

  it('lists the pages, sorted, in Arabic numerals', () => {
    const result = buildBookmarksExport([], [602, 601, 603]);
    const lines = result.split('\n');
    expect(lines[2]).toContain('صفحات محفوظة');
    const pagesLine = lines[lines.length - 1];
    expect(pagesLine.indexOf(toArabicNumber(601))).toBeLessThan(
      pagesLine.indexOf(toArabicNumber(602)),
    );
    expect(pagesLine.indexOf(toArabicNumber(602))).toBeLessThan(
      pagesLine.indexOf(toArabicNumber(603)),
    );
  });

  it('exports the pages on their own when there are no ayahs', () => {
    const result = buildBookmarksExport([], [601]);
    expect(result).toContain('محفوظاتي — قُرّة');
    expect(result).toContain('صفحة محفوظة');
    expect(result).not.toContain('سورة');
  });
});
