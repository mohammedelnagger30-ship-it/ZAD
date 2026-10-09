/**
 * Guards the content layout.
 *
 * The failure this prevents is real and has happened once already: an earlier version of
 * `npm run data:tafsir` wrote ~316 MB of tafsir JSON into `src/data/`, which made a build
 * impossible and would have shipped a multi-hundred-megabyte bundle. Nothing about that
 * was wrong at runtime — it just quietly defeated the download model, where the user picks
 * what to keep on their device.
 *
 * Run with `npm run check:content`. Needs no network and no cache.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TAFSIR_EDITIONS,
  HADITH_BOOKS,
  tafsirSurahUrl,
  hadithUrl,
  formatBytes,
  HADITH_OF_DAY_BOOK,
} from '../src/data/contentCatalog';
import { TOTAL_AYAHS, getAyah, getAyahs } from '../src/data/quranText';
import { ADHKAR_CATEGORIES } from '../src/data/adhkar';
import { cleanHadithText } from '../src/utils/hadithService';
import { toArabicNumber, getSurah } from '../src/data/surahs';
import { getTotalPages } from '../src/data/mushafPages';
import { splitBasmala } from '../src/utils/basmala';
import {
  summariseGrid,
  FIVE_PRAYERS,
  PRAYER_LABELS_AR,
  type DayPrayerGrid,
  type PrayerKey,
  type PrayerStatus,
} from '../src/utils/prayerTracker';
import { formatDateKey, addDays } from '../src/utils/dateUtils';
import { canEditPrayerDate, prayerEditTimeRemaining, PRAYER_EDIT_WINDOW_MS } from '../src/utils/prayerTracker';
import { getDailyQuranMessage, type DailyMessageStorage } from '../src/utils/dailyQuranMessage';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

let failures = 0;
let checks = 0;

function check(ok: boolean, label: string, detail = ''): void {
  checks++;
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n== source tree size ==');

// 2 MB: the largest legitimate asset under src/ is the bundled Quran text at ~1.3 MB.
// Anything above that is content that belongs on the user's device, not in the bundle.
const SIZE_LIMIT = 2 * 1024 * 1024;
const oversized: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (statSync(full).size > SIZE_LIMIT) {
      oversized.push(`${relative(ROOT, full)} (${(statSync(full).size / 1024 / 1024).toFixed(1)} MB)`);
    }
  }
}
walk(SRC);

check(
  oversized.length === 0,
  'no file under src/ exceeds 2 MB',
  oversized.join(', '),
);

console.log('\n== tafsir catalogue ==');

check(TAFSIR_EDITIONS.length === 8, 'eight tafsir editions offered', `got ${TAFSIR_EDITIONS.length}`);

const ids = new Set(TAFSIR_EDITIONS.map((e) => e.id));
check(ids.size === TAFSIR_EDITIONS.length, 'tafsir edition ids are unique');

const slugs = new Set(TAFSIR_EDITIONS.map((e) => e.slug));
check(slugs.size === TAFSIR_EDITIONS.length, 'tafsir slugs are unique');

for (const edition of TAFSIR_EDITIONS) {
  check(
    edition.surahBytes.length === 115, // index 0 unused, 1..114
    `${edition.id}: surahBytes covers 1..114`,
    `got ${edition.surahBytes.length - 1}`,
  );

  // totalBytes must equal the sum of the per-surah table, or progress bars lie.
  const sum = edition.surahBytes.reduce((a, b) => a + (b ?? 0), 0);
  check(
    sum === edition.totalBytes,
    `${edition.id}: totalBytes matches the per-surah sum`,
    `${sum} vs ${edition.totalBytes}`,
  );

  check(
    edition.ayahs > 0 && edition.ayahs <= TOTAL_AYAHS,
    `${edition.id}: ayah count within the Quran's ${TOTAL_AYAHS}`,
    `got ${edition.ayahs}`,
  );

  const url = tafsirSurahUrl(edition.slug, 2);
  check(
    url.endsWith(`/tafsir/${edition.slug}/2.json`) && url.startsWith('https://'),
    `${edition.id}: surah URL is well formed`,
    url,
  );
}

// Jalalayn is a short commentary and genuinely skips ayahs; the rest are complete. If a
// future source drops coverage, the UI says so, but a large regression is a bug.
const complete = TAFSIR_EDITIONS.filter((e) => e.ayahs === TOTAL_AYAHS);
check(complete.length >= 6, 'at least six tafsirs cover every ayah', `${complete.length} do`);

console.log('\n== hadith catalogue ==');

check(HADITH_BOOKS.length === 9, 'nine hadith collections offered', `got ${HADITH_BOOKS.length}`);
check(
  HADITH_BOOKS.reduce((sum, book) => sum + book.count, 0) === 36064,
  'hadith collection counts match the source catalog total',
  HADITH_BOOKS.reduce((sum, book) => sum + book.count, 0),
);
const qudsiCollection = HADITH_BOOKS.find((book) => book.id === 'forty_qudsi');
check(qudsiCollection?.titleAr === 'الأربعون القدسية', 'Qudsi collection has the correct Arabic title');
check(
  qudsiCollection?.authorAr === 'غير مذكور في بيانات المصدر',
  'Qudsi collection does not claim an author absent from source metadata',
);

const bookIds = new Set(HADITH_BOOKS.map((b) => b.id));
check(bookIds.size === HADITH_BOOKS.length, 'hadith ids are unique');

const bookSlugs = new Set(HADITH_BOOKS.map((b) => b.slug));
check(bookSlugs.size === HADITH_BOOKS.length, 'hadith slugs are unique');

for (const book of HADITH_BOOKS) {
  check(book.count > 0, `${book.id}: has hadiths`, `got ${book.count}`);
  check(book.downloadBytes > 0, `${book.id}: has a measured size`, `got ${book.downloadBytes}`);
  const url = hadithUrl(book.slug);
  check(
    url.endsWith(`/editions/${book.slug}.json`) && url.startsWith('https://'),
    `${book.id}: collection URL is well formed`,
    url,
  );
}

// The app pre-fetches one collection on first run so "hadith of the day" works offline.
// If that id ever stops existing the fetch silently turns into a permanent error.
check(bookIds.has(HADITH_OF_DAY_BOOK), 'the pre-fetched collection exists in the catalogue');
// HomeScreen falls back to this id when nothing is installed, so it must be a real book.
check(
  HADITH_BOOKS.some((b) => b.id === HADITH_OF_DAY_BOOK && b.count > 0),
  'the hadith-of-the-day collection is a real book with hadiths',
);

console.log('\n== hadith text hygiene ==');

// sunnah.com's payloads put HTML inside the text (every Nawawi hadith ends with a `<br>`
// before its takhrij). Rendered literally that showed the user raw markup, so the parser
// has to keep stripping it. `cleanHadithText` is exported for this check, which is the
// only way to assert on it without standing up a test runner the project does not have.
check(
  cleanHadithText('نص الحديث<br>رَوَاهُ البُخَارِيُّ') === 'نص الحديث\nرَوَاهُ البُخَارِيُّ',
  'a <br> in hadith text becomes a newline',
  JSON.stringify(cleanHadithText('نص الحديث<br>رَوَاهُ')),
);
check(
  !/[<>]/.test(cleanHadithText('<script>alert(1)</script>نص')),
  'other tags are stripped, never rendered',
);
check(
  !cleanHadithText('<br><br><br>نص').startsWith('\n'),
  'leading breaks are trimmed',
);

// Same reason: a Western-digit count next to an Arabic-Indic one reads as a bug in an
// RTL UI, so the byte formatter has to agree with `toArabicNumber`.
check(
  formatBytes(3_145_728) === '٣٫٠ MB',
  'byte sizes use Arabic-Indic digits',
  formatBytes(3_145_728),
);
check(
  toArabicNumber(6236) === '٦٢٣٦',
  'counts use Arabic-Indic digits',
  toArabicNumber(6236),
);

console.log('\n== bundled Quran text ==');

check(existsSync(join(SRC, 'data', 'quran-full.json')), 'src/data/quran-full.json exists');
check(TOTAL_AYAHS === 6236, 'the Quran text holds all 6,236 ayahs', `got ${TOTAL_AYAHS}`);
console.log('\n== daily Quran message ==');

const dailyMessageStorage = new Map<string, string>();
const mockStorage: DailyMessageStorage = {
  getItem: (key) => dailyMessageStorage.get(key) ?? null,
  setItem: (key, value) => { dailyMessageStorage.set(key, value); },
};
const testDate = new Date(2026, 9, 4, 12);
const firstDailyMessage = getDailyQuranMessage(testDate, mockStorage, () => 0);
const repeatedDailyMessage = getDailyQuranMessage(testDate, mockStorage, () => 0.99);
const nextDailyMessage = getDailyQuranMessage(addDays(testDate, 1), mockStorage, () => 0.999999);
check(
  firstDailyMessage.text === getAyah(firstDailyMessage.surahId, firstDailyMessage.ayahNumber)?.text &&
    Boolean(firstDailyMessage.surahName),
  'daily message is an exact verse with a surah reference',
);
check(
  firstDailyMessage.surahId === repeatedDailyMessage.surahId &&
    firstDailyMessage.ayahNumber === repeatedDailyMessage.ayahNumber,
  'the selected Quran message stays the same throughout one local day',
);
check(
  nextDailyMessage.date !== firstDailyMessage.date &&
    (nextDailyMessage.surahId !== firstDailyMessage.surahId ||
      nextDailyMessage.ayahNumber !== firstDailyMessage.ayahNumber),
  'a different Quran verse is selected for the next day',
);

console.log('\n== prayer confirmation rules ==');
const testToday = new Date(2026, 9, 4, 12);
check(
  canEditPrayerDate(formatDateKey(testToday), testToday) &&
    canEditPrayerDate(formatDateKey(addDays(testToday, -1)), testToday),
  'prayer entries for today and yesterday are editable',
);
check(
  !canEditPrayerDate(formatDateKey(addDays(testToday, -2)), testToday) &&
    !canEditPrayerDate(formatDateKey(addDays(testToday, 1)), testToday),
  'prayer entries older than yesterday and future dates are not editable',
);
check(
  prayerEditTimeRemaining(1_000, 1_000 + PRAYER_EDIT_WINDOW_MS - 1) === 1 &&
    prayerEditTimeRemaining(1_000, 1_000 + PRAYER_EDIT_WINDOW_MS) === 0,
  'prayer edits lock exactly 10 seconds after confirmation',
);

console.log('\n== adhkar and Quranic supplications ==');

const allAdhkar = ADHKAR_CATEGORIES.flatMap((category) => category.items);
const quranicDuaCategory = ADHKAR_CATEGORIES.find((category) => category.id === 'quranic_duas');
const quranicDuas = quranicDuaCategory?.items ?? [];
const adhkarById = new Map(allAdhkar.map((item) => [item.id, item]));
const adhkarIds = allAdhkar.map((item) => item.id);
check(new Set(adhkarIds).size === adhkarIds.length, 'adhkar item ids are unique');
check(quranicDuaCategory != null && quranicDuas.length >= 40, 'at least 40 Quranic supplication passages are available', `got ${quranicDuas.length}`);
check(
  quranicDuas.every((item) => item.countIsSpecified === false && item.reference.includes('سورة')),
  'Quranic supplications have references and no invented repeat count',
);
check(
  quranicDuas.every((item) => !item.text.includes('...') && !item.text.includes('…')),
  'Quranic supplication passages are not truncated',
);
check(
  quranicDuas.every((item) => {
    const match = /^quran-(\d+)-(\d+)$/.exec(item.id);
    if (!match) return false;
    const firstAyah = getAyah(Number(match[1]), Number(match[2]));
    return firstAyah != null && item.text.includes(firstAyah.text);
  }),
  'Quranic supplications match the bundled Tanzil text',
);
check(
  allAdhkar.find((item) => item.id === 'm1')?.text === getAyah(2, 255)?.text,
  'Ayat al-Kursi is shown in full from the Quran text',
);
check(
  ['m9', 'e7', 's7'].every((id) => adhkarById.get(id)?.count === 3),
  'the three Quls use the established three-repetition count in morning, evening, and bedtime adhkar',
);
check(
  ['s5', 's6'].every((id) =>
    adhkarById.get(id)?.text ===
    getAyahs(2, id === 's5' ? 255 : 285, id === 's5' ? 255 : 286).map((ayah) => ayah.text).join(' '),
  ),
  'bedtime Quran recitations match their complete Quran passages',
);
check(
  ['m10', 'e8'].every((id) => adhkarById.get(id)?.reference.includes('٥٠٧٢')),
  'morning and evening content cites the Abu Dawud source',
);
check(
  ['m11', 'e9'].every((id) => adhkarById.get(id)?.reference.includes('٣٨٧١')),
  'the complete forgiveness and wellbeing supplication is available in morning and evening',
);
check(
  adhkarById.get('w2')?.reference.includes('١١٥٤') &&
    adhkarById.get('w2')?.text.endsWith('اللَّهُمَّ اغْفِرْ لِي'),
  'night-waking remembrance includes its closing supplication and source',
);
check(
  adhkarById.get('s8')?.reference.includes('٣٤٠١') &&
    adhkarById.get('w3')?.reference.includes('٣٤٠١'),
  'the bedtime and waking supplications cite the Hasan Tirmidhi narration',
);
check(
  ['morning', 'evening', 'after_prayer', 'sleep', 'wakeup'].every((categoryId) => {
    const category = ADHKAR_CATEGORIES.find((item) => item.id === categoryId);
    return category != null && category.items.length >= 4;
  }),
  'morning, evening, after-prayer, bedtime, and waking collections each include multiple adhkar',
);
check(
  adhkarById.get('m5')?.text.endsWith('فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ') &&
    adhkarById.get('e10')?.text === adhkarById.get('m5')?.text,
  'the complete master supplication for forgiveness is available in morning and evening',
);
check(
  adhkarById.get('s4')?.text.endsWith('وَبِنَبِيِّكَ الَّذِي أَرْسَلْتَ') &&
    adhkarById.get('s4')?.reference.includes('٦٣١٣'),
  'the bedtime surrender supplication is complete and sourced',
);
check(
  adhkarById.get('w4')?.text === getAyahs(3, 190, 200).map((ayah) => ayah.text).join(' '),
  'night-waking Quran recitation matches the complete referenced passage',
);
check(
  adhkarById.get('a7')?.reference.includes('١٥٢٢') &&
    adhkarById.get('a8')?.reference.includes('١٥٢٣'),
  'post-prayer additions cite their Abu Dawud sources',
);
check(
  adhkarById.get('s9')?.reference.includes('٢٧١٥') &&
    adhkarById.get('m12')?.reference.includes('٢٧٢٦') &&
    adhkarById.get('m13')?.reference.includes('٥٠٧٣'),
  'new bedtime and morning adhkar cite their source collections',
);
check(
  adhkarById.get('e12')?.reference.includes('٥٠٠٩') &&
    adhkarById.get('e12')?.countIsSpecified === false,
  'evening Quran recitation is sourced and has no invented repetition count',
);
check(
  adhkarById.get('a9')?.reference.includes('٨٤٤') &&
    adhkarById.get('s10')?.reference.includes('٢٧١٣') &&
    adhkarById.get('w5')?.reference.includes('١١٥٤'),
  'new evening routine adhkar cite their hadith sources',
);
for (const [categoryId, expectedMinimum] of [
  ['evening', 12],
  ['after_prayer', 9],
  ['sleep', 10],
  ['wakeup', 5],
] as const) {
  const category = ADHKAR_CATEGORIES.find((item) => item.id === categoryId);
  check(
    (category?.items.length ?? 0) >= expectedMinimum,
    `${categoryId}: has the expanded adhkar set`,
    `got ${category?.items.length ?? 0}`,
  );
}
for (const [categoryId, expectedMinimum] of [
  ['morning', 17],
  ['wudu', 2],
  ['mosque', 2],
  ['food', 3],
  ['home', 2],
  ['travel', 3],
  ['general_duas', 8],
] as const) {
  const category = ADHKAR_CATEGORIES.find((item) => item.id === categoryId);
  check(
    (category?.items.length ?? 0) >= expectedMinimum,
    `${categoryId}: has the expanded adhkar set`,
    `got ${category?.items.length ?? 0}`,
  );
}
check(
  ADHKAR_CATEGORIES.filter((category) => category.daily !== false)
    .map((category) => category.id)
    .join(',') === 'morning,evening,after_prayer,sleep,wakeup',
  'only the daily routine collections count toward the daily adhkar progress',
);
check(
  ['m14', 'm15', 'e13', 'e14'].every((id) =>
    adhkarById.get(id)?.count === 3 && adhkarById.get(id)?.reference.includes('٥٠٩٠')),
  'morning and evening health adhkar keep the threefold count and their Abu Dawud source',
);
check(
  adhkarById.get('m16')?.count === 100 &&
    adhkarById.get('m16')?.reference.includes('٣٨١٥') &&
    adhkarById.get('d4')?.count === 100 &&
    adhkarById.get('d4')?.reference.includes('١٥١٦'),
  'the hundredfold supplications keep their sourced repetition counts',
);
for (const [id, source] of [
  ['m17', '٩٢٥'],
  ['u1', '٥٥'],
  ['u2', '٥٥'],
  ['ms1', '١٦٥٢'],
  ['ms2', '١٦٥٢'],
  ['f1', '٣٧٦٧'],
  ['f2', '٣٧٦٧'],
  ['f3', '٤٠٢٣'],
  ['h1', '٣٤٢٦'],
  ['h2', '٣٨٨٤'],
  ['t1', '٣٢٧٥'],
  ['t2', '٣٠٨٥'],
  ['t3', '٦٨٧٩'],
  ['d1', '٦٩٠٣'],
  ['d2', '٦٩٠٤'],
  ['d3', '٢١٤٠'],
  ['d4', '١٥١٦'],
  ['d5', '٣٨٤٦'],
  ['d6', '١٠٨٤'],
  ['d7', '١١٢١'],
  ['d8', '٤٨٥٩'],
] as const) {
  check(
    adhkarById.get(id)?.reference.includes(source),
    `${id}: cites its hadith source ${source}`,
  );
}
check(
  ['quran-12-101', 'quran-23-29', 'quran-39-53', 'quran-40-60'].every((id) => adhkarById.has(id)),
  'the newest Quranic supplication passages are present',
);

console.log('\n== mushaf basmala splitting ==');

// The mushaf reader prints its own basmala banner at every surah opening. Tanzil also
// folds the basmala into ayah 1, so these invariants are what stop the page from showing
// it twice — and, just as importantly, what stop the split from eating a letter of the
// real ayah. The naive implementation (a literal `startsWith`) silently failed on surahs
// 95 and 97, where the source orders the shadda and kasra the other way round.
const stripMarks = (t: string): string =>
  t.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/gu, '');

let splitCount = 0;
const noBasmala: number[] = [];
const basmalaIsAyah1: number[] = [];
const lossy: number[] = [];

for (let surahId = 1; surahId <= 114; surahId++) {
  const ayah = getAyah(surahId, 1);
  if (!ayah) {
    check(false, `surah ${surahId} has an ayah 1 to split`);
    continue;
  }
  const { basmala, rest } = splitBasmala(ayah.text);

  if (basmala === null) {
    noBasmala.push(surahId);
    check(rest === ayah.text, `surah ${surahId}: text passed through untouched`);
    continue;
  }
  splitCount++;
  if (rest.length === 0) basmalaIsAyah1.push(surahId);

  // The halves must rebuild the original, marks aside. A cut landing mid-word, or leaving
  // the basmala's own trailing kasra behind, breaks this.
  if (`${stripMarks(basmala)} ${stripMarks(rest)}`.trim() !== stripMarks(ayah.text).trim()) {
    lossy.push(surahId);
  }
}

check(
  splitCount === 113,
  'a basmala is lifted out of 113 of the 114 surahs',
  `${splitCount} did`,
);
check(
  noBasmala.length === 1 && noBasmala[0] === 9,
  'only At-Tawbah (9) has no basmala, which is correct',
  noBasmala.join(',') || 'none',
);
check(
  basmalaIsAyah1.length === 1 && basmalaIsAyah1[0] === 1,
  'only Al-Fatihah (1) has a basmala that *is* ayah 1',
  basmalaIsAyah1.join(',') || 'none',
);
check(lossy.length === 0, 'every basmala split is lossless', lossy.join(', '));

// Surahs 95 and 97 are the reason matching cannot be done on the raw string: they encode
// the shadda before the kasra, where the rest encode the opposite.
for (const surahId of [95, 97]) {
  const ayah = getAyah(surahId, 1)!;
  const { basmala } = splitBasmala(ayah.text);
  check(
    basmala !== null && /\u0651/.test(basmala),
    `surah ${surahId}: shadda variant of the basmala still matches`,
  );
}

// The split must only ever apply to ayah 1. If it could fire mid-surah it would strip the
// start of a real ayah.
let straySplits = 0;
for (let surahId = 1; surahId <= 114; surahId++) {
  const meta = getSurah(surahId);
  if (!meta) continue;
  for (const ayah of getAyahs(surahId, 2, meta.ayahCount)) {
    if (splitBasmala(ayah.text).basmala !== null) straySplits++;
  }
}
check(straySplits === 0, 'no ayah other than ayah 1 is treated as a basmala', `${straySplits} did`);

// And no ayah may end up empty in the reader: an empty string is invisible text.
let emptied = 0;
for (let surahId = 1; surahId <= 114; surahId++) {
  const ayah = getAyah(surahId, 1);
  if (!ayah) continue;
  const { rest } = splitBasmala(ayah.text);
  if (rest.length === 0 && splitBasmala(ayah.text).basmala === null) emptied++;
}
check(emptied === 0, 'no ayah is left with no text to render');

console.log('\n== mushaf page assembly ==');

// Every page must land the same ayahs the page map claims, or the reader would show a page
// that is missing text or repeats the previous one.
let placed = 0;
const perPage = new Map<number, number>();
for (let surahId = 1; surahId <= 114; surahId++) {
  const meta = getSurah(surahId);
  if (!meta) continue;
  for (const ayah of getAyahs(surahId, 1, meta.ayahCount)) {
    perPage.set(ayah.page, (perPage.get(ayah.page) ?? 0) + 1);
    placed++;
  }
}
check(placed === TOTAL_AYAHS, 'every ayah is placed on exactly one page', `${placed} placed`);
check(perPage.size === getTotalPages(), 'every page of our mushaf carries text', `${perPage.size} of ${getTotalPages()}`);
check(
  [...perPage.values()].every((n) => n > 0),
  'no mushaf page is empty',
);

console.log('\n== prayer week grid ==');

// The weekly grid is only useful if it does not invent failures. These invariants pin
// the three ways it could: counting a future prayer, counting sunrise, and letting a
// silent day score as 100%.
{
  const today = new Date();
  const iso = (d: Date) => formatDateKey(d);
  const key = (offset: number) => iso(addDays(today, offset));

  const allDue: Record<PrayerKey, boolean> = {
    fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true,
  };

  const build = (over: Partial<DayPrayerGrid> = {}): DayPrayerGrid => ({
    date: key(0),
    dayName: 'اليوم',
    dayNumber: '١',
    isToday: true,
    isPast: false,
    due: allDue,
    status: { fajr: null, dhuhr: null, asr: null, maghrib: null, isha: null },
    ...over,
  });

  // A day where every prayer is recorded as prayed.
  const perfect = summariseGrid([
    build({
      date: key(-6),
      isPast: true,
      status: { fajr: 'ontime', dhuhr: 'ontime', asr: 'ontime', maghrib: 'ontime', isha: 'ontime' },
    }),
  ]);
  check(perfect.total === 5, 'a fully recorded day counts 5 slots', `${perfect.total}`);
  check(perfect.percentage === 100, 'a fully recorded day scores 100%', `${perfect.percentage}%`);
  check(
    perfect.unconfirmed === 0 && perfect.missed === 0,
    'a fully recorded day has no misses',
  );

  // Nothing recorded at all — the case the old percentage hid, scoring 100% because the
  // denominator only counted confirmed prayers.
  const silent = summariseGrid([build({ date: key(-6), isPast: true })]);
  check(silent.unconfirmed === 5, 'an unrecorded past day reports 5 unconfirmed', `${silent.unconfirmed}`);
  check(silent.percentage === 0, 'an unrecorded past day scores 0%, not 100%', `${silent.percentage}%`);

  // One prayer out of five must not score 100%.
  const partial = summariseGrid([
    build({
      date: key(-6),
      isPast: true,
      status: { fajr: 'ontime', dhuhr: null, asr: null, maghrib: null, isha: null },
    }),
  ]);
  check(partial.total === 5, 'one recorded prayer out of five still counts 5 slots', `${partial.total}`);
  check(partial.percentage === 20, 'one recorded prayer out of five scores 20%', `${partial.percentage}%`);

  // The important one: a prayer whose time has not arrived is not owed yet.
  const upcoming = summariseGrid([
    build({
      due: { fajr: true, dhuhr: true, asr: false, maghrib: false, isha: false },
    }),
  ]);
  check(upcoming.total === 2, 'prayers that have not come round yet are excluded', `${upcoming.total}`);
  check(
    upcoming.unconfirmed === 2,
    'only the two due-and-unlogged prayers count as unconfirmed',
    `${upcoming.unconfirmed}`,
  );
  check(upcoming.missed === 0, 'an upcoming prayer is never reported as missed', `${upcoming.missed}`);

  // Recording one of the due ones must leave the other, and never invent the future.
  const halfLogged = summariseGrid([
    build({
      due: { fajr: true, dhuhr: true, asr: false, maghrib: false, isha: false },
      status: { fajr: 'ontime', dhuhr: null, asr: null, maghrib: null, isha: null },
    }),
  ]);
  check(halfLogged.total === 2, 'a partly logged today still counts 2 slots', `${halfLogged.total}`);
  check(halfLogged.percentage === 50, 'one of two due prayers logged scores 50%', `${halfLogged.percentage}%`);
  check(halfLogged.unconfirmed === 1, 'the unlogged due prayer is the only unconfirmed', `${halfLogged.unconfirmed}`);

  // Sunrise is not one of the five and must never occupy a column.
  check(FIVE_PRAYERS.length === 5, 'the grid has exactly the five obligatory prayers', `${FIVE_PRAYERS.length}`);
  check(
    FIVE_PRAYERS.every((p) => PRAYER_LABELS_AR[p] && PRAYER_LABELS_AR[p].length > 0),
    'every prayer has an Arabic label for the grid header',
  );
  check(
    new Set(FIVE_PRAYERS).size === FIVE_PRAYERS.length,
    'no prayer is listed twice',
  );
  // `Object.keys` on the literal above is the shape the grid actually renders from.
  check(
    Object.keys({
      fajr: null, dhuhr: null, asr: null, maghrib: null, isha: null,
    } as Record<PrayerKey, PrayerStatus | null>).length === 5,
    'the no-status literal covers every prayer key',
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`\nFAILED: ${failures} content check(s) did not pass`);
  process.exit(1);
}
