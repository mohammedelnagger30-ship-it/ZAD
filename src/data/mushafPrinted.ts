import { PRINTED_PAGE_STARTS } from './mushafPageStarts';

/**
 * Facts about the *printed* Madani mushaf that are not layout decisions of ours.
 *
 * ── Why these live apart from `mushafFlow.ts` ──────────────────────────────────────
 * Two different things get called a "page" in this app, and they must not be confused:
 *
 *  1. **Which juz or hizb an ayah belongs to.** A property of the text and the printed
 *     mushaf, not a layout choice. Al-Fatihah is in juz 1 whatever we do.
 *  2. **Which page an ayah is printed on.** This comes from Tanzil's licensed page-start
 *     metadata; the app's line breaks and visual page layout remain independent.
 *
 * Keeping printed facts separate lets the flow generator and `surahs.ts` consume them
 * without an import cycle or conflating printed-page references with app page layout.
 *
 * Nothing here is shown to the user as a page number: `mushafFlow.ts` maps every boundary
 * below through the flow, so what the reader displays is always our own pagination.
 */

/** Pages in the printed Madani mushaf. */
export const PRINTED_TOTAL_PAGES = 604;

/**
 * Page on which each surah begins in the printed mushaf. Index 0 is surah 1.
 *
 * Four surahs share the last page, so the tail repeats 604. That is the printed mushaf's
 * own quirk, kept because the mapping below is defined against it.
 */
export const PRINTED_SURAH_START: readonly number[] = [
  1, 2, 50, 77, 106, 128, 151, 177, 187, 208,
  221, 235, 249, 255, 262, 267, 282, 293, 305, 312,
  322, 332, 342, 350, 359, 367, 377, 385, 396, 404,
  411, 415, 418, 428, 434, 440, 446, 453, 458, 467,
  477, 483, 489, 496, 499, 502, 507, 511, 515, 518,
  520, 523, 526, 528, 531, 534, 537, 542, 545, 549,
  551, 553, 554, 556, 558, 560, 562, 564, 566, 568,
  570, 572, 574, 575, 577, 578, 580, 582, 583, 585,
  586, 587, 587, 589, 590, 591, 591, 592, 593, 594,
  595, 595, 596, 596, 597, 597, 598, 598, 599, 599,
  600, 600, 601, 601, 601, 602, 602, 602, 603, 603,
  603, 604, 604, 604,
];

/**
 * Printed page on which each juz begins.
 *
 * Juz 1-29 are exactly 20 pages each, but the boundaries are NOT at multiples of 20 — juz 2
 * starts at page 22, not 21 — and juz 30 spans 582-604, so no `page / 20` formula works.
 */
export const PRINTED_JUZ_START_PAGES: readonly number[] = [
  1, 22, 42, 62, 82, 102, 122, 142, 162, 182,
  202, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

/**
 * Printed page on which each hizb begins.
 *
 * Two per juz and 20 pages per juz, so each hizb is 10 pages: hizb 2n-1 starts on the juz
 * start, hizb 2n ten pages in.
 */
export const PRINTED_HIZB_START_PAGES: Record<number, number> = {
  1: 1, 2: 11,
  3: 21, 4: 31,
  5: 41, 6: 51,
  7: 61, 8: 71,
  9: 81, 10: 91,
  11: 101, 12: 111,
  13: 121, 14: 131,
  15: 141, 16: 151,
  17: 161, 18: 171,
  19: 181, 20: 191,
  21: 201, 22: 211,
  23: 221, 24: 231,
  25: 241, 26: 251,
  27: 261, 28: 271,
  29: 281, 30: 291,
  31: 301, 32: 311,
  33: 321, 34: 331,
  35: 341, 36: 351,
  37: 361, 38: 371,
  39: 381, 40: 391,
  41: 401, 42: 411,
  43: 421, 44: 431,
  45: 441, 46: 451,
  47: 461, 48: 471,
  49: 481, 50: 491,
  51: 501, 52: 511,
  53: 521, 54: 531,
  55: 541, 56: 551,
  57: 561, 58: 571,
  59: 581, 60: 591,
};

/**
 * Exact page of an ayah in the printed Madani mushaf, resolved from Tanzil's licensed
 * page-start metadata.
 */
export function printedAyahPage(surahId: number, ayahNumber: number, ayahCount: number): number {
  if (!Number.isInteger(surahId) || !Number.isInteger(ayahNumber)
    || surahId < 1 || surahId > PRINTED_SURAH_START.length
    || ayahNumber < 1 || ayahNumber > ayahCount) return 1;

  let low = 0;
  let high = PRINTED_PAGE_STARTS.length - 1;
  let page = 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [startSurah, startAyah] = PRINTED_PAGE_STARTS[middle];
    if (startSurah < surahId || (startSurah === surahId && startAyah <= ayahNumber)) {
      page = middle + 1;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return page;
}

/** Juz (1-30) containing a printed page. */
export function printedJuzForPage(page: number): number {
  let juz = 1;
  for (let i = 0; i < PRINTED_JUZ_START_PAGES.length; i++) {
    if (page < PRINTED_JUZ_START_PAGES[i]) break;
    juz = i + 1;
  }
  return juz;
}
