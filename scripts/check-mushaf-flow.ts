/**
 * Guards the generated mushaf page map against the text it was built from.
 *
 * `src/data/mushafFlow.ts` is a build artifact: 9,005 line breaks, produced by
 * `build-mushaf-flow.ts` from the real font metrics. Its danger is not that it is wrong
 * *now* but that it can silently become wrong later — someone regenerates it against
 * edited Quran text, or replaces a verse, or the generator's word-offset logic drifts, and
 * the reader starts showing pages with missing words or duplicated surahs. Nothing at
 * runtime would notice: a line with two words too few still renders.
 *
 * So the invariant is checked here against the source text, from scratch, on every
 * `npm run verify`:
 *
 *   1. Every page holds at least one line and never more than 15.
 *   2. Line word ranges, concatenated in reading order, reproduce the Quran exactly —
 *      same words, same order, same count, nothing dropped and nothing doubled.
 *   3. Every ayah resolves to a real page, and page numbers only ever move forward.
 *   4. The page count is the calibrated one, so a change in the text or the font cannot
 *      quietly repaginate the mushaf.
 *
 * Run with `npm run check:flow`. Needs no network, no browser and no width table.
 */

import quran from '../src/data/quran-full.json';
import {
  LINES_PER_PAGE,
  COLUMN_EM,
  TOTAL_PAGES,
  TOTAL_LINES,
  TOTAL_WORDS,
  getFlowLine,
  getPageLines,
  getAyahFlowPage,
  getSurahsOnPage,
} from '../src/data/mushafFlow';
import { getSurahWords } from '../src/data/mushafWords';
import { splitBasmala } from '../src/utils/basmala';

/**
 * Page count the column was calibrated to. The printed mushaf has 604; 18.2em lands at
 * 602, within 0.4%. If this number moves, the calibration was disturbed and someone should
 * look at the sweep in `build-mushaf-flow.ts` before accepting it.
 */
const EXPECTED_PAGES = 602;

const SURAHS = Object.keys(quran).map(Number).sort((a, b) => a - b);

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

/**
 * Words of a surah, straight from the runtime module.
 *
 * Not a private reimplementation: the whole point of this check is to prove that
 * `mushafWords` — the code the reader actually slices lines with — agrees with the line
 * table. A copy here would agree with itself and prove nothing.
 */
function surahWordList(surahId: number): string[] {
  return getSurahWords(surahId).map((w) => w.text);
}

console.log('\n== mushaf flow: shape ==');

check(LINES_PER_PAGE === 15, 'a page is 15 lines', `got ${LINES_PER_PAGE}`);
check(COLUMN_EM > 10 && COLUMN_EM < 30, 'column is a sane measure', `${COLUMN_EM}em`);
check(TOTAL_PAGES === EXPECTED_PAGES, `page count is the calibrated ${EXPECTED_PAGES}`, `got ${TOTAL_PAGES}`);
check(TOTAL_LINES > 0 && TOTAL_LINES <= TOTAL_PAGES * LINES_PER_PAGE, 'line count fits the pages', `${TOTAL_LINES} lines over ${TOTAL_PAGES} pages`);

let emptyPages = 0;
let overfullPages = 0;
let shortest = Infinity;
let longest = 0;
const linesPerPage: number[] = [];

for (let page = 1; page <= TOTAL_PAGES; page++) {
  const lines = getPageLines(page);
  linesPerPage.push(lines.length);
  if (lines.length === 0) emptyPages++;
  if (lines.length > LINES_PER_PAGE) overfullPages++;
  shortest = Math.min(shortest, lines.length);
  longest = Math.max(longest, lines.length);
}

check(emptyPages === 0, 'no page is empty', `${emptyPages} empty`);
check(overfullPages === 0, 'no page exceeds 15 lines', `${overfullPages} overfull`);
check(shortest >= 1, 'the shortest page still has a line', `${shortest} lines`);
check(longest === LINES_PER_PAGE, 'at least one page is completely full', `longest ${longest}`);

console.log('\n== mushaf flow: the text survives the line breaks ==');

let mismatches = 0;
let firstMismatch = '';
let reconstructedWords = 0;

for (const surahId of SURAHS) {
  const source = surahWordList(surahId);
  const start = SURAHS.indexOf(surahId);
  void start;

  const pagesOfLines: number[] = [];
  for (let i = 0; i < TOTAL_LINES; i++) {
    const line = getFlowLine(i)!;
    if (line.surahId === surahId) pagesOfLines.push(i);
  }

  const read: string[] = [];
  for (const i of pagesOfLines) {
    const line = getFlowLine(i)!;
    // Basmala lines carry four of the surah's words, so they belong in the reading back.
    if (line.kind === 'heading') continue;
    read.push(...source.slice(line.from, line.from + line.count));
  }
  reconstructedWords += read.length;

  if (read.length !== source.length || read.some((w, i) => w !== source[i])) {
    mismatches++;
    if (!firstMismatch) {
      const at = read.findIndex((w, i) => w !== source[i]);
      firstMismatch = `surah ${surahId}: read ${read.length} words, source ${source.length}, first difference at word ${at}`;
    }
  }
}

check(mismatches === 0, 'every word of every surah appears exactly once, in order', firstMismatch);
check(
  reconstructedWords === TOTAL_WORDS,
  'the line table places as many words as the text has',
  `${reconstructedWords} vs ${TOTAL_WORDS}`,
);

const sourceWordTotal = SURAHS.reduce((s, id) => s + surahWordList(id).length, 0);
check(
  reconstructedWords === sourceWordTotal,
  'and as many as the source text has',
  `${reconstructedWords} vs ${sourceWordTotal}`,
);

console.log('\n== mushaf flow: ayahs ==');

let badPage = 0;
let nonMonotonic = 0;
const ayahTotal = SURAHS.reduce((s, id) => s + (quran as Record<string, string[]>)[String(id)].length, 0);

for (const surahId of SURAHS) {
  const ayahs = (quran as Record<string, string[]>)[String(surahId)];
  let previous = 0;
  for (let a = 1; a <= ayahs.length; a++) {
    const page = getAyahFlowPage(surahId, a);
    if (!Number.isInteger(page) || page < 1 || page > TOTAL_PAGES) {
      badPage++;
      continue;
    }
    if (page < previous) nonMonotonic++;
    previous = page;
  }
}

check(badPage === 0, `all ${ayahTotal.toLocaleString('en-US')} ayahs land on a real page`, `${badPage} did not`);
check(nonMonotonic === 0, 'pages never go backwards inside a surah', `${nonMonotonic} regressions`);
check(getAyahFlowPage(1, 1) === 1, 'Al-Fatihah opens on page 1', `got ${getAyahFlowPage(1, 1)}`);
check(getAyahFlowPage(1, 7) >= 1, 'the last ayah of Al-Fatihah is placed', `got ${getAyahFlowPage(1, 7)}`);
// Al-Baqarah's first ayah shares page 1 with the tail of Al-Fatihah, exactly as it does in
// the printed mushaf — a short surah ends partway down a page and the next one starts there.
check(
  getAyahFlowPage(2, 1) === 1 && getAyahFlowPage(1, 7) === 1,
  'Al-Baqarah begins on the same page Al-Fatihah ends',
  `Al-Fatihah ends on ${getAyahFlowPage(1, 7)}, Al-Baqarah opens on ${getAyahFlowPage(2, 1)}`,
);
check(
  getAyahFlowPage(114, 6) === TOTAL_PAGES,
  'the last ayah of the mushaf is on the last page',
  `got ${getAyahFlowPage(114, 6)} of ${TOTAL_PAGES}`,
);

console.log('\n== mushaf flow: ayah markers ==');

// The reader hangs each ayah-end marker off a word flagged `endsAyah`, and the generator
// reserved a mark's width on exactly the words where it set that flag. If the two disagree
// about where an ayah ends, either a mark lands mid-ayah or a line overflows the column it
// was measured to fit — so the flag is checked against the source text here.
let markerMismatch = 0;
let firstMarkerProblem = '';
let markCount = 0;

for (const surahId of SURAHS) {
  const ayahs = (quran as Record<string, string[]>)[String(surahId)];
  const first = splitBasmala(ayahs[0] ?? '');
  const basmalaIsOwnLine = first.basmala !== null && first.rest.length > 0;

  // What the words should be: the basmala first when it gets its own line, then every
  // ayah, with the final word of each ayah flagged.
  const expected: { text: string; ayah: number; endsAyah: boolean }[] = [];
  if (basmalaIsOwnLine) {
    for (const text of first.basmala!.split(' ').filter(Boolean)) {
      expected.push({ text, ayah: 0, endsAyah: false });
    }
  }
  for (let a = 1; a <= ayahs.length; a++) {
    const parts = (basmalaIsOwnLine && a === 1 ? first.rest : ayahs[a - 1]).split(' ').filter(Boolean);
    parts.forEach((text, i) => expected.push({ text, ayah: a, endsAyah: i === parts.length - 1 }));
  }

  const words = getSurahWords(surahId);
  if (words.length !== expected.length) {
    markerMismatch++;
    if (!firstMarkerProblem) {
      firstMarkerProblem = `surah ${surahId}: ${words.length} words, expected ${expected.length}`;
    }
    continue;
  }
  for (let i = 0; i < expected.length; i++) {
    const got = words[i];
    const want = expected[i];
    if (got.text !== want.text || got.ayah !== want.ayah || got.endsAyah !== want.endsAyah) {
      markerMismatch++;
      if (!firstMarkerProblem) {
        firstMarkerProblem =
          `surah ${surahId} word ${i}: got "${got.text}" ayah ${got.ayah} mark ${got.endsAyah}, ` +
          `expected "${want.text}" ayah ${want.ayah} mark ${want.endsAyah}`;
      }
    }
  }
  markCount += words.filter((w) => w.endsAyah).length;
}

check(markerMismatch === 0, 'every word sits where the text says, with the right ayah marker', firstMarkerProblem);
check(
  markCount === 6236,
  'there is exactly one marker per ayah across the mushaf',
  `${markCount} markers for 6,236 ayahs`,
);

console.log('\n== mushaf flow: reading quality ==');

const wordCounts = SURAHS.flatMap((surahId) => {
  const out: number[] = [];
  for (let i = 0; i < TOTAL_LINES; i++) {
    const line = getFlowLine(i)!;
    if (line.surahId === surahId && line.kind === 'text') out.push(line.count);
  }
  return out;
});
const sortedCounts = [...wordCounts].sort((a, b) => a - b);
const mean = wordCounts.reduce((s, n) => s + n, 0) / wordCounts.length;
const median = sortedCounts[Math.floor(sortedCounts.length / 2)];

check(
  median >= 7 && median <= 11,
  'the median line holds a mushaf number of words (7-11)',
  `median ${median}, mean ${mean.toFixed(2)}`,
);
check(
  sortedCounts[Math.floor(sortedCounts.length * 0.95)] <= 14,
  'no line runs away with the text',
  `p95 ${sortedCounts[Math.floor(sortedCounts.length * 0.95)]} words`,
);

// A heading at the foot of a page with nothing under it reads as belonging to the surah
// above, which is exactly the mistake the generator's orphan control exists to prevent.
let orphanHeadings = 0;
for (let page = 1; page <= TOTAL_PAGES; page++) {
  const lines = getPageLines(page);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind !== 'heading') continue;
    const under = lines.slice(i).filter((l) => l.kind === 'text').length;
    if (under === 0) orphanHeadings++;
  }
}

check(orphanHeadings === 0, 'no surah heading is stranded at the foot of a page', `${orphanHeadings} stranded`);

console.log('\n== mushaf flow: lookups agree ==');

let surahMismatch = 0;
for (let page = 1; page <= TOTAL_PAGES; page++) {
  const fromLines = [...new Set(getPageLines(page).map((l) => l.surahId))];
  const fromHelper = getSurahsOnPage(page);
  if (fromLines.join(',') !== fromHelper.join(',')) surahMismatch++;
}
check(surahMismatch === 0, 'getSurahsOnPage matches the page lines', `${surahMismatch} disagree`);

console.log('\n== mushaf flow: summary ==');
const meanLines = linesPerPage.reduce((s, n) => s + n, 0) / linesPerPage.length;
console.log(`  pages            ${TOTAL_PAGES}  (printed mushaf: 604)`);
console.log(`  lines            ${TOTAL_LINES.toLocaleString('en-US')}`);
console.log(`  words/line       mean ${mean.toFixed(2)}  median ${median}  p95 ${sortedCounts[Math.floor(sortedCounts.length * 0.95)]}`);
console.log(`  lines per page   mean ${meanLines.toFixed(2)}  min ${shortest}  max ${longest}`);
console.log(`  column           ${COLUMN_EM}em`);

console.log(`\n${failures === 0 ? `OK  ${checks} checks passed` : `FAILED  ${failures} of ${checks} checks failed`}\n`);
process.exit(failures === 0 ? 0 : 1);