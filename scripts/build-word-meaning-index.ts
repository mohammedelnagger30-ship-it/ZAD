import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { alignAyahMeanings } from '../src/utils/wordMeaningsService';
import { getAyah } from '../src/data/quranText';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = join(ROOT, '.cache', 'content', 'meanings.json.gz');
if (!existsSync(DUMP)) { console.error('missing dump'); process.exit(1); }

const dump = JSON.parse(gunzipSync(readFileSync(DUMP)).toString('utf8')) as {
  data: Array<{ surah: number; ayah: number; meanings: Array<{ book_info: { id: number }; words: Array<{ text: string; meaning: string }> }> }>;
};

const index: Record<string, number[]> = {};
for (const entry of dump.data) {
  const text = getAyah(entry.surah, entry.ayah)?.text;
  if (!text) continue;
  const stored = { ayah: entry.ayah, meanings: entry.meanings.map((b) => ({ book: b.book_info.id, words: b.words })) };
  const hits = alignAyahMeanings(text, stored);
  const set = new Set(hits.map((h) => h.wordIndex));
  if (set.size === 0) continue;
  index[`${entry.surah}:${entry.ayah}`] = [...set].sort((a, b) => a - b);
}

const outPath = join(ROOT, 'public', 'word-meaning-index.json');
writeFileSync(outPath, JSON.stringify(index));
console.log('entries:', Object.keys(index).length);
console.log('written:', outPath);
