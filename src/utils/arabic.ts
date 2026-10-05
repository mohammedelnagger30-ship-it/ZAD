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

/**
 * Splits a query into words and folds each one, so multi-word searches match regardless
 * of word order and of extra spacing.
 */
export function arabicQueryTerms(query: string): string[] {
  return normalizeArabic(query)
    .split(/\s+/)
    .filter((t) => t.length > 1); // single letters match far too much to be useful
}