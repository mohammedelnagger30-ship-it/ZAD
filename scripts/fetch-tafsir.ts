/**
 * Fills the local content cache with tafsir payloads so `npm run data:catalog` can measure
 * real sizes.
 *
 * This script is a development tool only. It does NOT put content into `src/` and the app
 * does not depend on it: tafsir is downloaded by the user at runtime from the same upstream
 * files and stored on the device (see `src/utils/tafsirService.ts`). An earlier version of
 * this script wrote ~316 MB into `src/data/`, which made a build impossible — nothing that
 * large belongs in a bundle, and the whole point of the download manager is that the user
 * chooses what to keep on their device.
 *
 *   npm run data:tafsir                 # all eight editions
 *   npm run data:tafsir -- muyassar     # one edition
 *   npm run data:tafsir -- ibn-kathir baghawi
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cache', 'content', 'tafsir');

mkdirSync(CACHE_DIR, { recursive: true });

const BASE = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir';
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

/** The editions the app offers, matching `src/data/contentCatalog.ts`. */
const EDITIONS = [
  { slug: 'ar-tafsir-muyassar', titleAr: 'التفسير الميسر' },
  { slug: 'ar-tafsir-al-jalalayn', titleAr: 'تفسير الجلالين' },
  { slug: 'ar-tafsir-al-wasit', titleAr: 'التفسير الوسيط' },
  { slug: 'ar-tafsir-as-saadi', titleAr: 'تفسير السعدي' },
  { slug: 'ar-tafsir-al-baghawi', titleAr: 'معالم التنزيل (البغوي)' },
  { slug: 'ar-tafseer-al-qurtubi', titleAr: 'الجامع لأحكام القرآن (القرطبي)' },
  { slug: 'ar-tafsir-al-tabari', titleAr: 'جامع البيان (الطبري)' },
  { slug: 'ar-tafsir-ibn-kathir', titleAr: 'تفسير ابن كثير' },
];

const requested = process.argv.slice(2);
const wanted =
  requested.length > 0
    ? EDITIONS.filter((e) =>
        requested.some(
          (r) => e.slug.includes(r) || e.titleAr.includes(r) || r === e.slug,
        ),
      )
    : EDITIONS;

if (wanted.length === 0) {
  console.error(`No tafsir matched: ${requested.join(', ')}`);
  console.error(`Available: ${EDITIONS.map((e) => e.slug).join(', ')}`);
  process.exit(1);
}

async function fetchToCache(name: string, url: string): Promise<string> {
  const cached = join(CACHE_DIR, name);
  if (existsSync(cached) && statSync(cached).size > 0) {
    return readFileSync(cached, 'utf8');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const text = await res.text();
  if (text.trim().length < 20) throw new Error(`suspiciously small response from ${url}`);
  writeFileSync(cached, text, 'utf8');
  return text;
}

for (const edition of wanted) {
  console.log(`\n== ${edition.titleAr} (${edition.slug}) ==`);

  const cachedNow: string[] = [];
  const missing: number[] = [];
  for (let surah = 1; surah <= 114; surah++) {
    const target = join(CACHE_DIR, `${edition.slug}-${surah}.json`);
    if (existsSync(target) && statSync(target).size > 0) cachedNow.push(`${edition.slug}-${surah}.json`);
    else missing.push(surah);
  }

  // A few at a time: Al-Baqarah alone is 6 MB in the big tafsirs, so firing 114 requests
  // at once is a good way to get rate-limited.
  const CONCURRENCY = 4;
  const missingSurahs: number[] = [];

  for (let start = 0; start < missing.length; start += CONCURRENCY) {
    const batch = missing.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(async (surah) => {
        try {
          await fetchToCache(`${edition.slug}-${surah}.json`, `${BASE}/${edition.slug}/${surah}.json`);
        } catch {
          missingSurahs.push(surah);
        }
      }),
    );
    if (start % 20 === 0 || start + CONCURRENCY >= missing.length) {
      process.stdout.write(`  ${Math.min(start + CONCURRENCY, missing.length)}/${missing.length} surahs\n`);
    }
  }

  const onDisk = readdirSync(CACHE_DIR).filter((f) => f.startsWith(`${edition.slug}-`));
  let totalBytes = 0;
  let totalAyahs = 0;
  for (const file of onDisk) {
    totalBytes += statSync(join(CACHE_DIR, file)).size;
    try {
      const parsed = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8'));
      if (Array.isArray(parsed)) totalAyahs += parsed.length;
    } catch {
      // A corrupt cache entry is re-fetched on the next run; do not fail the whole edition.
    }
  }

  console.log(
    `  cached ${onDisk.length}/114 surahs, ${totalAyahs} ayahs, ${mb(totalBytes)}` +
      (missingSurahs.length > 0 ? `, unavailable in source: ${missingSurahs.join(', ')}` : ''),
  );
}

console.log('\nCache filled. Run `npm run data:catalog` to refresh the measured sizes.');