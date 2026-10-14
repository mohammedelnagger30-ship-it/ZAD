import { toArabicNumber } from '@/data/surahs';

/**
 * Counts a noun the way Arabic counts it.
 *
 * The shape is: one, two, the plural for three up to ten, and the singular
 * again from eleven on — so a recitation run is «سورة واحدة»، «سورتان»،
 * «٣ سور»، «١٠ سور»، then «١١ سورة» and every number after it. A template
 * that appends the singular every time gets «١١ سورة» right by luck and
 * «٣ سورة» wrong by construction, and that is the kind of mistake that reads
 * as a translation nobody checked.
 *
 * Zero takes the plural, as «صفر سور» does.
 */
export interface ArabicCountForms {
  /** One. */
  one: string;
  /** Two. */
  two: string;
  /** Three through ten. */
  few: string;
  /** Eleven and over, and zero. */
  many: string;
}

export function arabicCount(count: number, forms: ArabicCountForms): string {
  // Zero takes the plural, as «صفر سور» does; a lone 0 before a singular reads
  // as a word having gone missing.
  if (count === 0) return forms.few;
  if (count === 1) return forms.one;
  if (count === 2) return forms.two;
  // Three to ten take the plural; eleven and every count above it take the
  // singular.
  //
  // The range is read on the whole number, not on its last two digits. Taking
  // the last two was the tempting version — it sounds like the compound rule —
  // but it makes «١٠٠٠٣ آيات» out of a count of ten thousand and three, which
  // nobody writes. Past ten, the number is read whole and the noun is
  // singular: «١١ آية»، «١٠٣ آية»، «١٠٠٣ آية».
  if (count >= 3 && count <= 10) return forms.few;
  return forms.many;
}

/** «٣ سور» — the number and the noun, counted the way Arabic counts them. */
export function countNoun(count: number, forms: ArabicCountForms): string {
  // One and two are carried by the noun's own shape — «سورة»، «سورتان» — and
  // Arabic does not set a numeral beside them; a numeral becomes necessary
  // only from three on, where it takes the counted noun in the plural or,
  // past ten, back in the singular.
  if (count < 3) return arabicCount(count, forms);
  return `${toArabicNumber(count)} ${arabicCount(count, forms)}`;
}
