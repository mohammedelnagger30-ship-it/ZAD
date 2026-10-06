/**
 * Facts about the *printed* Madani mushaf that are not layout decisions of ours.
 *
 * ── Why these live apart from `mushafFlow.ts` ──────────────────────────────────────
 * Two different things get called a "page" in this app, and they must not be confused:
 *
 *  1. **Which juz or hizb an ayah belongs to.** A property of the text and the printed
 *     mushaf, not a layout choice. Al-Fatihah is in juz 1 whatever we do.
 *  2. **Which page an ayah is printed on.** Until the flow layout landed this came from a
 *     reconstruction; now it is `mushafFlow.ts`'s answer and ours to choose.
 *
 * Keeping the printed tables here, in a module that imports nothing, is what lets the flow
 * generator read them, the reader read the flow, and `surahs.ts` read both — without an
 * import cycle. It also means these numbers can be deleted from one place if the app ever
 * stops claiming to line up with a physical mushaf.
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
 * Page of an ayah in the printed mushaf.
 *
 * There is no per-ayah page map for the printed mushaf, so the ayah's position inside its
 * surah is scaled onto the surah's exact printed page range. Monotonic and anchored on real
 * surah starts, which is all it is used for here: finding the ayah that a printed page
 * boundary falls on, so that boundary can be mapped through the flow. Deliberately never
 * used for anything the user sees.
 */
export function printedAyahPage(surahId: number, ayahNumber: number, ayahCount: number): number {
  const start = PRINTED_SURAH_START[surahId - 1];
  if (start === undefined) return 1;
  const next = PRINTED_SURAH_START[surahId];
  const end = Math.min(Math.max((next ?? PRINTED_TOTAL_PAGES) - 1, start), PRINTED_TOTAL_PAGES);
  const span = end - start;
  if (span <= 0 || ayahCount <= 1) return start;
  const offset = Math.round(((ayahNumber - 1) / (ayahCount - 1)) * span);
  return Math.min(Math.max(start + offset, start), end);
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
