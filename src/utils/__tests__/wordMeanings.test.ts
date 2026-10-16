import './jsdomPolyfills'; // must come first: contentStore builds a TextEncoder at load
import { describe, it, expect } from '@jest/globals';
import { alignAyahMeanings } from '@/utils/wordMeaningsService';
import { foldForMatch } from '@/utils/arabic';
import { normalizeQuranText } from '@/utils/textMatch';
import { getAyah } from '@/data/quranText';
import { splitBasmala } from '@/utils/basmala';

/**
 * Gloss alignment is the one place where a wrong answer means a meaning shown under
 * the wrong word — so what is asserted here is the *shape* of the safety rules:
 *
 *   1. a gloss is shown only when its folded text is found inside the ayah, in order;
 *   2. the two spellings (Tanzil Uthmani vs the books' plain spelling) differ only in
 *      ways `foldForMatch` erases;
 *   3. a fragment that fits neither the word-run pass nor the substring pass is not
 *      shown at all;
 *   4. word positions are counted on what the reader actually displays — the basmala
 *      lifted out of ayah 1 included.
 *
 * Ayah text and word lists are read from the bundled Quran text rather than typed here,
 * so the fixtures can never drift from the data they describe.
 */

interface StoredAyah {
  ayah: number;
  meanings: Array<{ book: number; words: Array<{ text: string; meaning: string }> }>;
}

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

function ayahText(surah: number, ayah: number): string {
  const text = getAyah(surah, ayah)?.text;
  if (!text) throw new Error(`missing ayah ${surah}:${ayah}`);
  return text;
}

/** The words the reader hands positions out for: basmala lifted, whitespace split. */
function shownWords(surah: number, ayah: number): string[] {
  const text = ayahText(surah, ayah);
  const { rest } = splitBasmala(text);
  return wordsOf(rest || text);
}

const book = (
  id: number,
  words: Array<{ text: string; meaning: string }>,
): StoredAyah['meanings'][number] => ({ book: id, words });

describe('foldForMatch', () => {
  it('erases tashkeel and the Quranic annotation signs', () => {
    expect(foldForMatch('مَلِكِ يَوْمِ ٱلدِّينِ')).toBe(foldForMatch('ملك يوم الدين'));
    expect(foldForMatch('')).toBe('');
  });

  it('deletes every alef form, which is how the two publishers disagree most', () => {
    // Tanzil writes alef wasla and dagger alef; the books print a plain spelling.
    expect(foldForMatch('ٱلرَّحْمَٰنِ')).toBe(foldForMatch('الرحمن'));
    expect(foldForMatch('ٱلْعَٰلَمِينَ')).toBe(foldForMatch('العالمين'));
  });

  it('folds ى onto ي and ة onto ه', () => {
    expect(foldForMatch('على')).toBe(foldForMatch('علي'));
    // 'ملة' vs 'مله' — written as escapes so the taa marbuta cannot be mistyped for a teh.
    expect(foldForMatch('م\u0644\u0629')).toBe(foldForMatch('م\u0644\u0647'));
  });
});

describe('alignAyahMeanings', () => {
  it('reports every word a multi-word gloss covers, with its book', () => {
    const text = ayahText(1, 2);
    const words = shownWords(1, 2);
    expect(words.length).toBeGreaterThanOrEqual(4);

    const stored: StoredAyah = {
      ayah: 2,
      meanings: [book(491, [{ text: `${words[2]} ${words[3]}`, meaning: 'MEANING-A' }])],
    };
    const hits = alignAyahMeanings(text, stored);

    expect(hits.map((h) => h.wordIndex)).toEqual([2, 3]);
    expect(hits.every((h) => h.book === 491)).toBe(true);
    expect(hits.every((h) => h.gloss.meaning === 'MEANING-A')).toBe(true);
  });

  it('locates a gloss spelled the plain way the books spell it', () => {
    const text = ayahText(1, 2);
    const words = shownWords(1, 2);
    const plain = normalizeQuranText(`${words[2]} ${words[3]}`);
    expect(plain).not.toBe(`${words[2]} ${words[3]}`); // the fixture really differs

    const stored: StoredAyah = { ayah: 2, meanings: [book(491, [{ text: plain, meaning: 'MEANING-B' }])] };
    expect(alignAyahMeanings(text, stored).map((h) => h.wordIndex)).toEqual([2, 3]);
  });

  it('falls back to the substring pass when the book drops a prefixed conjunction', () => {
    // 10:5 — the book writes "قدّره منازل" where the Uthmani text has "وَقَدَّرَهُۥ مَنَازِلَ".
    // No single folded word equals "قدره", so only the substring pass can find it, and
    // it must cover both words it overlaps — not just the one it starts inside.
    // (fold deletes alefs, so the folded form of "منازل" is compared against itself.)
    const text = ayahText(10, 5);
    const words = shownWords(10, 5);
    const i = words.findIndex(
      (word, k) =>
        foldForMatch(word).startsWith('وقدره') &&
        foldForMatch(words[k + 1] ?? '') === foldForMatch('منازل'),
    );
    expect(i).toBeGreaterThanOrEqual(0);

    const fragment = `${words[i].slice(1)} ${words[i + 1]}`;
    const stored: StoredAyah = { ayah: 5, meanings: [book(1424, [{ text: fragment, meaning: 'MEANING-C' }])] };
    const hits = alignAyahMeanings(text, stored);

    expect(hits.map((h) => h.wordIndex)).toEqual([i, i + 1]);
    expect(hits.every((h) => h.gloss.meaning === 'MEANING-C')).toBe(true);
  });

  it('counts word positions after the basmala is lifted, and never matches into it', () => {
    const text = ayahText(113, 1);
    const { basmala, rest } = splitBasmala(text);
    expect(basmala).not.toBeNull();
    expect(rest.length).toBeGreaterThan(0);

    // A gloss taken from the basmala belongs to no displayed word here.
    const basmalaWord = wordsOf(basmala!)[0];
    expect(basmalaWord).toBeTruthy();
    const inBasmala: StoredAyah = { ayah: 1, meanings: [book(491, [{ text: basmalaWord, meaning: 'X' }])] };
    expect(alignAyahMeanings(text, inBasmala)).toEqual([]);

    // The first word the reader shows is index 0 of what is left.
    const first = wordsOf(rest)[0];
    const firstGloss: StoredAyah = { ayah: 1, meanings: [book(491, [{ text: first, meaning: 'Y' }])] };
    expect(alignAyahMeanings(text, firstGloss).map((h) => h.wordIndex)).toEqual([0]);
  });

  it('shows nothing for a fragment the ayah does not contain', () => {
    const text = ayahText(1, 2);
    const stored: StoredAyah = {
      ayah: 2,
      meanings: [book(491, [{ text: 'xyz abc', meaning: 'NOT-A-MEANING' }])],
    };
    expect(alignAyahMeanings(text, stored)).toEqual([]);
    expect(alignAyahMeanings(text, null)).toEqual([]);
    expect(alignAyahMeanings('', { ayah: 2, meanings: [] })).toEqual([]);
  });

  it('answers only for the book that was asked about', () => {
    const text = ayahText(1, 2);
    const words = shownWords(1, 2);
    const stored: StoredAyah = {
      ayah: 2,
      meanings: [
        book(491, [{ text: words[3], meaning: 'FROM-491' }]),
        book(208, [{ text: words[3], meaning: 'FROM-208' }]),
      ],
    };

    const only491 = alignAyahMeanings(text, stored, 491);
    expect(only491.map((h) => h.book)).toEqual([491]);
    expect(only491.map((h) => h.gloss.meaning)).toEqual(['FROM-491']);

    expect(alignAyahMeanings(text, stored, 9999)).toEqual([]);
    // Unfiltered, both books answer for the same word, ordered by word then book.
    expect(alignAyahMeanings(text, stored).map((h) => h.book)).toEqual([208, 491]);
  });

  it('consumes fragments in text order so a repeated word resolves forward', () => {
    // 2:255 — a book whose fragments arrive in reading order must not send the second
    // one back to the first occurrence of a word.
    const text = ayahText(2, 255);
    const words = shownWords(2, 255);
    expect(words.length).toBeGreaterThan(5);

    const first = words[0];
    const last = words[words.length - 1];
    const stored: StoredAyah = {
      ayah: 255,
      meanings: [book(491, [{ text: first, meaning: 'FIRST' }, { text: last, meaning: 'LAST' }])],
    };
    const hits = alignAyahMeanings(text, stored);

    expect(hits.map((h) => h.wordIndex)).toEqual([0, words.length - 1]);
    expect(hits.map((h) => h.gloss.meaning)).toEqual(['FIRST', 'LAST']);
  });
});
