/**
 * Builds `src/data/scholarHuwaini.ts` — the page of الشيخ أبي إسحاق الحويني — from
 * archive.org.
 *
 * Nothing here is invented. Every lecture carries the archive.org item it came from and
 * the exact file name inside it, so {@link huwayniLectureUrl} can point the player and
 * the downloader at the real bytes, and a future run can prove the catalogue still
 * matches the source.
 *
 * Two collections are merged:
 *
 *  - the library: one item («Al-Alheweny») holding 577 complete lectures, sermons and
 *    lessons. Its file titles are the real titles; runs of numbered titles (e.g.
 *    «سلسلة صحيح السيرة النبوية 1..14») are folded back into series, the rest stay
 *    single lectures.
 *  - the courses: hand-picked items that are a *دورة* rather than a one-off — شرح صحيح
 *    البخاري، فك الوثاق، تيسير علوم الحديث، النبلاء … Each keeps its own item, so its
 *    average bitrate can be reported and the page can steer the listener at the
 *    clearest recording.
 *
 * Regenerating needs the network (archive.org's metadata API) — it is a build step, not
 * something the app does at runtime. Run it with `npm run data:huwaini`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_MODULE = join(HERE, '..', 'src', 'data', 'scholarHuwaini.ts');
const OUT_CACHE = join(HERE, 'data', 'huwaini-catalog.json');

/** The item the 577-lecture library lives in. */
const LIBRARY_ITEM = 'Al-Alheweny';

/** archive.org identifier → how the page should present that course. */
interface CourseRecipe {
  id: string;
  title: string;
  blurb: string;
  item: string;
}

/**
 * The courses, each validated below before it is allowed into the page: an item that
 * disappeared, or that answers with something other than mp3 files, is reported and
 * skipped rather than shipped as a broken card.
 */
const COURSES: CourseRecipe[] = [
  {
    id: 'nobala',
    title: 'سلسلة النبلاء',
    blurb: 'تراجم أعلام المحدِّثين وسيرهم، بأجود صوت متاح في المكتبة.',
    item: 'Nobala_Howayni-mp3',
  },
  {
    id: 'taysir-uloom',
    title: 'سلسلة تيسير علوم الحديث',
    blurb: 'مدخل إلى مصطلح الحديث: الإسناد، والتدليس، والجرح والتعديل.',
    item: 'Taysir3olomAlhadith-QN',
  },
  {
    id: 'akhlaq-alnabi',
    title: 'سلسلة أخلاق النبي ﷺ',
    blurb: 'هديه ﷺ في الأخلاق والمعاملة، حلقةً حلقة.',
    item: 'Akhla9-anabi_Al7waynee',
  },
  {
    id: 'sifat-alsalah',
    title: 'شرح كتاب صفة الصلاة للألباني',
    blurb: 'شرح الشيخ لكتاب شيخه الألباني في صفة صلاة النبي ﷺ.',
    item: 'sefa_salah_howainy',
  },
  {
    id: 'sharh-alreqaq',
    title: 'شرح كتاب الرقاق من صحيح البخاري',
    blurb: 'سلسلة دروس في كتاب الرقاق، بأصفى نسخة مرفوعة له.',
    item: '4-islamic-1108',
  },
  {
    id: 'bara2at-alsharia',
    title: 'سلسلة براءة الشريعة من التناقض',
    blurb: 'دفع ما يُظنّ تعارضًا بين نصوص الشريعة.',
    item: 'Bara2et-chari3a-mina-tana9od-Howaini-Up-By-MusleM',
  },
  {
    id: 'fak-alwathaq',
    title: 'فك الوثاق بشرح كتاب الرقاق',
    blurb: 'الشرح المطوّل لكتاب الرقاق — ٥١ درسًا كاملة.',
    item: 'fakalwasak1177',
  },
  {
    id: 'madrasat-alhayah',
    title: 'مدرسة الحياة — كتاب صيد الخاطر (١٤٢٨هـ)',
    blurb: 'قراءة وتعليق على «صيد الخاطر» لابن الجوزي.',
    item: '1428-1',
  },
  {
    id: 'taysir-uloom-kamil',
    title: 'تيسير علوم الحديث — السلسلة الكاملة',
    blurb: 'النسخة الأطول من السلسلة (١٥ درسًا)، لمن أراد التمام.',
    item: '4-islamic-1104',
  },
  {
    id: 'zad-alghareeb',
    title: 'زاد الغريب',
    blurb: 'حلقات برنامج «زاد الغريب» كما قُدّمت على الشاشة.',
    item: '4-islamic-1526',
  },
  {
    id: 'walaa-baraa',
    title: 'إتحاف النبلاء بمسائل الولاء والبراء',
    blurb: 'مسائل الولاء والبراء محرَّرةً بأدلتها.',
    item: 'Howainy_walaa_baraa',
  },
  {
    id: 'ibrahim-ummah',
    title: 'سلسلة إن إبراهيم كان أمة',
    blurb: 'دروس في ملّة إبراهيم عليه السلام وتوحيده.',
    item: 'ansarel7abib_443',
  },
  {
    id: 'salam-alsuud',
    title: 'سلسلة سلم الصعود',
    blurb: 'معارج الصعود إلى الله عز وجل.',
    item: 'Solem-Saud_Howaini_uP_bY_mUSLEm',
  },
  {
    id: 'alghawwas',
    title: 'الغواص في استنباط الأحكام من الحديث',
    blurb: 'كيف تُستخرج الأحكام الفقهية من نصوص السنة.',
    item: 'AlGhawas',
  },
  {
    id: 'sharh-bukhari',
    title: 'شرح صحيح البخاري',
    blurb: 'مجالس في شرح الجامع الصحيح، من المقدمة إلى أبواب العلم.',
    item: 'ansarel7abib_235',
  },
  {
    id: 'albaqooniyah',
    title: 'شرح المنظومة البيقونية',
    blurb: 'شرح منظومة البيقوني في مصطلح الحديث بيتًا بيتًا.',
    item: 'xboxgamer-4642',
  },
  {
    id: 'tark-alhawa',
    title: 'ترك الهوى عز الدنيا وشرف الآخرة',
    blurb: 'دروس في مخالفة الهوى وثمن العزّة.',
    item: 'Al_Houwaini_Tark_Al-hawa_uP_bY_mUSLEm',
  },
];

// ---------------------------------------------------------------------------
// Source shapes (only the fields this builder reads)
// ---------------------------------------------------------------------------

interface ArchiveFile {
  name: string;
  source?: string;
  format?: string;
  title?: string;
  length?: string;
  size?: string;
}

interface ArchiveItem {
  metadata?: { title?: string; mediatype?: string; identifier?: string };
  files?: ArchiveFile[];
}

async function fetchItem(identifier: string): Promise<ArchiveItem> {
  const res = await fetch(`https://archive.org/metadata/${identifier}`);
  if (!res.ok) throw new Error(`${identifier}: metadata ${res.status}`);
  return (await res.json()) as ArchiveItem;
}

const TATWEEL = /\u0640+/g;
const HARAKAT = /[\u064B-\u0652]/g;
const MEDIA_EXT = /\.(?:mp3|mp4|wmv|rm|ra|avi|ogg|m4a|flv|mkv)$/i;

/** Whitespace/diacritic cleanup applied before any title matching. */
function normalizeTitle(raw: string): string {
  return raw.replace(TATWEEL, '').replace(HARAKAT, '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits a library title into the run it belongs to and its position inside it, so
 * «سلسلة صحيح السيرة النبوية 3» and «شرح ألفية السيوطي (12)» become members instead of
 * loose lectures. A run needs at least two members before it is treated as one — a lone
 * title that merely ends in a number stays a single lecture.
 */
function splitTitle(raw: string): { base: string; part: number } {
  const title = normalizeTitle(raw);
  const patterns = [
    /^(.*?)\s*\(\s*(\d+)\s*\)\s*$/,
    /^(.*?)\s*\[\s*([\d\s،,]+?)\s*\]\s*$/,
    /^(.*?)\s*[-\u2013\u2014]\s*(\d+)\s*$/,
    /^(.*?)\s+(\d+)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    // `base.length > 3` keeps titles that are mostly a number (e.g. «٢٠») intact.
    if (match && match[1].trim().length > 3) {
      return { base: match[1].trim(), part: Number(match[2].match(/\d+/)?.[0] ?? 0) };
    }
  }
  return { base: title, part: 0 };
}

/**
 * Uploads routinely carry one or two mp3s that are not a lecture at all — a rights
 * notice, a station jingle, a site advert. They are dropped before anything is counted,
 * so «٥١ درسًا» means fifty-one lessons.
 */
const JUNK_TITLE =
  /(?:جميع|كل)\s+الحقوق\s+محفوظة|حقوق\s+محفوظة|\bwww\.|https?:\/\/|@[a-z0-9.-]+\.(?:com|net|org|info)/i;

function isJunk(file: ArchiveFile): boolean {
  return JUNK_TITLE.test(String(file.title ?? '')) || JUNK_TITLE.test(decodeName(file.name));
}

function audioFilesOf(item: ArchiveItem): ArchiveFile[] {
  const files = (item.files ?? []).filter((file) => !isJunk(file));
  const isMp3 = (file: ArchiveFile) => /\.mp3$/i.test(file.name);
  const originals = files.filter((file) => isMp3(file) && file.source === 'original');
  // Some uploads only keep archive.org's derived mp3 — fall back rather than lose them.
  return originals.length > 0 ? originals : files.filter(isMp3);
}

function secondsOf(file: ArchiveFile): number {
  const value = Number(file.length ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function bytesOf(file: ArchiveFile): number {
  const value = Number(file.size ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Bitrate estimate, in kbps — 0 when the item never recorded a duration. */
function kbpsOf(bytes: number, seconds: number): number {
  if (bytes <= 0 || seconds <= 0) return 0;
  return Math.round((bytes * 8) / seconds / 1000);
}

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * A readable label for one file. Real titles win; otherwise the file name is cleaned
 * up, and when that too is just a number («01.mp3») the lesson number is used, which is
 * what a دورة is referred to by anyway.
 */
/**
 * Titles some uploads carry on every track instead of a real name — «tmp», «track 1».
 * They are treated as if the file had no title at all.
 */
const NON_TITLE = /^(?:tmp|temp|untitled|audio|new|file|out|final|track\s*\d*|test|\d{1,3})$/i;

/**
 * A readable label for one file. Real titles win; otherwise the file name is cleaned
 * up, and when that too is just a number («01.mp3») the lesson number is used, which is
 * what a دورة is referred to by anyway.
 */
function lectureTitle(file: ArchiveFile, index: number): string {
  const fromMeta = normalizeTitle(String(file.title ?? '')).replace(MEDIA_EXT, '');
  if (fromMeta && !NON_TITLE.test(fromMeta)) return fromMeta;
  const fromName = normalizeTitle(
    decodeName(file.name)
      .replace(MEDIA_EXT, '')
      .replace(/[_]+/g, ' ')
      .replace(/[{}]/g, ' '),
  );
  const informative = /[\u0600-\u06FF]/.test(fromName) || /[A-Za-z]{3,}/.test(fromName);
  return informative ? fromName : `الدرس ${index + 1}`;
}

/** Ordering key: the file name is the original tape order, so it beats any numbering. */
function byFileName(a: ArchiveFile, b: ArchiveFile): number {
  return a.name.localeCompare(b.name, 'en', { numeric: true });
}

/**
 * The longest leading fragment — cut at a separator, so no word is halved — that a clear
 * majority of the titles share. A majority rather than *all* of them, because one
 * off-format track should not stop the other thirty from being cleaned up.
 */
function dominantPrefix(values: string[]): string {
  if (values.length < 3) return '';
  const needed = Math.ceil(values.length * 0.6);
  let best = '';
  const consider = (candidate: string) => {
    if (candidate.length >= 5 && candidate.length > best.length) {
      const share = values.filter((entry) => entry.startsWith(candidate)).length;
      if (share >= needed) best = candidate;
    }
  };
  for (const value of values) {
    for (const separator of [' - ', ' – ', ': ']) {
      let index = value.indexOf(separator);
      while (index !== -1) {
        consider(value.slice(0, index + separator.length));
        index = value.indexOf(separator, index + separator.length);
      }
    }
    // Word boundaries too, so a series name with no separator («شرح صحيح البخاري 3 …»)
    // is still recognised as the repeated heading it plainly is.
    let space = value.indexOf(' ');
    while (space !== -1) {
      consider(value.slice(0, space + 1));
      space = value.indexOf(' ', space + 1);
    }
  }
  return best;
}

const LEADING_NUMBER = /^\s*(?:\(\s*\d+\s*\)|\d+)\s*[-–_.):]\s*/;
const EDGE_TRIM = /^[\s\-–_.:·]+|[\s\-–_.:·]+$/g;

/**
 * The longest trailing fragment — cut at a separator or a word boundary — that a clear
 * majority of the titles share. Counterpart of {@link dominantPrefix}: some series end
 * every track with «- الشيخ أبو إسحاق الحويني».
 */
function dominantSuffix(values: string[]): string {
  if (values.length < 3) return '';
  const needed = Math.ceil(values.length * 0.6);
  let best = '';
  const consider = (candidate: string) => {
    if (candidate.length >= 6 && candidate.length > best.length) {
      const share = values.filter((entry) => entry.endsWith(candidate)).length;
      if (share >= needed) best = candidate;
    }
  };
  for (const value of values) {
    for (const separator of [' - ', ' – ', ': ']) {
      let index = value.indexOf(separator);
      while (index !== -1) {
        consider(value.slice(index));
        index = value.indexOf(separator, index + separator.length);
      }
    }
    let space = value.indexOf(' ');
    while (space !== -1) {
      consider(value.slice(space));
      space = value.indexOf(' ', space + 1);
    }
  }
  return best;
}

/**
 * Course files often repeat the series name, a lesson number and a signature on every
 * track («1- أبو إسحاق الحويني - النبلاء - عبد الله بن مسعود»). All three are redundant —
 * the list is ordered, the card is titled — so they are folded away, but only when what
 * is left still reads like a title.
 */
function tidyCourseTitles(lectures: BuiltLecture[]): void {
  if (lectures.length < 3) return;
  const bases = lectures.map((lecture) => {
    const withoutNumber = normalizeTitle(lecture.title.replace(LEADING_NUMBER, ''));
    return withoutNumber.length >= 4 ? withoutNumber : lecture.title;
  });
  const prefix = dominantPrefix(bases);
  const trimmed = bases.map((base) =>
    prefix && base.startsWith(prefix) ? base.slice(prefix.length).replace(EDGE_TRIM, '').trim() : base,
  );
  const suffix = dominantSuffix(trimmed);
  lectures.forEach((lecture, index) => {
    const core =
      suffix && trimmed[index].endsWith(suffix)
        ? trimmed[index].slice(0, trimmed[index].length - suffix.length).replace(EDGE_TRIM, '').trim()
        : trimmed[index];
    lecture.title = core.length >= 3 && /[\u0600-\u06FFA-Za-z]/.test(core) ? core : bases[index];
  });
}

interface BuiltLecture {
  id: string;
  title: string;
  file: string;
  seconds: number;
  bytes: number;
}

// ---------------------------------------------------------------------------
// The library: series + single lectures
// ---------------------------------------------------------------------------

interface BuiltSeries {
  id: string;
  title: string;
  lectures: BuiltLecture[];
}

function buildLibrary(item: ArchiveItem): { series: BuiltSeries[]; singles: BuiltLecture[]; total: number } {
  const files = audioFilesOf(item).sort(byFileName);
  const runs = new Map<string, { file: ArchiveFile; part: number; order: number }[]>();

  files.forEach((file, order) => {
    const raw = String(file.title ?? '').trim();
    if (!raw) return;
    const { base, part } = splitTitle(raw);
    const list = runs.get(base) ?? [];
    list.push({ file, part, order });
    runs.set(base, list);
  });

  const series: BuiltSeries[] = [];
  const singles: BuiltLecture[] = [];

  const slug = (value: string) =>
    value
      .replace(/[^\u0600-\u06FFA-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'series';

  for (const [base, members] of runs) {
    // Exact re-uploads (same duration and size) are folded away, so a series is not
    // offered twice under two spellings of the same title.
    const seen = new Set<string>();
    const unique = members
      .filter((entry) => {
        const signature = `${secondsOf(entry.file)}|${bytesOf(entry.file)}`;
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
      })
      .sort((a, b) => (a.part || a.order) - (b.part || b.order) || a.order - b.order);

    if (unique.length >= 2) {
      const id = slug(base);
      series.push({
        id,
        title: base,
        lectures: unique.map((entry, index) => ({
          id: `${id}-${index + 1}`,
          title: normalizeTitle(String(entry.file.title ?? '')),
          file: entry.file.name,
          seconds: secondsOf(entry.file),
          bytes: bytesOf(entry.file),
        })),
      });
    } else {
      for (const entry of unique) {
        const id = `${slug(base)}-${singles.length + 1}`;
        singles.push({
          id,
          title: normalizeTitle(String(entry.file.title ?? '')),
          file: entry.file.name,
          seconds: secondsOf(entry.file),
          bytes: bytesOf(entry.file),
        });
      }
    }
  }

  series.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
  singles.sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }));
  // Ids must be unique across both lists — the download store keys on them.
  const used = new Set<string>();
  for (const list of [series.flatMap((entry) => entry.lectures), singles]) {
    for (const lecture of list) {
      let id = lecture.id;
      let suffix = 2;
      while (used.has(id)) id = `${lecture.id}-${suffix++}`;
      lecture.id = id;
      used.add(id);
    }
  }

  return { series, singles, total: files.length };
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

function buildCourse(recipe: CourseRecipe, item: ArchiveItem): (Omit<BuiltCourse, 'lectures'> & { lectures: BuiltLecture[] }) | null {
  const files = audioFilesOf(item).sort(byFileName);
  if (files.length < 2) return null;

  const lectures = files.map((file, index) => ({
    id: `${recipe.id}-${index + 1}`,
    title: lectureTitle(file, index),
    file: file.name,
    seconds: secondsOf(file),
    bytes: bytesOf(file),
  }));
  tidyCourseTitles(lectures);

  const bytes = lectures.reduce((total, lecture) => total + lecture.bytes, 0);
  const seconds = lectures.reduce((total, lecture) => total + lecture.seconds, 0);

  return {
    id: recipe.id,
    title: recipe.title,
    blurb: recipe.blurb,
    item: recipe.item,
    source: `https://archive.org/details/${recipe.item}`,
    kbps: kbpsOf(bytes, seconds),
    seconds,
    bytes,
    lectures,
  };
}

interface BuiltCourse {
  id: string;
  title: string;
  blurb: string;
  item: string;
  source: string;
  kbps: number;
  seconds: number;
  bytes: number;
  lectures: BuiltLecture[];
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

const HEADER = `/**
 * صفحة الشيخ أبي إسحاق الحويني — GENERATED, do not edit by hand.
 *
 * Source: archive.org. Regenerate with \`npm run data:huwaini\`.
 *
 * Every lecture below names the item it was taken from and the exact file inside it, so
 * the player and the downloader always fetch the real recording, and the catalogue can
 * be diffed against the archive at any time.
 */

export type HuwainiQualityTier = 'high' | 'medium' | 'low';

/** One recording: a lesson, a sermon, or a sitting. */
export interface HuwainiLecture {
  id: string;
  title: string;
  /** File name inside the archive.org item. */
  file: string;
  /** Duration in seconds — \`0\` when the source never recorded one. */
  seconds: number;
  /** Size in bytes. */
  bytes: number;
}

/** A multi-part run inside the main library (e.g. «سلسلة صحيح السيرة النبوية»). */
export interface HuwainiSeries {
  id: string;
  title: string;
  lectures: HuwainiLecture[];
}

/** A دورة held as its own archive.org item, with its own recording quality. */
export interface HuwainiCourse {
  id: string;
  title: string;
  blurb: string;
  /** archive.org identifier holding the audio. */
  item: string;
  /** Human-readable page for the item. */
  source: string;
  /** Average bitrate of the course, in kbps (\`0\` when unknown). */
  kbps: number;
  seconds: number;
  bytes: number;
  lectures: HuwainiLecture[];
}

export interface HuwainiProfile {
  name: string;
  honorific: string;
  fullName: string;
  born: string;
  died: string;
  bio: string[];
  teachers: string[];
  works: string[];
  source: string;
}
`;

function emit(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((entry) => `${pad}  ${emit(entry, indent + 2)}`);
    return `[\n${items.join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const lines = entries.map(([key, entry]) => {
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    return `${pad}  ${safeKey}: ${emit(entry, indent + 2)}`;
  });
  return `{\n${lines.join(',\n')},\n${pad}}`;
}

const PROFILE = {
  name: 'أبو إسحاق الحويني',
  honorific: 'رحمه الله',
  fullName: 'حِجازي بن محمد بن يوسف بن شريف',
  born: '١٩٥٦م — قرية حُوَين، كفر الشيخ، مصر',
  died: '١٧ رمضان ١٤٤٦هـ / ١٧ مارس ٢٠٢٥م — الدوحة',
  bio: [
    'عالمٌ ومحدِّثٌ مصري، يُعَدّ من أبرز المشتغلين بعلم الحديث في عصره، عُرِف بكنيته «أبي إسحاق» تعلّقًا بالإمام الشاطبي وبسعد بن أبي وقّاص رضي الله عنه.',
    'وُلد بقرية حُوَين بمحافظة كفر الشيخ، وتخرّج في كلية الألسن بجامعة عين شمس قسم اللغة الإسبانية، وكان الأول على دفعته. وقراءةُ «السلسلة الضعيفة» للشيخ الألباني في سني دراسته كانت — كما قال — أعظمَ فائدةٍ من كل سنوات تحصيله.',
    'رحل إلى الشيخ الألباني مرّتين (١٤٠٧هـ و١٤١٠هـ)، وألقى عليه قرابة مئتي سؤالٍ في علل الحديث وحده. أثنى عليه الألباني فقال له: «صَحَّ لك ما لم يصحَّ لغيرك»، ووصفه بأنه من إخوانه الأقوياء في علم الحديث.',
    'له تحقيقاتٌ ومؤلفاتٌ كثيرة، وبرامجُ ودروسٌ وخطبٌ انتفع بها خلقٌ كثير. تُوفي بالدوحة مساء الاثنين ١٧ رمضان ١٤٤٦هـ، وصُلِّي عليه بجامع الإمام محمد بن عبد الوهاب ودُفن بمقبرة مسيمير.',
  ],
  teachers: [
    'محمد ناصر الدين الألباني',
    'عبد العزيز بن باز',
    'محمد بن صالح العثيمين',
    'عبد الله بن قعود',
    'عبد الله بن جبرين',
    'محمد نجيب المطيعي',
    'عبد الفتاح الجزّار',
  ],
  works: [
    'غوث المكدود بتخريج منتقى ابن الجارود',
    'بذل الإحسان بتقريب سنن النسائي',
    'الانشراح في آداب النكاح',
    'صحيح القصص النبوي',
    'فك الوثاق بشرح كتاب الرقاق',
    'إسعاف اللبيث بفتاوى الحديث',
    'الظل الوريف في حكم العمل بالحديث الضعيف',
  ],
  source: 'https://ar.wikipedia.org/wiki/أبو_إسحاق_الحويني',
};

async function main(): Promise<void> {
  console.log('fetching the library…');
  const library = buildLibrary(await fetchItem(LIBRARY_ITEM));
  console.log(
    `  ${library.total} files → ${library.series.length} series + ${library.singles.length} single lectures`,
  );

  const courses: BuiltCourse[] = [];
  for (const recipe of COURSES) {
    try {
      const item = await fetchItem(recipe.item);
      const course = buildCourse(recipe, item);
      if (!course) {
        console.warn(`  ! ${recipe.item} — no mp3 files, skipped`);
        continue;
      }
      courses.push(course);
      console.log(
        `  + ${course.title} — ${course.lectures.length} lessons, ${course.kbps}kbps`,
      );
    } catch (err) {
      console.warn(`  ! ${recipe.item} — ${(err as Error).message}, skipped`);
    }
  }

  const totalSeconds =
    courses.reduce((total, course) => total + course.seconds, 0) +
    library.series.reduce((total, series) => total + series.lectures.reduce((sum, l) => sum + l.seconds, 0), 0) +
    library.singles.reduce((total, lecture) => total + lecture.seconds, 0);
  const totalBytes =
    courses.reduce((total, course) => total + course.bytes, 0) +
    library.series.reduce((total, series) => total + series.lectures.reduce((sum, l) => sum + l.bytes, 0), 0) +
    library.singles.reduce((total, lecture) => total + lecture.bytes, 0);

  const stats = {
    courses: courses.length,
    series: library.series.length,
    lectures:
      courses.reduce((total, course) => total + course.lectures.length, 0) +
      library.series.reduce((total, series) => total + series.lectures.length, 0) +
      library.singles.length,
    seconds: totalSeconds,
    bytes: totalBytes,
  };

  const module = [
    HEADER.trimEnd(),
    '',
    `/** The item the 577-lecture library lives in. */`,
    `export const HUWAINI_LIBRARY_ITEM = ${JSON.stringify(LIBRARY_ITEM)};`,
    '',
    `export const HUWAINI_LIBRARY_SOURCE = ${JSON.stringify(`https://archive.org/details/${LIBRARY_ITEM}`)};`,
    '',
    'export const HUWAINI_PROFILE: HuwainiProfile = ' + emit(PROFILE) + ';',
    '',
    'export const HUWAINI_COURSES: HuwainiCourse[] = ' + emit(courses) + ';',
    '',
    'export const HUWAINI_SERIES: HuwainiSeries[] = ' + emit(library.series) + ';',
    '',
    '/** Every single (non-series) lecture in the library. */',
    'export const HUWAINI_LECTURES: HuwainiLecture[] = ' + emit(library.singles) + ';',
    '',
    'export const HUWAINI_STATS = ' + emit(stats) + ';',
    '',
    '/** A lecture together with the archive.org item that holds it. */',
    'export interface HuwainiAudioRef {',
    '  lecture: HuwainiLecture;',
    '  item: string;',
    '}',
    '',
    'let lectureIndex: Map<string, HuwainiAudioRef> | null = null;',
    '',
    '/** Look up any recording — course, series or single — by its stable id. */',
    'export function huwayniLectureById(id: string): HuwainiAudioRef | null {',
    '  if (!lectureIndex) {',
    '    lectureIndex = new Map();',
    '    for (const course of HUWAINI_COURSES) {',
    '      for (const lecture of course.lectures) lectureIndex.set(lecture.id, { lecture, item: course.item });',
    '    }',
    '    for (const series of HUWAINI_SERIES) {',
    '      for (const lecture of series.lectures)',
    '        lectureIndex.set(lecture.id, { lecture, item: HUWAINI_LIBRARY_ITEM });',
    '    }',
    '    for (const lecture of HUWAINI_LECTURES) {',
    '      lectureIndex.set(lecture.id, { lecture, item: HUWAINI_LIBRARY_ITEM });',
    '    }',
    '  }',
    '  return lectureIndex.get(id) ?? null;',
    '}',
    '',
    '/** Direct download / streaming URL for one recording. */',
    'export function huwayniLectureUrl(item: string, file: string): string {',
    "  return `https://archive.org/download/${item}/${encodeURIComponent(file)}`;",
    '}',
    '',
    '/** Estimated bitrate of a lecture, in kbps — `0` when the source has no duration. */',
    'export function huwayniLectureKbps(lecture: HuwainiLecture): number {',
    '  if (lecture.bytes <= 0 || lecture.seconds <= 0) return 0;',
    '  return Math.round((lecture.bytes * 8) / lecture.seconds / 1000);',
    '}',
    '',
    '/**',
    ' * How good the recording is, judged only by its real bitrate — the page has no other',
    ' * way to rank «أجود الأصوات» honestly.',
    ' */',
    'export function huwayniQualityTier(kbps: number): HuwainiQualityTier {',
    "  if (kbps >= 128) return 'high';",
    "  if (kbps >= 64) return 'medium';",
    "  return 'low';",
    '}',
    '',
    'export function huwayniQualityLabel(kbps: number): string {',
    "  if (kbps <= 0) return 'الجودة غير معلومة';",
    "  const tier = huwayniQualityTier(kbps);",
    "  const name = tier === 'high' ? 'جودة عالية' : tier === 'medium' ? 'جودة متوسطة' : 'جودة عادية';",
    '  return `${name} · ${kbps} kbps`;',
    '}',
    '',
  ].join('\n');

  mkdirSync(dirname(OUT_MODULE), { recursive: true });
  mkdirSync(dirname(OUT_CACHE), { recursive: true });
  writeFileSync(OUT_MODULE, module, 'utf8');
  writeFileSync(
    OUT_CACHE,
    JSON.stringify({ stats, courses: courses.map(({ id, title, item, kbps, lectures }) => ({ id, title, item, kbps, lessons: lectures.length })) }, null, 2),
    'utf8',
  );

  const hours = (stats.seconds / 3600).toFixed(1);
  console.log(
    `\nwrote ${OUT_MODULE}\n  ${stats.courses} courses · ${stats.series} series · ${stats.lectures} lectures · ${hours}h · ${(stats.bytes / 1073741824).toFixed(1)}GB`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
