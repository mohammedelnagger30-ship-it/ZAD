// Verifies the bundled Quran text is complete and internally consistent.
import { SURAHS, getAyahPage, getJuzForPage } from '../src/data/surahs';
import { getAyahs, getAyah, hasFullText, TOTAL_AYAHS } from '../src/data/quranText';

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

const TOTAL = 6236;

// ---- every surah is complete ----
const incomplete = SURAHS.filter((s) => !hasFullText(s.id)).map((s) => `${s.id}:${s.name}`);
check('all 114 surahs have complete text', incomplete, []);

const counts = SURAHS.map((s) => getAyahs(s.id).length);
const wrongCount = SURAHS.filter((s, i) => counts[i] !== s.ayahCount).map((s) => `${s.id}: ${counts[SURAHS.indexOf(s)]}/${s.ayahCount}`);
check('every surah returns exactly its declared ayah count', wrongCount, []);
check('total ayahs across the mushaf', counts.reduce((a, b) => a + b, 0), TOTAL);
check('declared total matches the dataset', TOTAL_AYAHS, TOTAL);

// ---- no placeholder text survived anywhere ----
const placeholders: string[] = [];
for (const s of SURAHS) {
  for (const a of getAyahs(s.id)) {
    if (a.text === '…' || a.text.trim().length === 0) placeholders.push(`${s.id}:${a.ayahNumber}`);
  }
}
check('no ayah is left as a placeholder', placeholders.length, 0);
if (placeholders.length) console.log(`       first missing: ${placeholders.slice(0, 10).join(', ')}`);

// ---- text actually looks like Quran ----
// Tanzil's Uthmani text uses the stricter orthography: wasla (U+0671) on an initial alif,
// e.g. "ٱللَّهُ" and "ٱلَّذِينَ". Matching has to allow for that, so compare with the
// wasla normalised away and the Arabic-Indic-free letters.
/**
 * Collapses Uthmani orthography down to plain consonants so a known ayah can be compared
 * against the dataset without depending on which alef spelling a given word uses.
 *
 * The subtlety is the dagger alef (U+0670). Tanzil writes it in two different roles:
 *   - as a *letter*, standing in for the alif of the modern spelling:  ص ر ٰ ط = صراط
 *   - as a *length mark* on a long vowel, where modern spelling writes no alif at all:
 *     ٱلرَّحْمَٰن = الرحمن
 * So it can neither be folded to ا (breaks the first case) nor kept (breaks the second).
 * Deleting it *and* the plain alif together makes both cases agree, so that is what this
 * does. The result deliberately ignores alef spelling; the surrounding consonant skeleton
 * is what actually guards against a garbled or misaligned dataset.
 */
const normalize = (s: string) =>
  s
    // The wasla (U+0671) is listed on its own line: it is canonically equivalent to U+0627,
    // so putting it in the same class as the other alef spellings is a duplicate the linter
    // rightly complains about — but it still has to be matched.
    .replace(/\u0671/g, '')
    .replace(/[\u0670\u0622\u0623\u0625\u0627]/g, '')       // ٰ آ أ إ ا
    .replace(/\u0649/g, '\u064A')                          // ى -> ي  (alif maqsura)
    .replace(/[\u064B-\u0652\u0653\u0654\u0655]/g, '')    // harakat, maddah, hamza
    .replace(/\u0640/g, '')                                // ـ   tatweel
    .replace(/\u06DD/g, '')                                // ۝   end-of-ayah marker
    .replace(/[\u06E5\u06E6]/g, '')                        // small waw / yeh
    .replace(/\s+/g, ' ')
    .trim();

// Tanzil prefixes the basmala to ayah 1 of every surah other than Al-Fatihah (where the
// basmala *is* ayah 1), so ayah 1 of An-Nas legitimately begins with it.
const BASMALA = 'بسم الله الرحمن الرحيم';
const samples: [number, number, string][] = [
  [1, 1, BASMALA],
  [1, 2, 'الحمد لله رب العالمين'],
  [1, 7, 'صراط الذين أنعمت عليهم غير المغضوب عليهم ولا الضالين'],
  [2, 1, `${BASMALA} الم`],
  [2, 255, 'الله لا إله إلا هو الحي القيوم'],
  [2, 286, 'لا يكلف الله نفسا إلا وسعها'],
  [112, 1, `${BASMALA} قل هو الله أحد`],
  [112, 4, 'ولم يكن له كفوا أحد'],
  [114, 1, `${BASMALA} قل أعوذ برب الناس`],
  [114, 4, 'من شر الوسواس الخناس'],
  [114, 6, 'من الجنة والناس'],
];
const textIssues: string[] = [];
for (const [surah, ayah, expected] of samples) {
  const a = getAyah(surah, ayah);
  if (!a) { textIssues.push(`${surah}:${ayah} missing`); continue; }
  const got = normalize(a.text);
  if (!got.startsWith(normalize(expected))) {
    textIssues.push(`${surah}:${ayah} = ${JSON.stringify(got.slice(0, 60))} (expected ${JSON.stringify(normalize(expected).slice(0, 60))})`);
  }
}
check('known ayahs match their expected text (wasla and harakat normalised)', textIssues, []);

// The wasla form is the correct Uthmani rendering, so assert it is actually present:
// this is what proves we did not silently fall back to a simpler text source.
check('Uthmani wasla (U+0671) is present as expected',
  getAyahs(2).some((a) => a.text.includes('\u0671')), true);

// Uthmani script uses these marks; if none appear the text was decoded wrongly.
const allFatiha = getAyahs(1).map((a) => a.text).join('');
check('Uthmani diacritics survived decoding', /[ً-ْـ]/.test(allFatiha), true);
check('no Arabic presentation-form corruption (U+FDD0..FDEF)',
  /[\uFDD0-\uFDEF]/.test(getAyahs(2).map((a) => a.text).join('')), false);
check('no replacement characters (U+FFFD)',
  SURAHS.some((s) => getAyahs(s.id).some((a) => a.text.includes('\uFFFD'))), false);

// ---- every ayah carries a page and juz consistent with the page map ----
let badJuz = 0;
let badPage = 0;
let badRange = 0;
for (const s of SURAHS) {
  for (const a of getAyahs(s.id)) {
    if (a.juz !== getJuzForPage(a.page)) badJuz++;
    if (a.page !== getAyahPage(s, a.ayahNumber)) badPage++;
    if (a.page < s.pageStart || a.page > 604) badRange++;
  }
}
check('every ayah juz matches the real juz table', badJuz, 0);
check('every ayah page matches the shared page map', badPage, 0);
check('every ayah page is inside the mushaf', badRange, 0);

// ---- the reader's own sanity checks ----
check('Al-Fatihah is 7 ayahs', getAyahs(1).length, 7);
check('Al-Baqarah is 286 ayahs', getAyahs(2).length, 286);
check('At-Tawbah is 129 ayahs (longest surah)', getAyahs(9).length, 129);
check('An-Nas is 6 ayahs', getAyahs(114).length, 6);
check('last ayah of the mushaf is An-Nas 6', getAyah(114, 6)?.text.length > 0, true);
check('out-of-range ayah returns undefined', getAyah(114, 7), undefined);
check('unknown surah returns no ayahs', getAyahs(999).length, 0);

console.log(failed === 0 ? '\nALL QURAN TEXT CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);