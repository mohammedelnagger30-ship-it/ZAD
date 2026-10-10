import { describe, it, expect, beforeEach } from '@jest/globals';
import { searchAyahs, resetAyahSearchIndex } from '@/utils/ayahSearch';
import { getAyah } from '@/data/quranText';
import { stripTashkeel, normalizeArabic } from '@/utils/arabic';

/**
 * Ayah search invariants: matching is fold-tolerant (no harakat, alef
 * spelling, word order), what comes back is always the bundled original text
 * with tashkeel, and `total` counts beyond the display cap. Every expected
 * value is derived from the bundled Quran text itself.
 */

beforeEach(() => {
  resetAyahSearchIndex();
});

const FIRST_AYAH = getAyah(1, 1)!;

describe('searchAyahs', () => {
  it('is backed by the bundled text — every result returns its original', () => {
    const { results } = searchAyahs('الله', 20);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const source = getAyah(result.surahId, result.ayahNumber);
      expect(source).toBeDefined();
      expect(result.text).toBe(source!.text);
      expect(result.text).toContain('َ' ); // tashkeel preserved for display
    }
  });

  it('finds an ayah from a query typed without harakat', () => {
    const plain = stripTashkeel(FIRST_AYAH.text);
    const { results, total } = searchAyahs(plain);
    expect(total).toBeGreaterThan(0);
    expect(results.some((r) => r.surahId === 1 && r.ayahNumber === 1)).toBe(true);
  });

  it('does not care about the order of query words', () => {
    const terms = stripTashkeel(FIRST_AYAH.text)
      .split(/\s+/)
      .filter((t) => t.length > 1);
    const reversed = [...terms].reverse().join(' ');
    const { results } = searchAyahs(reversed);
    expect(results.some((r) => r.surahId === 1 && r.ayahNumber === 1)).toBe(true);
  });

  it('folds alef spellings so أ finds ا', () => {
    const plain = stripTashkeel(FIRST_AYAH.text);
    const withHamza = plain.replace(/ا/g, 'أ');
    const { results } = searchAyahs(withHamza);
    expect(results.some((r) => r.surahId === 1 && r.ayahNumber === 1)).toBe(true);
  });

  it('counts every match in total while capping the returned list', () => {
    const capped = searchAyahs('ال', 50);
    expect(capped.results).toHaveLength(50);
    expect(capped.total).toBeGreaterThan(50);

    const smaller = searchAyahs('ال', 3);
    expect(smaller.results).toHaveLength(3);
    expect(smaller.total).toBe(capped.total);
  });

  it('returns nothing for empty or single-letter queries', () => {
    expect(searchAyahs('')).toEqual({ results: [], total: 0 });
    expect(searchAyahs('   ')).toEqual({ results: [], total: 0 });
    expect(searchAyahs('ا')).toEqual({ results: [], total: 0 });
  });

  it('matches multiple terms together (AND semantics)', () => {
    const { results } = searchAyahs(normalizeArabic('الله الرحمن'));
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const folded = normalizeArabic(result.text);
      expect(folded).toContain('الله');
      expect(folded).toContain('الرحمن');
    }
  });
});
