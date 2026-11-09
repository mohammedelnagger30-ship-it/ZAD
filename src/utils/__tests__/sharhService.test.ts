import './jsdomPolyfills'; // must come first: contentStore builds a TextEncoder at load
import { describe, it, expect } from '@jest/globals';
import { findSharhId, foldForSharh, type SharhIndexItem } from '@/utils/sharhService';

/**
 * The explanation card decides whether a hadith *has* a match by looking for a
 * source title whole inside the matn, so a wrong answer here means an
 * explanation shown under the wrong hadith — the exact failure the project rule
 * forbids. What is asserted:
 *
 *   1. the fold erases every difference between the two publishers' spellings
 *      (tashkeel, punctuation, alef forms, ة/ه) — so a real match is found;
 *   2. the match has to sit on word boundaries — a title that only appears as
 *      part of a longer word is not this hadith;
 *   3. the longest matching title wins — a short generic title must not claim a
 *      hadith a more specific entry also covers;
 *   4. titles too short to discriminate are never used, whatever the text;
 *   5. no match is `null`, never a guess.
 */

const INDEX: SharhIndexItem[] = [
  { i: '66512', t: 'بني الإسلام على خمس' },
  { i: '66513', t: 'بني الإسلام' },
  { i: '100', t: 'الأعمال بالنيات' },
  { i: '200', t: 'الصلاة' }, // folded length 6 — below the minimum, ignored
  { i: '300', t: 'من أحدث في أمرنا هذا ما ليس منه فهو رد' },
];

describe('foldForSharh', () => {
  it('erases tashkeel, alef spelling, taa marbuta and punctuation', () => {
    expect(foldForSharh('الصَّلَاةِ')).toBe(foldForSharh('الصلاة'));
    expect(foldForSharh('إِنَّ اللَّهَ يَأْمُرُ')).toBe(foldForSharh('ان الله يامر'));
  });

  it('keeps word boundaries (spaces collapse to single spaces)', () => {
    expect(foldForSharh('  بُنِيَ   الإِسْلَامُ\tعَلَى  ')).toBe('بني لسلم علي');
  });

  it('drops digits and Latin text into spacing, not into letters', () => {
    expect(foldForSharh('حديث رقم 42')).toBe('حديث رقم');
  });
});

describe('findSharhId', () => {
  it('finds a tashkeel-heavy matn by a plain-spelled title', () => {
    const matn =
      'قَالَ رَسُولُ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ: «بُنِيَ الإِسْلَامُ عَلَى خَمْسٍ: شَهَادَةِ أَنْ لَا إلَهَ إلَّا اللَّهُ».';
    expect(findSharhId(matn, INDEX)).toBe('66512');
  });

  it('prefers the longest title that matches', () => {
    const nested: SharhIndexItem[] = [
      { i: 'long', t: 'من أحدث في أمرنا هذا ما ليس منه فهو رد' },
      { i: 'short', t: 'من أحدث في أمرنا هذا' },
    ];
    const matn = 'قال رسول الله: من أحدث في أمرنا هذا ما ليس منه فهو رد.';
    expect(findSharhId(matn, nested)).toBe('long');
  });

  it('matches a title written with different alef spellings', () => {
    const matn = 'إنّ الأعمال بالنيات، وإنّ لكل امرئٍ ما نوى.';
    expect(findSharhId(matn, INDEX)).toBe('100');
  });

  it('requires whole-word boundaries', () => {
    // The title letters run together inside one long word — not the same phrase.
    expect(findSharhId('زائدونيينقصمنياعمالبالنياتفقط', INDEX)).toBeNull();
  });

  it('ignores titles too short to discriminate, even when present', () => {
    expect(findSharhId('وذكر في الترغيب: الصلاة مفتاح الجنة.', INDEX)).toBeNull();
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(findSharhId('حدثنا فلانٍ عن غير هذا الحديث شيئًا آخر.', INDEX)).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(findSharhId('', INDEX)).toBeNull();
    expect(findSharhId('   \n ', INDEX)).toBeNull();
  });

  it('handles the full-length (surah-long) matn without splitting phrases', () => {
    const matn =
      'عَنْ أَبِي هُرَيْرَةَ رَضِيَ اللَّهُ عَنْهُ قَالَ: قَالَ رَسُولُ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ: مَنْ أَحْدَثَ فِي أَمْرِنَا هَذَا مَا لَيْسَ مِنْهُ فَهُوَ رَدٌّ.';
    expect(findSharhId(matn, INDEX)).toBe('300');
  });
});
