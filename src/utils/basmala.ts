// Splitting the basmala out of ayah 1.
//
// Tanzil's Uthmani text stores the basmala *inside* the string of ayah 1 of every surah
// except At-Tawbah (surah 9, which genuinely has none). Two consequences for the reader:
//
//  1. Printing a separate hard-coded basmala on every surah-start page duplicates it —
//     the reader used to show "بسم الله..." twice on all 114 surah openings.
//  2. A mushaf prints the basmala centred on its own line above ayah 1, so it has to be
//     lifted out of ayah 1 rather than left to flow inline with it.
//
// Matching is done on a *skeleton* — the text with every combining mark removed — instead
// of comparing Arabic strings. Reason, measured: the same two marks appear in two
// different orders in the source, so any literal `startsWith` silently fails on some
// surahs. Surah 95 and 97 ship `U+0651 U+0650` (shadda then kasra) where the other 111
// ship `U+0650 U+0651`; the skeleton has neither problem because letters have no
// canonical-order ambiguity. See scripts/check-content.ts for the invariants.

/** Combining marks, tatweel and Quranic annotation signs — dropped when matching. */
function isMark(cp: number): boolean {
  return (
    (cp >= 0x0610 && cp <= 0x061a) || // Arabic punctuation / signs
    (cp >= 0x064b && cp <= 0x065f) || // harakat, shadda, sukun, Quranic annotation marks
    (cp >= 0x06d6 && cp <= 0x06ed) || // sajdah and small high letter marks
    (cp >= 0x08d3 && cp <= 0x08ff) || // Arabic Extended-A marks
    cp === 0x0640 || // tatweel
    cp === 0x0670 // superscript (dagger) alef
  );
}

/**
 * Alef variants folded to their base letter.
 *
 * The Uthmani text writes the basmala with alef wasla (U+0671), not a plain alef, so a
 * skeleton that keeps them distinct can never match a plain-alef target. U+0671 is
 * canonically equivalent to U+0627; the others are the ordinary calligraphic variants.
 * Folding happens on the skeleton only — `originIndex` still points into the original
 * string, so the cut keeps every diacritic and every alef variant exactly as authored.
 */
const ALEF_VARIANTS: Record<string, string> = {
  '\u0671': '\u0627', // alef wasla
  '\u0672': '\u0622', // alef with madda above
  '\u0673': '\u0623', // alef with hamza above
  '\u0675': '\u0625', // alef with hamza below
};

/**
 * The basmala as letters and single spaces.
 *
 * Written as an escaped literal on purpose: it is the single source of truth for the
 * match, and an Arabic literal in source is exactly the thing that proved unreliable.
 * "بسم الله الرحمن الرحيم" with single spaces between the four words.
 */
const BASMALA_SKELETON = [
  '\u0628\u0633\u0645', // bsm
  '\u0627\u0644\u0644\u0647', // allh
  '\u0627\u0644\u0631\u062d\u0645\u0646', // alrhmn
  '\u0627\u0644\u0631\u062d\u064a\u0645', // alrHym
].join(' ');

/**
 * Reduce `text` to marks-free letters plus single spaces, keeping a map from each
 * skeleton index back to the index of the character it came from. The map is what lets
 * the caller cut the *original* string without losing a single diacritic.
 */
function skeletonise(text: string): { skeleton: string; originIndex: number[] } {
  let skeleton = '';
  const originIndex: number[] = [];

  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const char = String.fromCodePoint(cp);
    // Step over a whole surrogate pair so a rare astral letter is never split in half.
    const width = cp > 0xffff ? 2 : 1;

    if (!isMark(cp)) {
      if (/\s/u.test(char)) {
        // Collapse runs of whitespace so "word  word" cannot break the prefix match.
        if (!skeleton.endsWith(' ')) {
          skeleton += ' ';
          originIndex.push(i);
        }
      } else {
        skeleton += ALEF_VARIANTS[char] ?? char;
        originIndex.push(i);
      }
    }
    i += width;
  }

  return { skeleton, originIndex };
}

export interface BasmalaSplit {
  /**
   * The basmala exactly as the source encodes it — including the shadda on the ba that
   * surahs 95 and 97 carry — or `null` when this ayah does not open with one.
   */
  basmala: string | null;
  /** The ayah text with the basmala removed and leading whitespace trimmed. */
  rest: string;
}

/**
 * Separate a leading basmala from an ayah's text.
 *
 * `rest` comes back empty for Al-Fatihah, where the basmala *is* ayah 1. Callers must
 * treat that case as "keep it as the ayah" rather than "print a header and lose the text".
 */
export function splitBasmala(text: string): BasmalaSplit {
  const { skeleton, originIndex } = skeletonise(text);
  if (!skeleton.startsWith(BASMALA_SKELETON)) return { basmala: null, rest: text };

  const lastLetter = originIndex[BASMALA_SKELETON.length - 1];
  if (lastLetter === undefined) return { basmala: null, rest: text };

  // The final meem of "al-rahim" carries a kasra that belongs to the basmala, but marks
  // are dropped from the skeleton so the cut lands *before* it. Absorb any marks that
  // immediately follow, otherwise they are orphaned at the head of the ayah.
  let end = lastLetter + 1;
  while (end < text.length && isMark(text.codePointAt(end)!)) end++;

  return {
    basmala: text.slice(0, end),
    rest: text.slice(end).replace(/^\s+/, ''),
  };
}

/**
 * True for the one surah whose ayah 1 is nothing but the basmala (Al-Fatihah), so the
 * reader knows to keep it inline instead of lifting it to a header line.
 */
export function isBasmalaOnlyAyah(text: string): boolean {
  const { basmala, rest } = splitBasmala(text);
  return basmala !== null && rest.length === 0;
}
