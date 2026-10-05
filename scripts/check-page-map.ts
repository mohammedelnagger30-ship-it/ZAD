// Verifies the exact surah end-page derivation, the juz->surah mapping and the
// per-ayah juz counts that the planner now depends on.
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

// ---- end pages are derived from the next surah, and tile 1..604 with no gap ----
const ranges = SURAHS.map((s) => [s.pageStart, getSurahEndPage(s)] as const);
check('surah 1 (Al-Fatihah) spans pages 1-1', ranges[0], [1, 1]);
check('surah 2 (Al-Baqarah) spans pages 2-49 (was estimated 2-21)', ranges[1], [2, 49]);
check('surah 114 (An-Nas) ends on the last page', ranges[113], [604, 604]);

// A surah ends at the later of its own start and the page before the next one starts.
// Surahs are allowed to share their first page with the next surah (16 pairs do), because
// in the real mushaf a short surah ends partway down a page the next one then starts on.
let overreach = 0;
const sharedStartPages: number[] = [];
for (let i = 0; i < SURAHS.length; i++) {
  const surah = SURAHS[i];
  const end = getSurahEndPage(surah);
  const nextStart = SURAHS[i + 1]?.pageStart;
  if (end > nextStart) {
    overreach++;
    console.log(`       overreach: surah ${surah.id} ends ${end}, next starts ${nextStart}`);
  }
  if (nextStart !== undefined && end === nextStart) sharedStartPages.push(nextStart);
}
check('no surah is reported as ending after the next one begins', overreach, 0);
console.log(`       (${sharedStartPages.length} pages are shared between two surahs, as in the real mushaf)`);
// A page shared by two surahs must be reported as covered by both.
const shared = sharedStartPages[0];
const onSharedPage = getSurahsForPage(shared).map((s) => s.id);
check(`shared page ${shared} is covered by both surahs`, onSharedPage.length, 2);

// A surah must never be reported as ending before it starts.
check('no surah has endPage < pageStart', SURAHS.filter((s) => getSurahEndPage(s) < s.pageStart).length, 0);

// ---- the bug that motivated this: juz 2 used to resolve to nothing ----
check('juz 2 now resolves to a surah', getSurahsByJuz(2).length > 0, true);
check('every juz 1..30 resolves to at least one surah',
  JUZ_INFO.filter((j) => getSurahsByJuz(j.id).length === 0).map((j) => j.id), []);

// ---- openJuz must land on the surah holding the juz's first page ----
// This mirrors openJuz() exactly: it resolves to getSurahsForPage(juz.startPage)[0], i.e.
// "take me to where this juz starts". Many juz start mid-surah (juz 2 is entirely inside
// Al-Baqarah), which is why the surah covering the first page is the right target.
const expectJuzTarget: Record<number, string> = {
  1: 'الفاتحة',   // starts on page 1, Al-Fatihah's first page
  2: 'البقرة',     // starts on page 22, mid-Al-Baqarah (2-49)
  3: 'البقرة',     // starts on page 42, still mid-Al-Baqarah
  4: 'آل عمران',   // starts on page 62, mid-Al-Imran (50-76)
  29: 'الملك',     // starts on page 562, Al-Mulk's first page
  30: 'النبأ',     // starts on page 582, An-Naba's first page
};
for (const [juzId, name] of Object.entries(expectJuzTarget)) {
  const n = Number(juzId);
  const target = getSurahsForPage(JUZ_INFO.find((j) => j.id === n)!.startPage)[0];
  check(`juz ${juzId} opens ${name}`, target?.name, name);
}

// For all 30 juz the tap target must be non-empty and must truly contain the juz's first page.
const unresolved = JUZ_INFO.filter((j) => {
  const t = getSurahsForPage(j.startPage)[0];
  return !t || !(t.pageStart <= j.startPage && getSurahEndPage(t) >= j.startPage);
}).map((j) => j.id);
check('every juz 1..30 resolves to a surah containing its first page', unresolved, []);

// A surah spanning into a juz must not be what that juz opens.
const juz30Target = getSurahsForPage(JUZ_INFO[29].startPage)[0];
check('juz 30 does not open Al-Mursalat (page 580, which is juz 29)',
  juz30Target?.name === 'المرسلات', false);
check('Al-Mursalat is reported as juz 29', getJuzForPage(getSurah(77)!.pageStart), 29);

// ---- page lookups agree with the surah ranges ----
for (const page of [1, 2, 22, 49, 50, 562, 581, 582, 604]) {
  const covering = getSurahsForPage(page);
  const consistent = covering.length > 0 && covering.every((s) => s.pageStart <= page && getSurahEndPage(s) >= page);
  check(`page ${page} is covered by a surah whose range really contains it`, consistent, true);
}
check('page 605 (past the end) is covered by nothing', getSurahsForPage(TOTAL_QURAN_PAGES + 1).length, 0);

// ---- ayah pages are monotonic and land on the exact bounds ----
const baqarah = getSurah(2)!;
check('Al-Baqarah ayah 1 is on its first page', getAyahPage(baqarah, 1), baqarah.pageStart);
check('Al-Baqarah ayah 286 is on its last page', getAyahPage(baqarah, 286), 49);
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