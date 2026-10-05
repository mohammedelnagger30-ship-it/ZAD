/**
 * Downloads the Quran text and hadith collections and writes them into `src/data/`.
 *
 * Run with `npm run data:quran`. The generated files are committed, so the app never
 * needs the network to build or to run — this script only exists to refresh the data.
 *
 * Sources (both permit redistribution; see ATTRIBUTION.md):
 *   - Quran text : Tanzil, Uthmani text with agreeing variant markers removed.
 *   - Hadith     : fawazahmed0/hadith-api, the six canonical collections plus
 *                  Nawawi's 40, Riyad as-Salihin and Qudsi.
 */
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'src', 'data');
const CACHE_DIR = join(ROOT, '.cache', 'content');

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'hifzi-offline-content/1.0 (bundled Quran + hadith data generator)';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/** Downloads to the cache dir, so a re-run does not re-hit the network. */
async function fetchCached(name: string, url: string): Promise<string> {
  const cached = join(CACHE_DIR, name);
  if (existsSync(cached) && statSync(cached).size > 0) {
    console.log(`  cached  ${name}  (${mb(statSync(cached).size)})`);
    return await import('node:fs').then((fs) => fs.promises.readFile(cached, 'utf8'));
  }
  console.log(`  fetch   ${name}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  if (text.trim().length < 100) throw new Error(`suspiciously small response for ${url}`);
  writeFileSync(cached, text, 'utf8');
  console.log(`          -> ${mb(Buffer.byteLength(text))}`);
  return text;
}

// ---------------------------------------------------------------------------
// Quran text
// ---------------------------------------------------------------------------

const QURAN_URL =
  'https://tanzil.net/pub/download/index.php?quranType=uthmani&outType=txt-2&agree=true';

async function buildQuranText() {
  console.log('\n== Quran text (Tanzil, Uthmani) ==');
  const raw = await fetchCached('quran-uthmani.txt', QURAN_URL);

  // Lines look like "surah|ayah|text"; anything else is a comment banner.
  const perSurah = new Map<number, string[]>();
  let skipped = 0;
  for (const line of raw.split(/\r?\n/)) {
    const m = /^(\d+)\|(\d+)\|(.+)$/.exec(line.trim());
    if (!m) {
      if (line.trim()) skipped++;
      continue;
    }
    const surah = Number(m[1]);
    const text = m[3].trim();
    const list = perSurah.get(surah) ?? [];
    // Tanzil's txt-2 already excludes the basmala except in Al-Fatihah (1:1).
    list.push(text);
    perSurah.set(surah, list);
  }

  if (perSurah.size !== 114) throw new Error(`expected 114 surahs, got ${perSurah.size}`);
  const total = [...perSurah.values()].reduce((a, l) => a + l.length, 0);
  if (total !== 6236) throw new Error(`expected 6236 ayahs, got ${total}`);
  console.log(`  114 surahs, ${total} ayahs, ${skipped} non-data lines skipped`);

  // Emit as one module keyed by surah so the reader can look a surah up synchronously.
  const json = JSON.stringify(Object.fromEntries(perSurah));
  writeFileSync(join(DATA_DIR, 'quran-full.json'), json, 'utf8');
  console.log(`  wrote src/data/quran-full.json (${mb(Buffer.byteLength(json))})`);

  return perSurah;
}

// ---------------------------------------------------------------------------
// Hadith
// ---------------------------------------------------------------------------

/**
 * The collections offered in the app.
 *
 * Only nine of the twelve collections the old catalogue listed actually exist in this
 * source: the six canonical books plus Malik's Muwatta, Nawawi's Forty and Qudsi's Forty.
 * Riyad as-Salihin, Bulugh al-Maram, Al-Adab al-Mufrad and Sunan ad-Darimi are not
 * published there, so they are not offered rather than offered-and-broken.
 */
const HADITH_SOURCES = [
  { slug: 'ara-nawawi', titleAr: 'الأربعون النووية' },
  { slug: 'ara-qudsi', titleAr: 'الأربعون القادرية' },
  { slug: 'ara-malik', titleAr: 'موطأ مالك' },
  { slug: 'ara-ibnmajah', titleAr: 'سنن ابن ماجه' },
  { slug: 'ara-tirmidhi', titleAr: 'جامع الترمذي' },
  { slug: 'ara-nasai', titleAr: 'سنن النسائي' },
  { slug: 'ara-abudawud', titleAr: 'سنن أبي داود' },
  { slug: 'ara-muslim', titleAr: 'صحيح مسلم' },
  { slug: 'ara-bukhari', titleAr: 'صحيح البخاري' },
] as const;

interface RawHadith {
  hadithnumber?: number;
  text?: string;
  arabic?: string;
  reference?: { book?: number; hadith?: number };
}

interface RawCollection {
  metadata?: { sections?: Record<string, string> };
  hadiths?: RawHadith[];
}

/**
 * Fetches the collections into `.cache/` purely so their real sizes can be measured by
 * `npm run data:catalog`.
 *
 * Nothing is written to `src/`: hadith is far too large to bundle (46 MB for all nine) and
 * the app downloads it per collection on the user's device at runtime.
 */
async function cacheHadith() {
  console.log('\n== Hadith collections (cached for measurement only) ==');

  for (const src of HADITH_SOURCES) {
    const url = `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${src.slug}.json`;
    const name = `hadith-${src.slug}.json`;
    try {
      const raw = await fetchCached(name, url);
      const parsed = JSON.parse(raw) as RawCollection | RawHadith[];
      const list = Array.isArray(parsed) ? parsed : (parsed.hadiths ?? []);

      // Count what the app will actually keep, so the catalogue matches the UI.
      const usable = list.filter((h) => (h.text ?? h.arabic ?? '').trim()).length;
      const sections = new Set(list.map((h) => h.reference?.book ?? 0));

      console.log(
        `  ${src.slug.padEnd(16)} ${String(usable).padStart(5)} hadiths  ` +
          `${String(sections.size).padStart(3)} sections  ${mb(Buffer.byteLength(raw))}`,
      );
    } catch (err) {
      console.log(`  SKIP ${src.slug}: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  await buildQuranText();
  await cacheHadith();
  console.log(
    '\nQuran text written to src/data/quran-full.json (bundled).\n' +
      'Hadith cached for measurement only — run `npm run data:catalog` next.',
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
});