// Arabic text helpers shared by search and content matching.
//
// Search has to be tolerant: users type "الصلاة" but the text stores "الصَّلَاةِ", and they
// type "اهله" where the mushaf writes "ٱلْأَهْلَةِ". Folding both sides to the same form is
// what makes search feel like it works instead of returning nothing.

/** Removes harakat, tatweel and the end-of-ayah marker, keeping letters. */
export function stripTashkeel(input: string): string {
  return input
    .replace(/[\u064B-\u0655\u0670]/g, '')
    .replace(/\u0640/g, '')
    .replace(/\u06DD/g, '');
}

/**
 * Folds an Arabic string to a coarse comparison form.
 *
 * This is deliberately lossy — it ignores alef spelling (ا أ إ آ ٱ), alef maqsura (ى),
 * taa marbuta (ة) and hamza carriers — because that is what makes a search for one spelling
 * find the other. Do not use it to display text.
 */
export function normalizeArabic(input: string): string {
  return stripTashkeel(input)
    .replace(/[\u0671\u0622\u0623\u0625\u0627]/g, '\u0627') // ٱ آ أ إ ا
    .replace(/\u0649/g, '\u064A') // ى
    .replace(/\u0629/g, '\u0647') // ة
    .replace(/[\u0622]/g, '\u0627')
    .toLowerCase()
    .trim();
}

/** Combining marks, tatweel and Quranic annotation signs — dropped when folding. */
function isFoldMark(cp: number): boolean {
  return (
    (cp >= 0x0610 && cp <= 0x061a) || // Arabic punctuation / signs
    (cp >= 0x064b && cp <= 0x065f) || // harakat, shadda, sukun, Quranic annotation marks
    (cp >= 0x06d6 && cp <= 0x06ed) || // sajdah and small high letter marks
    (cp >= 0x08d3 && cp <= 0x08ff) || // Arabic Extended-A marks
    cp === 0x0640 || // tatweel
    cp === 0x0670 || // superscript (dagger) alef
    cp === 0x06dd // end-of-ayah marker
  );
}

/**
 * Folds an Arabic string for *strict* matching against the downloaded word-meanings
 * source (`utils/wordMeaningsService`), where the two sides are known to be the same
 * ayah written by two different publishers.
 *
 * Two differences from `normalizeArabic` matter, and both were measured against this
 * project's Tanzil text and the quranpedia dump rather than assumed:
 *
 *  * Every Quranic annotation sign goes, not just the harakat — the source writes
 *    "ٱلْعٰلَمِين" without the dagger alef where Tanzil writes "ٱلْعَٰلَمِين", and
 *    Tanzil's small high letters (U+06D6–U+06ED, Arabic Extended-A) have no counterpart
 *    there either.
 *  * Every alef form is *deleted*, not folded to one alef: the source prints a plain
 *    "العالمين" where Tanzil writes an alef wasla, so keeping any alef at all splits the
 *    two spellings into different strings. Alefs are far more common than the letters
 *    around them, so dropping them costs little in discrimination and buys back the
 *    largest single source of disagreement. ى→ي and ة→ه stay as they are.
 *
 * Measured: this fold lets 91.3% of the source's gloss fragments be located inside the
 * ayah they claim to belong to. Do not use it to display text — it is lossy by design.
 *
 * Walked by code point instead of with a regex character class (as in `basmala.ts`):
 * a class holding combining marks is exactly what ESLint's `no-misleading-character-class`
 * rejects, and a lone combining mark is just as misleading in code as in text.
 */
export function foldForMatch(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (isFoldMark(cp)) continue;
    switch (cp) {
      case 0x0671: // alef wasla
      case 0x0622: // alef with madda
      case 0x0623: // alef with hamza above
      case 0x0625: // alef with hamza below
      case 0x0627: // plain alef
        continue;
      case 0x0649:
        out += '\u064A'; // ى → ي
        break;
      case 0x0629:
        out += '\u0647'; // ة → ه
        break;
      default:
        out += String.fromCodePoint(cp);
    }
  }
  return out;
}

/**
 * Splits a query into words and folds each one, so multi-word searches match regardless
 * of word order and of extra spacing.
 */
export function arabicQueryTerms(query: string): string[] {
  return normalizeArabic(query)
    .split(/\s+/)
    .filter((t) => t.length > 1); // single letters match far too much to be useful
}