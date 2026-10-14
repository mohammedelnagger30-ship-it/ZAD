/**
 * Comparing what a memoriser typed against what the mushaf says — forgiving of
 * everything the mushaf itself never asks you to write.
 *
 * The hifz writing test asks for an ayah from memory on a keyboard that has no
 * tashkeel, no pause marks, and only one alef. Grading that attempt by exact
 * match would grade the keyboard rather than the memory: whoever types
 * «الرحمن» where the mushaf has «ٱلرَّحْمَٰنِ» has recalled the ayah perfectly
 * and knows it as well as anyone holding a mushaf does.
 *
 * So the comparison runs on a folded shape of each side — the marks stripped
 * and the letter variants that differ only in orthography brought onto one
 * shape — and the verdict is a *word-level* similarity. Word level, not
 * character level, because a hifz lapse is almost always a dropped or
 * transposed *word*: that is the thing worth measuring, and the thing worth
 * showing afterwards.
 */

/**
 * The marks a keyboard cannot reasonably be asked to reproduce, as inclusive
 * code-point ranges with a name for each band.
 *
 * Written as named ranges rather than one character class for two reasons.
 * Every entry here is a *combining* mark, and matching combining marks with
 * nothing under them — which is exactly what this needs to do, so the marks
 * can be removed — is what `no-misleading-character-class` exists to warn
 * about; building the pattern from ranges says so out loud instead of hiding
 * it in an eslint-disable. And it names what each band is: the harakat, the
 * recitation and pause signs, the annotation marks, tatweel, the end-of-ayah
 * and rub-el-hizb signs.
 */
const MARK_RANGES: ReadonlyArray<readonly [from: number, to: number, what: string]> = [
  [0x0610, 0x061a, 'Arabic small marks'],
  [0x0640, 0x0640, 'tatweel'],
  [0x064b, 0x065f, 'harakat and tanwin'],
  [0x0670, 0x0670, 'superscript alef'],
  [0x06d6, 0x06dc, 'Quranic annotation, small high'],
  [0x06dd, 0x06de, 'end of ayah, rub el hizb'],
  [0x06df, 0x06e4, 'Quranic annotation, small high'],
  [0x06e7, 0x06e8, 'small high yeh, small high noon'],
  [0x06ea, 0x06ed, 'Quranic annotation, small low'],
  [0x08d3, 0x08ff, 'Arabic Extended-A marks'],
];

const ORTHOGRAPHIC_MARKS = new RegExp(
  `[${MARK_RANGES.map(([from, to]) => `\\u${from.toString(16)}-\\u${to.toString(16)}`).join('')}]`,
  'g',
);

/**
 * One folded shape for the letters that differ only in how they are written.
 *
 * The alefs (أ إ آ ٱ) collapse to ا, ة to ه, final ى to ي, and the
 * hamza-bearing forms lose their hamza — a memoriser's typing of ؤ and ئ is
 * inconsistent across keyboards and Arabic input methods, and holding that
 * against recall would grade the keyboard again.
 *
 * The superscript alef is *stripped* by the marks above rather than folded up
 * into a full alef, because it is not always one: in ٱلْعَٰلَمِينَ it stands
 * for the alef of العالمين, but ٱلرَّحْمَٰنِ spells الرحمن without one. Both
 * sides end up on the shape an Arabic keyboard produces, and `sameWord` gives
 * back the one letter that differs when the typing keeps the alef the mushaf
 * abbreviated.
 */
function foldLetters(text: string): string {
  return text
    .replace(/[أإآٱٲٳ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ء/g, '');
}

/**
 * A comparison shape: marks gone, letters folded, punctuation and stray
 * symbols gone, whitespace collapsed. Word order and word count are preserved
 * — nothing here may join or split words, or the alignment downstream would
 * compare things that were never the same thing.
 */
export function normalizeQuranText(text: string): string {
  return foldLetters(text.replace(ORTHOGRAPHIC_MARKS, ''))
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RecallSegment {
  /** The mushaf's word as it is actually written — tashkeel intact, for display. */
  text: string;
  /** False when the attempt did not contain this word (in order). */
  matched: boolean;
}

export interface RecallDiff {
  /** The mushaf's words in order, each flagged by whether the attempt had it. */
  expected: RecallSegment[];
  /** Words the attempt contained that the mushaf does not — said out of place. */
  extra: string[];
  /**
   * 0–1 — Dice over the aligned words: twice the longest common subsequence
   * over the two word counts. One missing word out of fifteen lands near 0.93,
   * a slip of three near 0.8, half the ayah gone near 0.5.
   */
  similarity: number;
}

interface Word {
  /** As written, for showing it back. */
  raw: string;
  /** Folded, for aligning. */
  normalized: string;
}

/** Splits on whitespace and keeps only tokens that survive folding. */
function words(text: string): Word[] {
  const result: Word[] = [];
  for (const raw of text.split(/\s+/)) {
    const normalized = normalizeQuranText(raw);
    if (normalized !== '') result.push({ raw, normalized });
  }
  return result;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/**
 * Below this, a word is either right or wrong — no in between.
 *
 * Every word this long or longer gets one letter of grace, because that is the
 * width of the honest slip *and* of the one systematic difference the Uthmani
 * text keeps from the keyboard: the mushaf writes an alef small (مَٰلِكِ,
 * ٱلْعَٰلَمِينَ) or leaves it where modern spelling shows it (هَٰذَا), and one
 * edit is exactly that gap. Below three letters a single error turns the word
 * into a different word, so it is held to exactly.
 */
const FUZZY_MIN_LENGTH = 3;

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < FUZZY_MIN_LENGTH || b.length < FUZZY_MIN_LENGTH) return false;
  return levenshtein(a, b) <= 1;
}

/**
 * Aligns a written attempt against the mushaf's ayah.
 *
 * The alignment is a longest common subsequence over folded words — matched
 * leniently, one letter of grace on any real-sized word — walked back so each
 * mushaf word is either marked present or flagged as missed, and each word the
 * attempt added is collected separately. Both sides empty counts as a perfect
 * match (nothing was got wrong); an empty attempt against a real ayah is zero.
 */
export function recallDiff(expectedText: string, attemptText: string): RecallDiff {
  const expected = words(expectedText);
  const attempt = words(attemptText);

  if (expected.length === 0 && attempt.length === 0) {
    return { expected: [], extra: [], similarity: 1 };
  }
  if (expected.length === 0 || attempt.length === 0) {
    return {
      expected: expected.map((word) => ({ text: word.raw, matched: false })),
      extra: attempt.map((word) => word.raw),
      similarity: 0,
    };
  }

  // lcs[i][j] — the longest common subsequence of expected[i..] and attempt[j..].
  const lcs: number[][] = Array.from({ length: expected.length + 1 }, () =>
    new Array<number>(attempt.length + 1).fill(0),
  );
  for (let i = expected.length - 1; i >= 0; i -= 1) {
    for (let j = attempt.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = sameWord(expected[i].normalized, attempt[j].normalized)
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Walk the table forward, preferring to mark a miss over swallowing a word:
  // a lapsed memoriser who skipped a word should see *that* word flagged.
  const segments: RecallSegment[] = [];
  const extra: string[] = [];
  let i = 0;
  let j = 0;
  while (i < expected.length && j < attempt.length) {
    if (sameWord(expected[i].normalized, attempt[j].normalized)) {
      segments.push({ text: expected[i].raw, matched: true });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      segments.push({ text: expected[i].raw, matched: false });
      i += 1;
    } else {
      extra.push(attempt[j].raw);
      j += 1;
    }
  }
  while (i < expected.length) {
    segments.push({ text: expected[i].raw, matched: false });
    i += 1;
  }
  while (j < attempt.length) {
    extra.push(attempt[j].raw);
    j += 1;
  }

  const matched = lcs[0][0];
  const similarity = (2 * matched) / (expected.length + attempt.length);

  return { expected: segments, extra, similarity };
}

/** 0–1 → «٩٢٪», the figure the writing test shows as its verdict. */
export function similarityPercent(similarity: number): number {
  return Math.round(Math.min(1, Math.max(0, similarity)) * 100);
}
