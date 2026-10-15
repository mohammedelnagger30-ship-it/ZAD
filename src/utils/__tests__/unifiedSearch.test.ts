/**
 * The unified search reaches `contentStore` through the hadith and tafsir
 * services, and that module builds a `TextEncoder` at import time — a Node
 * global jsdom does not install. Installed before everything else, for the
 * same reason `quranAudio.test.ts` does it: ESM evaluates dependencies in
 * declaration order, so the polyfill is in place before the store is read.
 */
import './jsdomPolyfills';

/**
 * A unified search is only worth having if it is honest about the four things
 * it joins, so the tests here are about the joins rather than the corpora:
 *
 *   * the excerpt has to carry the word that was searched for — a list that
 *     shows the first three lines of an eighty-line hadith and hides the match
 *     is a search that returned nothing and reported success;
 *   * the adhkar pass must tolerate the words arriving in any order, because
 *     the ayah and hadith passes already do, and four sources with four
 *     matching rules is not one search;
 *   * the merge order is written down rather than derived, so a card cannot
 *     move under a reader between two renders.
 */
import { describe, it, expect } from '@jest/globals';
import { ADHKAR_CATEGORIES } from '@/data/adhkar';
import { normalizeArabic } from '@/utils/arabic';
import {
  PER_SOURCE_LIMIT,
  excerptAroundMatch,
  mergeUnifiedResults,
  searchAdhkarFor,
  type UnifiedResult,
  type UnifiedSource,
} from '@/utils/unifiedSearch';

const FILLER = 'وكان الناس يفعلون ما يفعلون وليست القصة في ذلك البتة ';
const anchorWord = 'ٱلصَّابِرِينَ';

describe('excerptAroundMatch', () => {
  it('leaves a short text alone', () => {
    expect(excerptAroundMatch('آية قصيرة', ['قصيرة'])).toBe('آية قصيرة');
  });

  it('keeps the searched word, even written the other way round', () => {
    // The caller searched without tashkeel and without the alef hamza below;
    // the excerpt has to hand back the original spelling intact.
    const long = FILLER.repeat(10) + `إن ${anchorWord} ممن يؤجرهم الله. ` + FILLER.repeat(10);
    const excerpt = excerptAroundMatch(long, ['الصابرين']);

    expect(long.length).toBeGreaterThan(240);
    expect(excerpt).toContain(anchorWord);
    expect(normalizeArabic(excerpt)).toContain('الصابرين');
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('opens without an ellipsis when the match is already at the front', () => {
    const long = `${anchorWord} أول ما يُقال ثم ${FILLER.repeat(8)}`;
    const excerpt = excerptAroundMatch(long, ['الصابرين']);

    expect(excerpt.startsWith('…')).toBe(false);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain(anchorWord);
  });

  /** A half-word at the opening edge reads as a typo, not as an omission. */
  it('never opens in the middle of a word', () => {
    const long = FILLER.repeat(4) + `و${anchorWord} يقول الله. ` + FILLER.repeat(8);
    const excerpt = excerptAroundMatch(long, ['الصابرين']);
    const body = excerpt.replace(/^…/, '').replace(/…$/, '');
    const at = long.indexOf(body);

    expect(at).toBeGreaterThan(0);
    if (excerpt.startsWith('…')) expect(/\s/.test(long[at - 1])).toBe(true);
  });

  it('falls back to the opening when nothing anchors it', () => {
    const long = `${FILLER.repeat(10)} تحتمل نهاية `;
    const excerpt = excerptAroundMatch(long, []);

    expect(excerpt.startsWith('…')).toBe(false);
    expect(long.startsWith(excerpt.replace(/…$/, ''))).toBe(true);
  });
});

describe('searchAdhkarFor', () => {
  const dhikr = ADHKAR_CATEGORIES[0].items[0];
  const categoryId = ADHKAR_CATEGORIES[0].id;
  const words = dhikr.text
    .split(/\s+/)
    .filter((word) => normalizeArabic(word).length > 1)
    .slice(0, 4)
    .join(' ');

  it('finds a dhikr the app itself ships with', () => {
    const results = searchAdhkarFor(words, PER_SOURCE_LIMIT);

    expect(results.length).toBeGreaterThan(0);
    expect(results.map((result) => result.key)).toContain(
      `adhkar:${categoryId}:${dhikr.id}`,
    );
  });

  it('names the category and points at it', () => {
    const result = searchAdhkarFor(words, PER_SOURCE_LIMIT).find(
      (candidate) => candidate.key === `adhkar:${categoryId}:${dhikr.id}`,
    );

    expect(result).toBeDefined();
    expect(result?.reference).toBe(ADHKAR_CATEGORIES[0].title);
    expect(result?.target).toEqual({ screen: 'adhkar', params: { categoryId } });
  });

  /** The ayah and hadith passes ignore word order; this one must too. */
  it('cares nothing for the order the words arrive in', () => {
    const reversed = words.split(' ').reverse().join(' ');

    expect(searchAdhkarFor(reversed, PER_SOURCE_LIMIT)).toEqual(
      searchAdhkarFor(words, PER_SOURCE_LIMIT),
    );
  });

  it('stops at the limit instead of returning everything', () => {
    expect(searchAdhkarFor(words, 1)).toHaveLength(1);
  });

  it('answers nothing for a query too short to mean anything', () => {
    expect(searchAdhkarFor('ا', PER_SOURCE_LIMIT)).toEqual([]);
    expect(searchAdhkarFor('   ', PER_SOURCE_LIMIT)).toEqual([]);
  });
});

describe('mergeUnifiedResults', () => {
  const result = (source: UnifiedSource, index: number): UnifiedResult => ({
    key: `${source}:${index}`,
    source,
    text: `نص ${index}`,
    reference: `مرجع ${index}`,
  });
  const sections = (sources: UnifiedSource[]): Partial<Record<UnifiedSource, UnifiedResult[]>> => {
    const out: Partial<Record<UnifiedSource, UnifiedResult[]>> = {};
    for (const source of sources) out[source] = [result(source, 0), result(source, 1)];
    return out;
  };

  it('lays the sources out in the order written down, not the order given', () => {
    const merged = mergeUnifiedResults(
      sections(['tafsir', 'adhkar', 'hadith', 'quran']),
      PER_SOURCE_LIMIT,
    );

    // Two results per source: contiguous blocks, in the written order, with
    // nothing from one source slipping into the middle of another's.
    expect(merged.map((item) => item.source)).toEqual([
      'quran', 'quran',
      'hadith', 'hadith',
      'adhkar', 'adhkar',
      'tafsir', 'tafsir',
    ]);
  });

  it('caps each source without letting one crowd out the rest', () => {
    const merged = mergeUnifiedResults(
      {
        quran: Array.from({ length: 10 }, (_, index) => result('quran', index)),
        hadith: Array.from({ length: 10 }, (_, index) => result('hadith', index)),
      },
      2,
    );

    expect(merged).toHaveLength(4);
    expect(merged.filter((item) => item.source === 'quran')).toHaveLength(2);
    expect(merged.filter((item) => item.source === 'hadith')).toHaveLength(2);
  });

  it('is silent about the sources that have not answered yet', () => {
    const merged = mergeUnifiedResults({ quran: [result('quran', 0)] }, PER_SOURCE_LIMIT);

    expect(merged.map((item) => item.source)).toEqual(['quran']);
    expect(mergeUnifiedResults({}, PER_SOURCE_LIMIT)).toEqual([]);
  });
});
