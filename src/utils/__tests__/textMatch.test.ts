import { describe, it, expect } from '@jest/globals';
import { normalizeQuranText, recallDiff, similarityPercent } from '@/utils/textMatch';

/**
 * Al-Fatihah, as the mushaf writes it: tashkeel, the waslah alef, the
 * superscript alef — none of which a phone keyboard can produce, and all of
 * which the memoriser types away.
 */
const BASMALAH = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
const AYAH_2 = 'ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَٰلَمِينَ';
const AYAH_3 = 'ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
const MALIK = 'مَٰلِكِ يَوْمِ ٱلدِّينِ';

/** What an Arabic keyboard would produce for those same ayahs. */
const PLAIN_BASMALAH = 'بسم الله الرحمن الرحيم';
const PLAIN_AYAH_2 = 'الحمد لله رب العالمين';
const PLAIN_MALIK = 'مالك يوم الدين';

describe('normalizeQuranText', () => {
  it('strips tashkeel and the marks a keyboard cannot produce', () => {
    expect(normalizeQuranText('إِيَّاكَ نَعْبُدُ')).toBe('اياك نعبد');
    expect(normalizeQuranText('قُلْ هُوَ ٱللَّهُ أَحَدٌ')).toBe('قل هو الله احد');
    expect(normalizeQuranText(BASMALAH)).toBe(PLAIN_BASMALAH);
  });

  it('folds the letter variants that differ only in orthography', () => {
    // ة folds onto ه — the same word written two ways.
    expect(normalizeQuranText('نِعْمَةِ ٱللَّهِ')).toBe('نعمه الله');
    expect(recallDiff('نِعْمَةُ ٱللَّهِ', 'نعمه الله').similarity).toBe(1);
  });

  it('keeps the word count — nothing may join or split words', () => {
    const before = BASMALAH.split(/\s+/).length;
    const after = normalizeQuranText(BASMALAH).split(' ').length;
    expect(after).toBe(before);
  });
});

describe('recallDiff', () => {
  it('reads an ayah recalled and typed with no tashkeel at all as perfect', () => {
    const diff = recallDiff(BASMALAH, PLAIN_BASMALAH);
    expect(diff.similarity).toBe(1);
    expect(diff.extra).toEqual([]);
    expect(diff.expected.every((segment) => segment.matched)).toBe(true);
  });

  /**
   * The superscript alef, both ways round. The mushaf writes it small — and
   * where modern spelling shows the alef full (العالمين, مالك) or hides it
   * (الرحمن), one edit apart is the same recall.
   */
  it('absorbs the alef the Uthmani text writes small and the keyboard writes full', () => {
    expect(recallDiff(AYAH_2, PLAIN_AYAH_2).similarity).toBe(1);
    expect(recallDiff(MALIK, PLAIN_MALIK).similarity).toBe(1);
  });

  it('carries the mushaf spelling through for display, tashkeel intact', () => {
    const diff = recallDiff(BASMALAH, PLAIN_BASMALAH);
    expect(diff.expected.map((segment) => segment.text)).toEqual([
      'بِسْمِ',
      'ٱللَّهِ',
      'ٱلرَّحْمَٰنِ',
      'ٱلرَّحِيمِ',
    ]);
  });

  it('flags the word that was dropped and holds nothing else against it', () => {
    // Three of four words survived — the classic lapse, one word gone.
    const diff = recallDiff(BASMALAH, 'بسم الله الرحيم');
    expect(
      diff.expected.filter((segment) => !segment.matched).map((segment) => segment.text),
    ).toEqual(['ٱلرَّحْمَٰنِ']);
    expect(diff.similarity).toBeCloseTo((2 * 3) / (4 + 3), 5);
  });

  it('collects words the attempt added that the mushaf does not have', () => {
    const diff = recallDiff(AYAH_3, 'الرحمن الرحيم الملك الكريم');
    expect(diff.extra).toEqual(['الملك', 'الكريم']);
    expect(diff.expected.every((segment) => segment.matched)).toBe(true);
  });

  it('scores an empty attempt as nothing recalled', () => {
    expect(recallDiff(AYAH_2, '').similarity).toBe(0);
  });

  it('treats two empty sides as vacuously matched', () => {
    expect(recallDiff('', '').similarity).toBe(1);
  });

  it('separates a flawless ayah, a slipped word and a half-forgotten one', () => {
    const full = recallDiff(AYAH_2, PLAIN_AYAH_2).similarity;
    const minusOne = recallDiff(AYAH_2, 'الحمد لله العالمين').similarity;
    const halfGone = recallDiff(AYAH_2, 'الحمد له العالمين').similarity;

    expect(full).toBe(1);
    expect(minusOne).toBeGreaterThan(halfGone);
    expect(halfGone).toBeLessThan(0.75);
  });
});

describe('similarityPercent', () => {
  it('rounds to the whole percent and stays inside the range', () => {
    expect(similarityPercent(0.926)).toBe(93);
    expect(similarityPercent(0)).toBe(0);
    expect(similarityPercent(1.4)).toBe(100);
    expect(similarityPercent(-2)).toBe(0);
  });
});
