/**
 * Builds the mushaf page map: which words sit on which line, and which line is on
 * which page.
 *
 * ── Why this is generated rather than computed at runtime ────────────────────────────
 * A mushaf page *is* its line breaks. To fill 15 lines per page you have to know where
 * each line ends, and where a line ends depends on the real advance width of every word
 * in the real typeface. Those widths are measured once, offline, by Chromium's shaper
 * (`measure-word-widths.mjs`) and read from `build/word-widths.json`.
 *
 * ── Why the column is 18.2 em ───────────────────────────────────────────────────────
 * The printed mushaf hands us a calibration point we cannot otherwise get: 604 pages of
 * 15 lines = 9,060 lines. Sweeping the column width over the real text, 18.2em
 * reproduces that page count to within 0.5% while leaving a line at 8-9 words — where a
 * mushaf line sits — and only a few percent of slack for justification to absorb.
 *
 * ── Why the output is a table ───────────────────────────────────────────────────────
 * Runtime line-breaking would put the 19k-entry width table in the bundle and would have
 * to wait for the font before the reader could paint. The break table is ~10 KB, needs no
 * font, and is identical on every device — which is the point, since a page of a mushaf
 * is a fixed object rather than something that reflows.
 *
 * Run: node scripts/measure-word-widths.mjs && npx tsx scripts/build-mushaf-flow.ts
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { splitBasmala } from '../src/utils/basmala';
import {
  PRINTED_JUZ_START_PAGES,
  PRINTED_HIZB_START_PAGES,
  printedAyahPage,
} from '../src/data/mushafPrinted';

/** Reference font size the width table was measured at. */
const REF_PX = 100;

/**
 * Column width as a multiple of the font size: 1820px at the 100px reference.
 *
 * Calibrated, not guessed. The printed mushaf gives a number we cannot otherwise get —
 * 604 pages of 15 lines — so the column was swept over the real text and the width that
 * reproduces that page count was taken:
 *
 *     17.4em -> 629 pages, 8.47 words/line
 *     18.2em -> 601 pages, 8.87 words/line   <- chosen
 *     19.0em -> ~575 pages, 9.3  words/line
 *
 * 18.2em lands within 0.5% of the printed page count while keeping a line at 8-9 words,
 * which is where a mushaf line sits, and leaves justification only a few percent of slack
 * to absorb. Changing this moves every page boundary in the app, so it stays a deliberate,
 * visible edit — and `check:flow` fails loudly if the page count drifts.
 */
const COLUMN_EM = Number(process.env.COL_EM ?? '18.2');

/** Lines per page. The printed Madani mushaf is 15. */
export const LINES_PER_PAGE = 15;

/**
 * Room reserved for an ayah-end marker, in em.
 *
 * The marker is a drawn ring, not glyphs, so it cannot be measured from the font. 1.15em
 * is the ring plus its side margins at the size the reader draws it. It must be reserved
 * once per ayah on the line, or lines holding several ayah ends overflow and get clipped.
 */
const AYAH_MARK_EM = Number(process.env.MARK_EM ?? '1.15');

const ROOT = process.cwd();
const WIDTHS_PATH = join(ROOT, 'build', 'word-widths.json');
const QURAN_PATH = join(ROOT, 'src', 'data', 'quran-full.json');
const SURAHS_PATH = join(ROOT, 'src', 'data', 'surahs.ts');
const OUT_PATH = join(ROOT, 'src', 'data', 'mushafFlow.ts');

function fail(message: string): never {
  console.error(`\n  ERROR  ${message}\n`);
  process.exit(1);
}

if (!existsSync(WIDTHS_PATH)) {
  fail(`missing ${WIDTHS_PATH}\n  run: node scripts/measure-word-widths.mjs`);
}

const widthTable = JSON.parse(readFileSync(WIDTHS_PATH, 'utf8')) as {
  refPx: number;
  spaceWidth: number;
  wordCount: number;
  uniqueWords: number;
  widths: Record<string, number>;
};
const quran = JSON.parse(readFileSync(QURAN_PATH, 'utf8')) as Record<string, string[]>;

/**
 * Surah display names, read straight out of the metadata module.
 *
 * Parsed rather than imported because `surahs.ts` reads the page map this script
 * produces; executing it here would be a cycle. Parsing the literal is safe because the
 * generator fails loudly if it cannot find all 114.
 */
function readSurahNames(): Map<number, string> {
  const src = readFileSync(SURAHS_PATH, 'utf8');
  const names = new Map<number, string>();
  for (const m of src.matchAll(/\bid:\s*(\d+),[\s\S]{0,400}?\bname:\s*'([^']+)'/g)) {
    names.set(Number(m[1]), m[2]);
  }
  return names;
}

const surahNames = readSurahNames();
const surahIds = Object.keys(quran).map(Number).sort((a, b) => a - b);
if (surahIds.length !== 114) fail(`expected 114 surahs in the text, found ${surahIds.length}`);
for (const id of surahIds) if (!surahNames.has(id)) fail(`no display name found for surah ${id}`);

const REF_COL = COLUMN_EM * REF_PX;
const SPACE = widthTable.spaceWidth;
const MARK = AYAH_MARK_EM * REF_PX;

const KIND_TEXT = 0;
const KIND_HEADING = 1;
const KIND_BASMALA = 2;

interface Line {
  kind: number;
  surahId: number;
  /** Words on the line. Heading lines hold the surah name; basmala lines the four words. */
  count: number;
}

/** Word index (into a surah's combined word list) where each ayah begins. */
const ayahWordStart: number[] = [];
const surahFirstLine: number[] = [];
const surahFirstAyah: number[] = [];
const lines: Line[] = [];

let unknownWords = 0;
let wordsPlaced = 0;

function wordWidth(word: string): number {
  const w = widthTable.widths[word];
  if (w === undefined) {
    unknownWords++;
    return 0;
  }
  wordsPlaced++;
  return w;
}

for (const surahId of surahIds) {
  const ayahs = quran[String(surahId)];
  surahFirstLine.push(lines.length);
  surahFirstAyah.push(ayahWordStart.length);

  // A printed page opens with the surah name on a line of its own.
  lines.push({ kind: KIND_HEADING, surahId, count: 1 });

  // The surah's word list: the basmala first when it gets its own line, then every ayah's
  // words in order. Text lines index into this, so the runtime can rebuild it by
  // concatenating the same pieces.
  const words: string[] = [];
  const isAyahStart: number[] = []; // word indices at which a new ayah begins

  const first = splitBasmala(ayahs[0] ?? '');
  const basmalaIsItsOwnLine = first.basmala !== null && first.rest.length > 0;

  if (basmalaIsItsOwnLine) {
    for (const w of first.basmala!.split(' ').filter(Boolean)) words.push(w);
    lines.push({ kind: KIND_BASMALA, surahId, count: words.length });
    isAyahStart.push(words.length);
  } else if (!first.basmala) {
    isAyahStart.push(0);
  } else {
    isAyahStart.push(0);
  }

  const pushAyah = (text: string) => {
    for (const w of text.split(' ').filter(Boolean)) words.push(w);
  };

  pushAyah(basmalaIsItsOwnLine ? first.rest : (ayahs[0] ?? ''));
  for (let i = 1; i < ayahs.length; i++) {
    isAyahStart.push(words.length);
    pushAyah(ayahs[i]);
  }

  ayahWordStart.push(...isAyahStart);

  // Greedy fill. `width` is everything the line has committed to — word ink, the spaces
  // between words, and the markers of any ayah that ended on it. The next word has to fit
  // with its own trailing marker, since a word that ends an ayah brings a mark with it.
  const ayahStarts = new Set(isAyahStart);

  let width = 0;
  let count = 0;

  for (let i = 0; i < words.length; i++) {
    const w = wordWidth(words[i]);
    const endsAyah = i + 1 === words.length || ayahStarts.has(i + 1);
    const need = (count === 0 ? 0 : SPACE) + w + (endsAyah ? MARK : 0);

    if (count > 0 && width + need > REF_COL) {
      lines.push({ kind: KIND_TEXT, surahId, count });
      width = need;
      count = 1;
    } else {
      width += need;
      count++;
    }
  }
  if (count > 0) lines.push({ kind: KIND_TEXT, surahId, count });
}

if (unknownWords > 0) {
  fail(`${unknownWords} words were missing from the width table — re-run measure-word-widths.mjs`);
}

// ---- pages ----------------------------------------------------------------------------
// 15 lines each, with one rule on top: a surah heading must never sit at the foot of a page
// with nothing under it. Two or three lines of nothing beneath a heading read as though
// the heading belonged to the surah above, so the page above gives up a line and the
// heading moves down.
//
// That is why pages are not simply `lineIndex / 15`: a page that yields a line has 14 on
// it. The line counts are stored per page instead, which costs one varint per page.

const pageOfLine: number[] = new Array(lines.length);
const pageLineCount: number[] = [];

for (let i = 0; i < lines.length; ) {
  let take = Math.min(LINES_PER_PAGE, lines.length - i);

  const lastHeading = (() => {
    for (let k = take - 1; k >= 0; k--) if (lines[i + k].kind === KIND_HEADING) return k;
    return -1;
  })();

  if (lastHeading >= 0 && take - lastHeading < 3) {
    // Room for the heading plus two lines under it, unless that needs more than a page —
    // then the heading goes down to the next page instead.
    take = lastHeading + 3 <= LINES_PER_PAGE ? lastHeading + 3 : lastHeading;
  }
  if (take < 1) take = 1;

  for (let k = i; k < i + take; k++) pageOfLine[k] = pageLineCount.length;
  pageLineCount.push(take);
  i += take;
}

const pageCount = pageLineCount.length;

// ---- ayah -> page ---------------------------------------------------------------------
// Everything else in the app labels itself with a page — surah lists, juz starts, sajda
// markers, memorisation tasks — so they all have to read the same answer.

const ayahPage: number[] = [];
for (let s = 0; s < surahIds.length; s++) {
  const surahId = surahIds[s];
  // `surahFirstLine` already holds the first line of each surah. Building it again here by
  // overwriting a Map would silently yield the *last* line of each surah, which puts every
  // ayah of a surah on the page of its final line.
  const start = surahFirstLine[s];
  const end = surahFirstLine[s + 1] ?? lines.length;

  // Text lines of a surah are contiguous and in order, so their word offsets are the
  // running sum of their counts, starting past the basmala.
  const lineWordStart = new Map<number, number>();
  let cursor = 0;
  for (let i = start; i < end; i++) {
    if (lines[i].kind === KIND_BASMALA) cursor = lines[i].count;
    else if (lines[i].kind === KIND_TEXT) {
      lineWordStart.set(i, cursor);
      cursor += lines[i].count;
    }
  }

  const base = surahFirstAyah[s];
  for (let a = 0; a < quran[String(surahId)].length; a++) {
    const wordAt = ayahWordStart[base + a];
    // An ayah is on the page of the line holding its first word; if that word is in the
    // basmala or the heading, fall back to the surah's opening page.
    let page = pageOfLine[start] + 1;
    for (let i = start; i < end; i++) {
      const from = lineWordStart.get(i);
      if (from === undefined) continue;
      if (from <= wordAt) page = pageOfLine[i] + 1;
      else break;
    }
    ayahPage.push(page);
  }
}

// ---- juz and hizb boundaries in flow pages ---------------------------------------------
// A juz boundary is a fact about the text ("Al-Baqarah 143 opens juz 3"); where it lands in
// the pagination is ours. So the printed boundary is resolved to the ayah it opens, and that
// ayah's flow page becomes the boundary here. Same for hizbs.

function flowBoundaryAtPrintedPage(printedPage: number): number {
  for (const surahId of surahIds) {
    const ayahs = quran[String(surahId)];
    for (let a = 1; a <= ayahs.length; a++) {
      if (printedAyahPage(surahId, a, ayahs.length) >= printedPage) {
        return ayahPage[surahFirstAyah[surahId - 1] + a - 1];
      }
    }
  }
  return pageCount;
}

const flowJuzStart = PRINTED_JUZ_START_PAGES.map(flowBoundaryAtPrintedPage);
const flowHizbStart = Object.fromEntries(
  Object.entries(PRINTED_HIZB_START_PAGES).map(([hizb, page]) => [hizb, flowBoundaryAtPrintedPage(page)]),
);

// ---- encode ----------------------------------------------------------------------------
// One byte per line: kind in bits 7-6, word count in bits 4-0. A count of 31 is an escape
// meaning "the real count follows as a varint", which keeps the common case (5-15 words)
// at one byte and the whole table near 10 KB.

const lineBytes: number[] = [];
for (const l of lines) {
  if (l.count < 31) {
    lineBytes.push((l.kind << 6) | l.count);
  } else {
    lineBytes.push((l.kind << 6) | 31);
    let v = l.count - 31;
    while (v >= 0x80) {
      lineBytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    lineBytes.push(v);
  }
}

const b64 = (bytes: number[] | number[]) =>
  Buffer.from(Uint8Array.from(bytes as number[])).toString('base64');

function deltaVarint(values: number[]): number[] {
  const out: number[] = [];
  let prev = 1;
  for (const v of values) {
    let d = v - prev;
    if (d < 0) d = 0; // pages only move forward; clamp rather than encode a negative
    prev = v;
    while (d >= 0x80) {
      out.push((d & 0x7f) | 0x80);
      d = Math.floor(d / 128);
    }
    out.push(d);
  }
  return out;
}

const out = `// Generated by scripts/build-mushaf-flow.ts — do not edit by hand.
//
// Regenerate with:
//   node scripts/measure-word-widths.mjs && npx tsx scripts/build-mushaf-flow.ts
//
// npm run check:flow re-derives the page count and the invariants from the source text,
// so this table cannot drift away from the Quran it was built from.

/** Lines per page. The printed Madani mushaf is 15. */
export const LINES_PER_PAGE = ${LINES_PER_PAGE};

/** Column width in em — the measure these line breaks were computed against. */
export const COLUMN_EM = ${COLUMN_EM};

/** Font size the width table behind these breaks was measured at. */
export const REFERENCE_PX = ${REF_PX};

/** Pages in the mushaf. The printed one has 604; see check:flow. */
export const TOTAL_PAGES = ${pageCount};

/** Lines across the whole mushaf. */
export const TOTAL_LINES = ${lines.length};

/** Words placed. Equals the word count of the source text. */
export const TOTAL_WORDS = ${wordsPlaced};

/** Lines on each page. Mostly 15; 14 where a surah heading needed room. */
const PAGE_LINE_COUNT = decodeVarint('${b64(pageLineCount.map((n) => n - 1))}', ${pageLineCount.length}).map(
  (n) => n + 1,
);

/** First line of each page. */
const PAGE_FIRST_LINE = (() => {
  const out: number[] = [];
  let at = 0;
  for (const n of PAGE_LINE_COUNT) {
    out.push(at);
    at += n;
  }
  return out;
})();

/**
 * Flow page on which each juz begins.
 *
 * Which juz an ayah belongs to is a fact about the printed mushaf and does not depend on
 * how we lay the text out; where that juz lands in our pagination does. So each printed
 * boundary is resolved to the ayah it opens and that ayah's flow page is used.
 */
export const JUZ_START_PAGES: readonly number[] = ${JSON.stringify(flowJuzStart)};

/** Flow page on which each hizb begins, keyed by hizb number. */
export const HIZB_START_PAGES: Record<number, number> = ${JSON.stringify(flowHizbStart)};

/** First line of each surah, in surah order (index 0 is surah 1). */
const SURAH_FIRST_LINE = ${JSON.stringify(surahFirstLine)};

/** Index of each surah's first ayah within AYAH_PAGE, in surah order. */
const SURAH_FIRST_AYA = ${JSON.stringify(surahFirstAyah)};

/** Per line: kind in bits 7-6, word count in bits 4-0, 31 = varint count follows. */
const LINE_BYTES = decodeBase64('${b64(lineBytes)}');

/** Page per ayah, delta-encoded from 1. */
const AYAH_PAGE = decodeDeltaVarint('${b64(deltaVarint(ayahPage))}', ${ayahPage.length});

const KIND_NAMES = ['text', 'heading', 'basmala'] as const;

/** Browser and Node both have atob; kept in one place so a missing global fails once. */
function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeVarint(value: string, count: number): number[] {
  const bytes = decodeBase64(value);
  const out = new Array<number>(count);
  let i = 0;
  for (let n = 0; n < count; n++) {
    let v = 0;
    let shift = 1;
    for (;;) {
      const b = bytes[i++];
      v += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) break;
      shift *= 128;
    }
    out[n] = v;
  }
  return out;
}

function decodeDeltaVarint(value: string, count: number): number[] {
  const bytes = decodeBase64(value);
  const out = new Array<number>(count);
  let prev = 1;
  let i = 0;
  for (let n = 0; n < count; n++) {
    let delta = 0;
    let shift = 1;
    for (;;) {
      const b = bytes[i++];
      delta += (b & 0x7f) * shift;
      if ((b & 0x80) === 0) break;
      shift *= 128;
    }
    prev += delta;
    out[n] = prev;
  }
  return out;
}

export type LineKind = (typeof KIND_NAMES)[number];

export interface FlowLine {
  kind: LineKind;
  surahId: number;
  /** Words on the line. A heading holds one (the surah name); a basmala line four. */
  count: number;
  /**
   * Word offset of the line inside its surah's word list.
   *
   * A surah's word list is its basmala (when it gets its own line) followed by every
   * ayah's words in order. Lines of a surah are contiguous and in order, so this is the
   * running sum of the counts — no need to store it.
   */
  from: number;
}

function surahIdOfLine(index: number): number {
  let lo = 0;
  let hi = SURAH_FIRST_LINE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (SURAH_FIRST_LINE[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const FLOW_LINES: FlowLine[] = (() => {
  const out: FlowLine[] = [];
  let i = 0;
  for (let n = 0; n < TOTAL_LINES; n++) {
    const b = LINE_BYTES[i++];
    const kind = KIND_NAMES[b >> 6];
    let count = b & 0x1f;
    if (count === 31) {
      let v = 0;
      let shift = 1;
      for (;;) {
        const x = LINE_BYTES[i++];
        v += (x & 0x7f) * shift;
        if ((x & 0x80) === 0) break;
        shift *= 128;
      }
      count = v + 31;
    }
    out.push({ kind, surahId: surahIdOfLine(n), count, from: 0 });
  }

  // Fill in the word offsets, walking each surah's block.
  let cursor = 0;
  for (let n = 0; n < out.length; n++) {
    if (n === SURAH_FIRST_LINE[out[n].surahId - 1]) cursor = 0;
    if (out[n].kind === 'basmala') {
      out[n].from = 0;
      cursor = out[n].count;
    } else if (out[n].kind === 'text') {
      out[n].from = cursor;
      cursor += out[n].count;
    } else {
      out[n].from = 0;
    }
  }
  return out;
})();

/** Line at a 0-based index in reading order. */
export function getFlowLine(index: number): FlowLine | undefined {
  return FLOW_LINES[index];
}

/** Lines on a 1-based page, in order. */
export function getPageLines(page: number): FlowLine[] {
  const start = PAGE_FIRST_LINE[page - 1];
  if (start === undefined) return [];
  return FLOW_LINES.slice(start, start + PAGE_LINE_COUNT[page - 1]);
}

/** How many lines are on a 1-based page. */
export function getPageLineCount(page: number): number {
  return PAGE_LINE_COUNT[page - 1] ?? 0;
}

/**
 * 1-based page holding a 0-based line.
 *
 * Binary search over the page starts rather than \`floor(line / 15)\`: a page that gave up a
 * line to keep a surah heading off its foot breaks that arithmetic, and the mushaf has 14
 * of those.
 */
export function getPageOfLine(index: number): number {
  let lo = 0;
  let hi = PAGE_FIRST_LINE.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (PAGE_FIRST_LINE[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Page holding an ayah, 1-based.
 *
 * The single answer every part of the app needs: surah lists print "صفحة N", juz starts
 * are found by looking up their first ayah, sajda markers and memorisation tasks all label
 * themselves from here. One table, so they cannot disagree.
 */
export function getAyahFlowPage(surahId: number, ayahNumber: number): number {
  const base = SURAH_FIRST_AYA[surahId - 1];
  if (base === undefined) return 1;
  return AYAH_PAGE[base + ayahNumber - 1] ?? 1;
}

/** Surahs that start or continue on a 1-based page, in reading order. */
export function getSurahsOnPage(page: number): number[] {
  const linesOnPage = getPageLines(page);
  const ids: number[] = [];
  for (const line of linesOnPage) if (!ids.includes(line.surahId)) ids.push(line.surahId);
  return ids;
}
`;

writeFileSync(OUT_PATH, out);

const textLines = lines.filter((l) => l.kind === KIND_TEXT);
const counts = textLines.map((l) => l.count);
const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
const median = [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)];

console.log(`column        ${COLUMN_EM}em (${REF_COL}px @ ${REF_PX}px)`);
console.log(`words placed  ${wordsPlaced.toLocaleString('en-US')} of ${widthTable.wordCount.toLocaleString('en-US')}`);
console.log(`lines         ${lines.length.toLocaleString('en-US')} (${lines.filter((l) => l.kind === KIND_HEADING).length} headings, ${lines.filter((l) => l.kind === KIND_BASMALA).length} basmalas)`);
console.log(`pages         ${pageCount}  (printed mushaf: 604)`);
console.log(`words/line    mean ${mean.toFixed(2)}  median ${median}  max ${Math.max(...counts)}`);
console.log(`ayah entries  ${ayahPage.length.toLocaleString('en-US')} (expect 6236)`);
console.log(`data size     lines ${(b64(lineBytes).length / 1024).toFixed(1)} KiB, ayah pages ${(b64(deltaVarint(ayahPage)).length / 1024).toFixed(1)} KiB`);
console.log(`\nwrote ${OUT_PATH}`);