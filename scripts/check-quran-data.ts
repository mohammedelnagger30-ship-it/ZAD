// Sanity checks for the juz page table and suggestPlan parsing.
import { JUZ_INFO, JUZ_START_PAGES, SURAHS, getJuzForPage, getSurahsByJuz, getSurahsForPage } from '../src/data/surahs';
import { getAyahs, hasFullText } from '../src/data/quranText';
import { suggestPlan } from '../src/utils/taskManager';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.log(`FAIL ${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok   ${label} = ${JSON.stringify(actual)}`);
  }
}

// --- juz boundaries -------------------------------------------------
check('JUZ_START_PAGES length', JUZ_START_PAGES.length, 30);
check('juz 1 range', [JUZ_INFO[0].startPage, JUZ_INFO[0].endPage], [1, 21]);
check('juz 2 range', [JUZ_INFO[1].startPage, JUZ_INFO[1].endPage], [22, 41]);
check('juz 30 range', [JUZ_INFO[29].startPage, JUZ_INFO[29].endPage], [582, 604]);
check('getJuzForPage(1)', getJuzForPage(1), 1);
check('getJuzForPage(21)', getJuzForPage(21), 1);
check('getJuzForPage(22)', getJuzForPage(22), 2);
check('getJuzForPage(604)', getJuzForPage(604), 30);
check('getJuzForPage(0) clamps', getJuzForPage(0), 1);

// Every page maps to exactly one juz, and juz ranges are contiguous + complete.
let contiguous = true;
for (let i = 1; i < JUZ_START_PAGES.length; i++) {
  if (JUZ_INFO[i].startPage !== JUZ_INFO[i - 1].endPage + 1) contiguous = false;
}
check('juz ranges contiguous', contiguous, true);
check('juz 1 starts at page 1', JUZ_INFO[0].startPage, 1);
check('juz 30 ends at page 604', JUZ_INFO[29].endPage, 604);

// Surah juzStart is derived, so spot-check known values.
const byId = (id: number) => SURAHS.find((s) => s.id === id)!;
check('surah 78 (page 582) juzStart', byId(78).juzStart, 30);
check('surah 67 (page 562) juzStart', byId(67).juzStart, 29);
check('surah 1 juzStart', byId(1).juzStart, 1);
check('surah 3 (page 50) juzStart', byId(3).juzStart, 3);

// --- page -> surah lookup -------------------------------------------
check('surahs on page 1', getSurahsForPage(1).map((s) => s.name), ['الفاتحة']);
check('surahs on page 604', getSurahsForPage(604).map((s) => s.name), ['الإخلاص', 'الفلق', 'الناس']);
check('surahs in juz 30', getSurahsByJuz(30).length > 30, true);
check('surahs in juz 1 includes Al-Fatihah', getSurahsByJuz(1)[0].name, 'الفاتحة');

// --- ayah text ------------------------------------------------------
//
// The whole Quran is bundled now (`src/data/quran-full.json`, 6,236 ayahs). This check
// used to assert the opposite for Al-Kahf — that it had *no* text — back when only the
// juz 30 surahs were included. Asserting "no text" would now be asserting a regression,
// so the direction is flipped: every surah must have text.
check('Al-Fatihah full text', hasFullText(1), true);
check('Al-Kahf full text', hasFullText(18), true);
check('Al-Baqarah full text', hasFullText(2), true);
check('An-Nas full text', hasFullText(114), true);
check('every surah has bundled text', SURAHS.every((s) => hasFullText(s.id)), true);

// Placeholder must not repeat the ayah number (was `﴿15﴾۝15`).
const fajr = getAyahs(89, 1, 3);
check('placeholder has no digits', fajr.every((a) => !/\d/.test(a.text)), true);
check('placeholder page starts at pageStart', fajr[0].page, byId(89).pageStart);
check('ayah numbering starts at 1', fajr[0].ayahNumber, 1);

// Bundled ayah pages must be derived too, not a single hard-coded page per surah.
const naba = getAyahs(78, 1, 40);
check('An-Naba juz is 30 (page 582)', naba[0].juz, 30);
check('An-Naba ayah pages stay inside its range', naba.every((a) => a.page >= 582 && a.page <= 584), true);

// --- suggestPlan ----------------------------------------------------
const goals: [string, string][] = [
  ['حفظ سورة الملك', 'surah:67'],
  ['حفظ جزء عمّ في شهر', 'juz:30'],
  ['حفظ سورة البقرة', 'surah:2'],
  ['حفظ سورة 2 في 3 شهور', 'surah:2'],
  ['حفظ جزء الثلاثين', 'juz:30'],
  ['حفظ جزء ١٨ في شهرين', 'juz:18'],
  ['أريد حفظ سورة الكهف', 'surah:18'],
  ['memorize juz 30 in 2 months', 'juz:30'],
  ['حفظ سورة ١١٤', 'surah:114'],
];
for (const [goal, expectedPortion] of goals) {
  const plan = suggestPlan(goal);
  check(`suggestPlan("${goal}")`, plan.plans[0].portion, expectedPortion);
}

// The two goals that used to silently fall back to page:604
check('no silent page:604 fallback for named goals',
  goals.slice(0, 8).every(([g]) => suggestPlan(g).plans[0].portion !== 'page:604'), true);

// An unrecognised goal must still fall back, and must say so.
const fallback = suggestPlan('xyzzy');
check('unrecognised goal falls back', fallback.plans[0].portion, 'page:604');
check('fallback description is explicit', /لم يتضح الهدف/.test(fallback.description), true);

// Study plans use half-page sessions, five new-learning days per week, and gradual portions.
const j30 = suggestPlan('حفظ جزء عمّ');
check('juz 30 plan resolved', j30.plans[0].portion === 'juz:30', true);
check('juz 30 description explains half-page sessions', /نصف صفحة في جلسة الحفظ/.test(j30.description), true);
check('juz 30 description gives five new-learning days per week', /٥ جلسات جديدة أسبوعياً/.test(j30.description), true);
check('juz 30 hifz is split into manageable portions', j30.plans[0].portionSequence!.length > 0, true);
check('juz 30 has a spaced-review plan', j30.plans[1].name, 'مراجعة متباعدة');
// Juz 30 opens with An-Naba (page 582). Al-Mulk starts on page 562, which is juz 29, so
// labelling juz 30 "الملك" contradicted the app's own page table.
check('juz 30 is labelled An-Naba, the surah it actually opens with',
  j30.description.includes('الجزء 30 (النبأ)'), true);
// The familiar name must still be recognised as input even though it is not the label.
check('alias "الملك" still resolves to juz 30',
  suggestPlan('حفظ جزء الملك').plans[0].portion, 'juz:30');
check('alias "عمّ" still resolves to juz 30',
  suggestPlan('حفظ جزء عمّ').plans[0].portion, 'juz:30');
check('alias "تبارك" resolves to juz 29',
  suggestPlan('حفظ جزء تبارك').plans[0].portion, 'juz:29');
check('Al-Mulk is estimated at about one week',
  suggestPlan('حفظ سورة الملك').description.includes('أسبوع تقريباً'), true);
check('long Al-Baqarah is given a longer estimate than Al-Mulk',
  suggestPlan('حفظ سورة البقرة').description.includes('أشهر تقريباً'), true);
check('surah hifz plan is split into portions',
  suggestPlan('حفظ سورة الكهف').plans[0].portionSequence!.length > 1, true);

// Ordinals must beat the bare form: "الثالث عشر" is 13, not 3.
check('ordinal "الجزء الثالث عشر" -> juz 13', suggestPlan('حفظ الجزء الثالث عشر').plans[0].portion, 'juz:13');
check('ordinal "الجزء الثلاثين" -> juz 30', suggestPlan('حفظ الجزء الثلاثين').plans[0].portion, 'juz:30');
check('ordinal "الجزء العاشر" -> juz 10', suggestPlan('حفظ الجزء العاشر').plans[0].portion, 'juz:10');

// Harakat must not change the outcome: the same goal typed with and without them.
check('harakat do not defeat matching',
  suggestPlan('حُفْظ جُزْء عَمّ فِي شَهْر').plans[0].portion, 'juz:30');

// A goal about a surah must never be mistaken for a juz.
check('surah goal is not claimed as a juz', suggestPlan('حفظ سورة مريم').plans[0].portion, 'surah:19');
check('surah-with-word-جزء still resolves', suggestPlan('حفظ جزء من سورة مريم').plans[0].portion, 'juz:19');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);