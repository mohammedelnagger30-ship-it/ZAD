/**
 * Generates `src/data/contentCatalog.ts` from the raw downloads in `.cache/content/`.
 *
 * Every number in the catalogue is *measured*, not guessed: the download sizes come from
 * the size of the upstream files that are actually fetched at runtime, and the tafsir
 * per-surah sizes come from the real per-surah payloads. That is what lets the app warn
 * "this surah will take 4 MB" instead of quoting a figure invented in a comment.
 *
 * Run after `npm run data:fetch` / `npm run data:tafsir`:
 *   npm run data:catalog
 */
import { statSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'content');
const TAFSIR_CACHE = join(CACHE, 'tafsir');
const OUT = join(ROOT, 'src', 'data', 'contentCatalog.ts');

/** Maps the app's existing collection ids onto the upstream file slugs. */
const HADITH = [
  { id: 'arbaeen_nawawi', slug: 'ara-nawawi', titleAr: 'الأربعون النووية', author: 'الإمام يحيى بن شرف النووي' },
  { id: 'forty_qudsi', slug: 'ara-qudsi', titleAr: 'الأربعون القدسية', author: 'غير مذكور في بيانات المصدر' },
  { id: 'muwatta_malik', slug: 'ara-malik', titleAr: 'موطأ مالك', author: 'الإمام مالك بن أنس' },
  { id: 'sunan_ibn_majah', slug: 'ara-ibnmajah', titleAr: 'سنن ابن ماجه', author: 'الإمام محمد بن يزيد بن ماجه القزويني' },
  { id: 'jami_tirmidhi', slug: 'ara-tirmidhi', titleAr: 'جامع الترمذي', author: 'الإمام محمد بن عيسى الترمذي' },
  { id: 'sunan_nasai', slug: 'ara-nasai', titleAr: 'سنن النسائي', author: 'الإمام أحمد بن شعيب النسائي' },
  { id: 'sunan_abi_dawud', slug: 'ara-abudawud', titleAr: 'سنن أبي داود', author: 'الإمام سليمان بن الأشعث السجستاني' },
  { id: 'sahih_muslim', slug: 'ara-muslim', titleAr: 'صحيح مسلم', author: 'الإمام مسلم بن الحجاج النيسابوري' },
  { id: 'sahih_bukhari', slug: 'ara-bukhari', titleAr: 'صحيح البخاري', author: 'الإمام محمد بن إسماعيل البخاري' },
] as const;

const TAFSIR = [
  { id: 'muyassar', slug: 'ar-tafsir-muyassar', titleAr: 'التفسير الميسر', authorAr: 'مجموعة من العلماء', blurb: 'مختصر ميسّر يشرح المعنى الإجمالي لكل آية، أنسب للقارئ المبتدئ.' },
  { id: 'jalalayn', slug: 'ar-tafsir-al-jalalayn', titleAr: 'تفسير الجلالين', authorAr: 'المحلّي والسيوطي', blurb: 'مختصر جداً يركّز على المعنى المباشر للآية.' },
  { id: 'wasit', slug: 'ar-tafsir-al-wasit', titleAr: 'التفسير الوسيط', authorAr: 'الشيخ محمد سيد طنطاوي', blurb: 'تفسير معاصر يجمع بين الأصالة ومعالجة قضايا العصر.' },
  { id: 'saadi', slug: 'ar-tafsir-as-saadi', titleAr: 'تفسير السعدي', authorAr: 'الشيخ عبد الرحمن بن ناصر السعدي', blurb: 'موجز، يعتمد على الفوائد العملية والقيم السلوكية.' },
  { id: 'baghawi', slug: 'ar-tafsir-al-baghawi', titleAr: 'معالم التنزيل', authorAr: 'الإمام الحسين بن مسعود البغوي', blurb: 'موجز بالأثر، ينتقي من أقوال السلف.' },
  { id: 'qurtubi', slug: 'ar-tafseer-al-qurtubi', titleAr: 'الجامع لأحكام القرآن', authorAr: 'الإمام محمد بن أحمد القرطبي', blurb: 'تفسير فقهي شامل: الأحكام والقراءات وأسباب النزول.' },
  { id: 'tabari', slug: 'ar-tafsir-al-tabari', titleAr: 'جامع البيان', authorAr: 'الإمام محمد بن جرير الطبري', blurb: 'من أوسع التفاسير وأقدمها، ينقل الأقوال بالإسناد.' },
  { id: 'ibn_kathir', slug: 'ar-tafsir-ibn-kathir', titleAr: 'تفسير ابن كثير', authorAr: 'الإمام إسماعيل بن عمر بن كثير', blurb: 'من أشهر التفاسير، يجمع أقوال السلف من القرآن والسنة بالأسانيد.' },
] as const;

const mb = (n: number) => n / 1048576;

function fail(msg: string): never {
  console.error(`\nFAILED: ${msg}`);
  console.error('Run `npm run data:fetch` and `npm run data:tafsir` first.\n');
  process.exit(1);
}

if (!existsSync(CACHE)) fail('.cache/content does not exist');

// ---- hadith ----------------------------------------------------------------

// Only the fields the catalogue measures. Note there is no book/chapter here: the source
// identifies a hadith's section with `reference.book`, a numeric index, and the title lives
// separately in `metadata.sections`. The app reads both at parse time
// (`utils/hadithService.ts`), so the catalogue does not need a per-book count — and an
// earlier version that tried to read `book.title` here reported zero books for every
// collection, which is worse than reporting nothing.
interface HadithRaw {
  text?: string;
  arabic?: string;
}

const hadithRows = HADITH.map((h) => {
  const file = join(CACHE, `hadith-${h.slug}.json`);
  if (!existsSync(file)) fail(`missing ${file}`);
  const downloadBytes = statSync(file).size;

  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  const list: HadithRaw[] = Array.isArray(parsed) ? parsed : (parsed.hadiths ?? []);

  // Count exactly what the app will keep, so the advertised number matches the UI.
  let usable = 0;
  for (const item of list) if ((item.text ?? item.arabic ?? '').trim()) usable++;

  return { ...h, downloadBytes, count: usable };
});

// ---- tafsir ----------------------------------------------------------------

const tafsirRows = TAFSIR.map((t) => {
  const surahBytes: number[] = [0]; // 1-indexed
  let ayahs = 0;
  let surahs = 0;
  for (let s = 1; s <= 114; s++) {
    const file = join(TAFSIR_CACHE, `${t.slug}-${s}.json`);
    if (!existsSync(file)) {
      surahBytes.push(0);
      continue;
    }
    const size = statSync(file).size;
    surahBytes.push(size);
    surahs++;
    ayahs += Object.keys(JSON.parse(readFileSync(file, 'utf8'))).length;
  }
  const total = surahBytes.reduce((a, b) => a + b, 0);
  if (surahs === 0) fail(`no tafsir cached for ${t.slug}`);
  return { ...t, surahBytes, totalBytes: total, ayahs, surahs };
});

// ---- emit ------------------------------------------------------------------


const out = `// GENERATED by \`npm run data:catalog\` — do not edit by hand.
//
// Every size and count here is measured from the real payloads that the app downloads
// and caches, so the numbers the UI shows match what the user actually transfers.
// Regenerate after refreshing the content cache (see scripts/fetch-content.ts).

import { toArabicDigits } from '@/data/surahs';

export interface TafsirEdition {
  /** Stable id used in saved settings. */
  id: string;
  titleAr: string;
  authorAr: string;
  blurb: string;
  /** Upstream folder name in spa5k/tafsir_api. */
  slug: string;
  /** Ayahs the edition covers. Jalalayn leaves some without commentary. */
  ayahs: number;
  /** Number of surahs the upstream source actually has a file for. */
  surahs: number;
  /** Total download size in bytes across every surah. */
  totalBytes: number;
  /** Per-surah download size in bytes, index 1..114. 0 means "not available". */
  surahBytes: number[];
  /** Rough guidance shown before a heavy download. */
  weight: 'light' | 'medium' | 'heavy';
}

export interface HadithBook {
  id: string;
  titleAr: string;
  authorAr: string;
  /** Upstream file name in fawazahmed0/hadith-api. */
  slug: string;
  count: number;
  downloadBytes: number;
}

const TAFSIR_WEIGHT: Record<TafsirEdition['id'], TafsirEdition['weight']> = {
${tafsirRows
  .map((t) => {
    const w = t.totalBytes < 8e6 ? 'light' : t.totalBytes < 45e6 ? 'medium' : 'heavy';
    return `  ${t.id}: '${w}',`;
  })
  .join('\n')}
};

/** The eight Arabic tafsirs offered, smallest first. */
export const TAFSIR_EDITIONS: TafsirEdition[] = [
${tafsirRows
  .map(
    (t) => `  {
    id: '${t.id}',
    titleAr: '${t.titleAr}',
    authorAr: '${t.authorAr}',
    blurb: '${t.blurb.replace(/'/g, "\\'")}',
    slug: '${t.slug}',
    ayahs: ${t.ayahs},
    surahs: ${t.surahs},
    totalBytes: ${t.totalBytes},
    weight: TAFSIR_WEIGHT.${t.id},
    surahBytes: [${t.surahBytes.join(', ')}],
  },`,
  )
  .join('\n')}
];

/** The nine Arabic hadith collections available from the source, smallest first. */
export const HADITH_BOOKS: HadithBook[] = [
${hadithRows
  .map(
    (h) => `  {
    id: '${h.id}',
    titleAr: '${h.titleAr}',
    authorAr: '${h.author}',
    slug: '${h.slug}',
    count: ${h.count},
    downloadBytes: ${h.downloadBytes},
  },`,
  )
  .join('\n')}
];

export const DEFAULT_TAFSIR_ID = 'muyassar';

/**
 * The collection "hadith of the day" reads from.
 *
 * It is fetched once on first run so the home card works offline immediately, and it is
 * the collection the card falls back to whenever nothing else is installed. Forty hadiths
 * is the smallest real book in the catalogue, so this stays cheap.
 */
export const HADITH_OF_DAY_BOOK = 'arbaeen_nawawi';

export function getTafsirEdition(id: string): TafsirEdition | undefined {
  return TAFSIR_EDITIONS.find((e) => e.id === id);
}

export function getHadithBook(id: string): HadithBook | undefined {
  return HADITH_BOOKS.find((b) => b.id === id);
}

/** Builds the upstream URL for one surah of one tafsir edition. */
export function tafsirSurahUrl(slug: string, surah: number): string {
  return \`https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/\${slug}/\${surah}.json\`;
}

/** Builds the upstream URL for a whole hadith collection. */
export function hadithUrl(slug: string): string {
  return \`https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/\${slug}.json\`;
}

/** Byte size of one surah of an edition, for download estimates. 0 = unavailable. */
export function surahBytes(edition: TafsirEdition, surah: number): number {
  return edition.surahBytes[surah] ?? 0;
}

/** Formats a byte count for the UI. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return \`\${toArabicDigits((bytes / 1073741824).toFixed(1))} GB\`;
  if (bytes >= 1048576) return \`\${toArabicDigits((bytes / 1048576).toFixed(1))} MB\`;
  if (bytes >= 1024) return \`\${toArabicDigits(Math.round(bytes / 1024))} KB\`;
  return \`\${toArabicDigits(bytes)} بايت\`;
}

`;

writeFileSync(OUT, out, 'utf8');

console.log(`Wrote ${OUT}\n`);
console.log('Tafsir editions (total / coverage):');
for (const t of tafsirRows) {
  console.log(
    `  ${t.titleAr.padEnd(24)} ${String(mb(t.totalBytes).toFixed(1)).padStart(6)} MB   ${String(t.ayahs).padStart(5)}/6236 ayahs   ${t.surahs} surahs`,
  );
}
console.log('\nHadith collections:');
for (const h of hadithRows) {
  console.log(
    `  ${h.titleAr.padEnd(24)} ${String(mb(h.downloadBytes).toFixed(2)).padStart(6)} MB   ${String(h.count).padStart(5)} hadiths`,
  );
}
console.log(
  `\nTotal tafsir ${mb(tafsirRows.reduce((a, t) => a + t.totalBytes, 0)).toFixed(1)} MB, ` +
    `total hadith ${mb(hadithRows.reduce((a, h) => a + h.downloadBytes, 0)).toFixed(1)} MB`,
);