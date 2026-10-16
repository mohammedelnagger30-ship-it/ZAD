/**
 * One-off: coverage of the *real* `alignAyahMeanings` against the real dump.
 *
 * Reports how many (word, book) pairs the sheet can actually answer, over the whole
 * Quran, plus how long a lookup takes.
 *
 * Run: npx tsx scripts/measure-word-meanings.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { alignAyahMeanings } from '../src/utils/wordMeaningsService';
import { WORD_MEANINGS } from '../src/data/contentCatalog';
import { getAyah } from '../src/data/quranText';
import { splitBasmala } from '../src/utils/basmala';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = join(ROOT, '.cache', 'content', 'meanings.json.gz');
if (!existsSync(DUMP)) process.exit(1);

interface StoredAyah {
  ayah: number;
  meanings: Array<{ book: number; words: Array<{ text: string; meaning: string }> }>;
}

const dump = JSON.parse(gunzipSync(readFileSync(DUMP)).toString('utf8')) as {
  data: Array<{
    surah: number;
    ayah: number;
    meanings: Array<{ book_info: { id: number }; words: Array<{ text: string; meaning: string }> }>;
  }>;
};

const books = WORD_MEANINGS.books.map((b) => b.id);
let wordBookTotal = 0;
let wordBookCovered = 0;
let ayahWordTotal = 0;
let ayahWordCovered = 0;
let ayahs = 0;
let ayahsWithNothing = 0;
let missingAyahText = 0;
const perBook = new Map<number, { total: number; covered: number }>();
const noTextSamples: string[] = [];

const started = Date.now();
for (const entry of dump.data) {
  const text = getAyah(entry.surah, entry.ayah)?.text;
  if (!text) {
    missingAyahText++;
    if (noTextSamples.length < 5) noTextSamples.push(`${entry.surah}:${entry.ayah}`);
    continue;
  }
  const stored: StoredAyah = {
    ayah: entry.ayah,
    meanings: entry.meanings.map((b) => ({ book: b.book_info.id, words: b.words })),
  };

  const hits = alignAyahMeanings(text, stored);
  const covered = new Map<number, Set<number>>();
  for (const hit of hits) {
    const set = covered.get(hit.wordIndex) ?? new Set<number>();
    set.add(hit.book);
    covered.set(hit.wordIndex, set);
  }

  // The reader lifts the basmala out of ayah 1, and word positions are counted on
  // what is left — so the metric has to count the same words.
  const { rest } = splitBasmala(text);
  const words = (rest || text).split(/\s+/).filter(Boolean).length;
  ayahs++;
  for (let w = 0; w < words; w++) {
    ayahWordTotal++;
    const here = covered.get(w) ?? new Set<number>();
    if (here.size > 0) ayahWordCovered++;
    for (const book of books) {
      wordBookTotal++;
      const row = perBook.get(book) ?? { total: 0, covered: 0 };
      row.total++;
      if (here.has(book)) {
        row.covered++;
        wordBookCovered++;
      }
      perBook.set(book, row);
    }
  }
  if (covered.size === 0) ayahsWithNothing++;
}
const elapsed = Date.now() - started;

const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(2)}%`;

console.log(`entries=${dump.data.length} matched-ayahs=${ayahs} missing-ayah-text=${missingAyahText} ${noTextSamples.join(' ')}`);
console.log(`word x book  : ${pct(wordBookCovered, wordBookTotal)}  ${wordBookCovered}/${wordBookTotal}`);
console.log(`word (any)   : ${pct(ayahWordCovered, ayahWordTotal)}  ${ayahWordCovered}/${ayahWordTotal}`);
console.log(`ayat with no gloss at all: ${ayahsWithNothing}/${ayahs}`);
console.log('\nper book:');
for (const [id, row] of [...perBook].sort((a, b) => a[0] - b[0])) {
  const meta = WORD_MEANINGS.books.find((b) => b.id === id);
  console.log(`  ${String(id).padStart(5)} ${(meta?.titleAr ?? '').padEnd(30)} ${pct(row.covered, row.total)} ${row.covered}/${row.total}`);
}
console.log(`\n${elapsed} ms for ${ayahs} ayahs (${(elapsed / Math.max(1, ayahs)).toFixed(3)} ms each)`);

// A handful of concrete lookups, printed so the result can be eyeballed.
const samples: Array<[number, number]> = [
  [1, 2], // Al-Fatihah: رَبِّ | الْعَالَمِينَ only
  [10, 5], // the dropped-conjunction case (وَقَدَّرَهُۥ vs قدّره منازل)
  [113, 1], // basmala-lifted ayah 1
  [2, 255],
];
console.log('\nsamples:');
for (const [surah, ayah] of samples) {
  const text = getAyah(surah, ayah)?.text ?? '';
  const stored: StoredAyah = {
    ayah,
    meanings: (dump.data.find((d) => d.surah === surah && d.ayah === ayah)?.meanings ?? []).map((b) => ({
      book: b.book_info.id,
      words: b.words,
    })),
  };
  const shown = (splitBasmala(text).rest || text).split(/\s+/).filter(Boolean);
  const hits = alignAyahMeanings(text, stored);
  console.log(`\n  ${surah}:${ayah}  words=[${shown.join(' ')}]`);
  for (const hit of hits) {
    console.log(
      `    word ${hit.wordIndex + 1} «${shown[hit.wordIndex]}» [${hit.book}] «${hit.gloss.text}» = ${hit.gloss.meaning}`,
    );
  }
  if (hits.length === 0) console.log('    (no glosses aligned)');
}
