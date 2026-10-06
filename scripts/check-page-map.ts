/**
 * Checks the page map the reader actually navigates by.
 *
 * ── What changed and why these assertions ───────────────────────────────────────────
 * This used to pin down facts about the *printed* mushaf: that Al-Baqarah spans pages
 * 2-49, that juz 29 opens Al-Mulk on page 562, that the mushaf has 604 pages. Those were
 * real, and they were worth pinning — but they pinned a page map the app no longer uses.
 *
 * The app's pagination is now the flow layout in `mushafFlow.ts`: page breaks measured
 * from the real typeface so that every page is 15 full lines. `mushafFlow` has its own
 * checks (`check:flow`) for the line breaks and the text reconstruction; this file checks
 * the *derived* answers the rest of the app depends on — surah ranges, juz lookups, page
 * coverage, ayah monotonicity — because those are where a wrong page number surfaces as a
 * broken jump, and none of them is checkable from the flow table alone.
 *
 * The rule throughout: assert relationships that must hold of *any* pagination (pages are
 * covered, surahs tile in order, juz lookups agree with themselves), not identity with the
 * printed mushaf. Where a printed fact still matters — which juz an ayah is in — it is
 * checked through `mushafPrinted`.
 */

import {
  SURAHS,
  JUZ_INFO,
  TOTAL_QURAN_PAGES,
  getJuzForPage,
  getSurah,
  getSurahEndPage,
  getSurahsByJuz,
  getSurahsForPage,
  getAyahPage,
  getAyahsInJuz,
} from '../src/data/surahs';
import { PRINTED_JUZ_START_PAGES } from '../src/data/mushafPrinted';
import { TOTAL_PAGES } from '../src/data/mushafFlow';
import { suggestPlan } from '../src/utils/taskManager';

let failed = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.log(`  FAIL ${label}\n       actual   ${a}\n       expected ${e}`);
  } else {
    console.log(`  ok   ${label} = ${a}`);
  }
};

console.log(`\nour mushaf: ${TOTAL_PAGES} pages\n`);

// ---- one page count, everywhere ----
check('the reader, the surah table and the flow agree on the page count', [
  TOTAL_QURAN_PAGES,
  TOTAL_PAGES,
], [602, 602]);

// ---- surah ranges are inside the mushaf and never run backwards ----
const ranges = SURAHS.map((s) => [s.pageStart, getSurahEndPage(s)] as const);
check('Al-Fatihah opens on page 1', ranges[0][0], 1);
check('An-Nas ends on the last page', ranges[113], [TOTAL_PAGES, TOTAL_PAGES]);
check('no surah starts outside the mushaf', SURAHS.filter((s) => s.pageStart < 1 || s.pageStart > TOTAL_PAGES).length, 0);
check('no surah has endPage < pageStart', SURAHS.filter((s) => getSurahEndPage(s) < s.pageStart).length, 0);

// Surahs are printed in order, so their start pages cannot go backwards. This is what a
// wrong ayah->page entry would break first.
let outOfOrder = 0;
for (let i = 1; i < SURAHS.length; i++) {
  if (SURAHS[i].pageStart < SURAHS[i - 1].pageStart) outOfOrder++;
}
check('surah start pages never go backwards', outOfOrder, 0);

// ---- the surahs tile the whole mushaf: no page without a surah on it ----
// A gap here means a page the reader can turn to but cannot name, which is how "page 300
// belongs to nothing" bugs start.
let uncovered = 0;
let sharedPages = 0;
for (let page = 1; page <= TOTAL_PAGES; page++) {
  const on = getSurahsForPage(page);
  if (on.length === 0) uncovered++;
  else if (on.length > 1) sharedPages++;
}
check('every page has at least one surah on it', uncovered, 0);
console.log(`       (${sharedPages} pages are shared by two surahs, as in the real mushaf)`);

// A shared page must be reported as covered by both, not just one — the reader shows two
// surah names there and jumping to either has to work.
const firstShared = (() => {
  for (let page = 1; page <= TOTAL_PAGES; page++) {
    if (getSurahsForPage(page).length > 1) return page;
  }
  return 0;
})();
check(`shared page ${firstShared} is covered by both surahs`, getSurahsForPage(firstShared).length, 2);

// ---- juz lookups agree with themselves ----
check('juz 2 resolves to a surah', getSurahsByJuz(2).length > 0, true);
check('every juz 1..30 resolves to at least one surah',
  JUZ_INFO.filter((j) => getSurahsByJuz(j.id).length === 0).map((j) => j.id), []);
check('there are 30 juz', JUZ_INFO.length, 30);

// The juz boundary table is the single source: `getJuzForPage` must send a page to the
// juz whose start it is, or the header on a page contradicts the page's own contents.
const juzMismatch = JUZ_INFO.filter((j) => getJuzForPage(j.startPage) !== j.id).map((j) => j.id);
check('getJuzForPage agrees with every juz start page', juzMismatch, []);

// Juz start pages must rise, or a page would claim two juz.
let nonRisingJuz = 0;
for (let i = 1; i < JUZ_INFO.length; i++) {
  if (JUZ_INFO[i].startPage <= JUZ_INFO[i - 1].startPage) nonRisingJuz++;
}
check('juz start pages strictly increase', nonRisingJuz, 0);

// ---- "open juz" must land on a surah that really holds that page ----
const unresolved = JUZ_INFO.filter((j) => {
  const t = getSurahsForPage(j.startPage)[0];
  return !t || !(t.pageStart <= j.startPage && getSurahEndPage(t) >= j.startPage);
}).map((j) => j.id);
check('every juz resolves to a surah containing its first page', unresolved, []);

// The *printed* mushaf's juz boundaries are still facts about the text: which surah each
// juz opens must not have drifted while the page numbers did. This is the one place a
// printed number is checked, and deliberately not a page number.
const expectJuzOpens: Record<number, string> = {
  1: 'الفاتحة',
  2: 'البقرة',     // juz 2 opens inside Al-Baqarah
  4: 'آل عمران',
  29: 'الملك',
  30: 'النبأ',
};
for (const [juzId, name] of Object.entries(expectJuzOpens)) {
  const n = Number(juzId);
  const startPage = JUZ_INFO.find((j) => j.id === n)!.startPage;
  // The juz opens on the page where the printed boundary's opening ayah now falls.
  const onPage = getSurahsForPage(startPage);
  const names = onPage.map((s) => s.name);
  check(`juz ${n} opens on ${name} (page ${startPage} carries ${names.join(' + ')})`, names.includes(name), true);
}
check('printed juz boundaries still run 1..582 in 30 steps',
  [PRINTED_JUZ_START_PAGES.length, PRINTED_JUZ_START_PAGES[0], PRINTED_JUZ_START_PAGES[29]], [30, 1, 582]);

// ---- page lookups agree with the surah ranges ----
for (const page of [1, 2, 3, TOTAL_PAGES - 1, TOTAL_PAGES]) {
  const covering = getSurahsForPage(page);
  const consistent = covering.length > 0 && covering.every((s) => s.pageStart <= page && getSurahEndPage(s) >= page);
  check(`page ${page} is covered by a surah whose range really contains it`, consistent, true);
}
check(`page ${TOTAL_PAGES + 1} (past the end) is covered by nothing`, getSurahsForPage(TOTAL_PAGES + 1).length, 0);

// ---- ayah pages are monotonic and inside their surah ----
const baqarah = getSurah(2)!;
check('Al-Baqarah ayah 1 is on its first page', getAyahPage(baqarah, 1), baqarah.pageStart);
check('Al-Baqarah ayah 286 is on its last page', getAyahPage(baqarah, 286), getSurahEndPage(baqarah));
check('Al-Fatihah ayah 1 is on page 1', getAyahPage(getSurah(1)!, 1), 1);
check('An-Nas ayah 6 is on the last page', getAyahPage(getSurah(114)!, 6), TOTAL_PAGES);

let nonMonotonic = 0;
for (const s of SURAHS) {
  let prev = 0;
  for (let a = 1; a <= s.ayahCount; a++) {
    const p = getAyahPage(s, a);
    if (p < prev || p < s.pageStart || p > getSurahEndPage(s)) nonMonotonic++;
    prev = p;
  }
}
check('ayah pages are monotonic and in range for all 6236 ayahs', nonMonotonic, 0);

// ---- juz ayah counts and the portion-based study plans ----
check('juz 1 ayah count is sane (was 293, double-counting Al-Baqarah)',
  getAyahsInJuz(1) > 100 && getAyahsInJuz(1) < 200, true);
check('juz 30 ayah count is the largest', getAyahsInJuz(30) === Math.max(...JUZ_INFO.map((j) => getAyahsInJuz(j.id))), true);
check('no juz has a zero ayah count', JUZ_INFO.filter((j) => getAyahsInJuz(j.id) === 0).map((j) => j.id), []);
const perJuz = JUZ_INFO.map((j) => getAyahsInJuz(j.id));
check('all juz counts are positive', perJuz.every((n) => n > 0), true);
console.log(`       juz ayah counts: min ${Math.min(...perJuz)}, max ${Math.max(...perJuz)}, sum ${perJuz.reduce((a, b) => a + b, 0)} (of ${SURAHS.reduce((a, s) => a + s.ayahCount, 0)} total)`);

// Every generated study portion must be a valid, bounded ayah range.
for (const goal of ['حفظ جزء عمّ', 'حفظ جزء ١', 'حفظ جزء ٣٠', 'حفظ جزء ٢']) {
  const { plans, description } = suggestPlan(goal);
  const sequence = plans[0].portionSequence ?? [];
  const rangesValid = sequence.every((portion) => {
    const match = portion.match(/^surah:(\d+):(\d+)-(\d+)$/);
    if (!match) return false;
    const surah = SURAHS.find((item) => item.id === Number(match[1]));
    return !!surah && Number(match[2]) >= 1 && Number(match[3]) <= surah.ayahCount && Number(match[2]) <= Number(match[3]);
  });
  check(`plan for "${goal}" has portion ranges`, sequence.length > 0, true);
  check(`plan for "${goal}" portions are valid ayah ranges`, rangesValid, true);
  check(`plan for "${goal}" describes a realistic weekly pace`, /٥ جلسات جديدة أسبوعياً/.test(description), true);
  check(`  "${goal}" produces a plan`, plans.length > 0, true);
}

console.log(failed === 0 ? '\nALL JUZ/SURAH PAGE CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);