/**
 * Which juz an ayah belongs to, and where the boundaries land in our pagination.
 *
 * Imported from `mushafFlow` rather than being computed here: the flow generator is the one
 * place that can see both the printed boundary tables and the line breaks, so it resolves
 * each boundary to the ayah it opens and bakes the answer in.
 */
import { TOTAL_PAGES, JUZ_START_PAGES as FLOW_JUZ_START_PAGES, getAyahFlowPage } from './mushafFlow';

export interface SurahMeta {
  id: number;
  name: string; // Arabic name
  nameLatin: string;
  englishName: string;
  ayahCount: number;
  revelationType: 'meccan' | 'medinan';
  juzStart: number;
  /** Page of this surah's first ayah in *our* mushaf. See `mushafFlow`. */
  pageStart: number;
  /** Where it starts in the printed mushaf. Provenance only — never displayed. */
  printedPageStart: number;
}

interface SurahRaw {
  id: number;
  name: string;
  nameLatin: string;
  englishName: string;
  ayahCount: number;
  revelationType: 'meccan' | 'medinan';
  /**
   * Where this surah starts in the *printed* mushaf.
   *
   * Kept for provenance only. Nothing in the app shows this number: our pagination is the
   * flow layout in `mushafFlow.ts`, and `pageStart` above is derived from it.
   */
  printedPageStart: number;
}

/**
 * Pages in this app's mushaf.
 *
 * Not the printed mushaf's 604. The printed boundaries live in `mushafPrinted` and are
 * mapped through the flow at build time; what the reader displays is always this.
 */
export const TOTAL_QURAN_PAGES = TOTAL_PAGES;

/**
 * Page on which each juz begins, in our mushaf.
 *
 * Which juz an ayah belongs to is a fact of the printed mushaf; where that juz lands in our
 * pagination is not. `mushafFlow` resolves each printed boundary to the ayah it opens and
 * reports that ayah's page here, so the two never disagree.
 *
 * Declared above `SURAHS` on purpose: `SURAHS` derives each surah's `juzStart` from
 * `getJuzForPage`, and a `const` read before its declaration throws a TDZ error.
 */
export const JUZ_START_PAGES = FLOW_JUZ_START_PAGES;

/** Juz (1-30) that contains the given page of our mushaf. */
export function getJuzForPage(page: number): number {
  if (!Number.isFinite(page) || page < JUZ_START_PAGES[0]) return 1;
  let juz = 1;
  for (let i = 0; i < JUZ_START_PAGES.length; i++) {
    if (page < JUZ_START_PAGES[i]) break;
    juz = i + 1;
  }
  return juz;
}

// Complete list of all 114 surahs with metadata
const SURAHS_RAW: SurahRaw[] = [
  { id: 1, name: 'الفاتحة', nameLatin: 'Al-Fatihah', englishName: 'The Opening', ayahCount: 7, revelationType: 'meccan', printedPageStart: 1 },
  { id: 2, name: 'البقرة', nameLatin: 'Al-Baqarah', englishName: 'The Cow', ayahCount: 286, revelationType: 'medinan', printedPageStart: 2 },
  { id: 3, name: 'آل عمران', nameLatin: 'Aal-E-Imran', englishName: 'The Family of Imran', ayahCount: 200, revelationType: 'medinan', printedPageStart: 50 },
  { id: 4, name: 'النساء', nameLatin: 'An-Nisa', englishName: 'The Women', ayahCount: 176, revelationType: 'medinan', printedPageStart: 77 },
  { id: 5, name: 'المائدة', nameLatin: 'Al-Maidah', englishName: 'The Table', ayahCount: 120, revelationType: 'medinan', printedPageStart: 106 },
  { id: 6, name: 'الأنعام', nameLatin: 'Al-Anam', englishName: 'The Cattle', ayahCount: 165, revelationType: 'meccan', printedPageStart: 128 },
  { id: 7, name: 'الأعراف', nameLatin: 'Al-Araf', englishName: 'The Heights', ayahCount: 206, revelationType: 'meccan', printedPageStart: 151 },
  { id: 8, name: 'الأنفال', nameLatin: 'Al-Anfal', englishName: 'The Spoils', ayahCount: 75, revelationType: 'medinan', printedPageStart: 177 },
  { id: 9, name: 'التوبة', nameLatin: 'At-Tawbah', englishName: 'The Repentance', ayahCount: 129, revelationType: 'medinan', printedPageStart: 187 },
  { id: 10, name: 'يونس', nameLatin: 'Yunus', englishName: 'Jonah', ayahCount: 109, revelationType: 'meccan', printedPageStart: 208 },
  { id: 11, name: 'هود', nameLatin: 'Hud', englishName: 'Hud', ayahCount: 123, revelationType: 'meccan', printedPageStart: 221 },
  { id: 12, name: 'يوسف', nameLatin: 'Yusuf', englishName: 'Joseph', ayahCount: 111, revelationType: 'meccan', printedPageStart: 235 },
  { id: 13, name: 'الرعد', nameLatin: 'Ar-Rad', englishName: 'The Thunder', ayahCount: 43, revelationType: 'medinan', printedPageStart: 249 },
  { id: 14, name: 'إبراهيم', nameLatin: 'Ibrahim', englishName: 'Abraham', ayahCount: 52, revelationType: 'meccan', printedPageStart: 255 },
  { id: 15, name: 'الحجر', nameLatin: 'Al-Hijr', englishName: 'The Rocky Tract', ayahCount: 99, revelationType: 'meccan', printedPageStart: 262 },
  { id: 16, name: 'النحل', nameLatin: 'An-Nahl', englishName: 'The Bee', ayahCount: 128, revelationType: 'meccan', printedPageStart: 267 },
  { id: 17, name: 'الإسراء', nameLatin: 'Al-Isra', englishName: 'The Night Journey', ayahCount: 111, revelationType: 'meccan', printedPageStart: 282 },
  { id: 18, name: 'الكهف', nameLatin: 'Al-Kahf', englishName: 'The Cave', ayahCount: 110, revelationType: 'meccan', printedPageStart: 293 },
  { id: 19, name: 'مريم', nameLatin: 'Maryam', englishName: 'Mary', ayahCount: 98, revelationType: 'meccan', printedPageStart: 305 },
  { id: 20, name: 'طه', nameLatin: 'Taha', englishName: 'Ta-Ha', ayahCount: 135, revelationType: 'meccan', printedPageStart: 312 },
  { id: 21, name: 'الأنبياء', nameLatin: 'Al-Anbiya', englishName: 'The Prophets', ayahCount: 112, revelationType: 'meccan', printedPageStart: 322 },
  { id: 22, name: 'الحج', nameLatin: 'Al-Hajj', englishName: 'The Pilgrimage', ayahCount: 78, revelationType: 'medinan', printedPageStart: 332 },
  { id: 23, name: 'المؤمنون', nameLatin: 'Al-Muminun', englishName: 'The Believers', ayahCount: 118, revelationType: 'meccan', printedPageStart: 342 },
  { id: 24, name: 'النور', nameLatin: 'An-Nur', englishName: 'The Light', ayahCount: 64, revelationType: 'medinan', printedPageStart: 350 },
  { id: 25, name: 'الفرقان', nameLatin: 'Al-Furqan', englishName: 'The Criterion', ayahCount: 77, revelationType: 'meccan', printedPageStart: 359 },
  { id: 26, name: 'الشعراء', nameLatin: 'Ash-Shuara', englishName: 'The Poets', ayahCount: 227, revelationType: 'meccan', printedPageStart: 367 },
  { id: 27, name: 'النمل', nameLatin: 'An-Naml', englishName: 'The Ant', ayahCount: 93, revelationType: 'meccan', printedPageStart: 377 },
  { id: 28, name: 'القصص', nameLatin: 'Al-Qasas', englishName: 'The Stories', ayahCount: 88, revelationType: 'meccan', printedPageStart: 385 },
  { id: 29, name: 'العنكبوت', nameLatin: 'Al-Ankabut', englishName: 'The Spider', ayahCount: 69, revelationType: 'meccan', printedPageStart: 396 },
  { id: 30, name: 'الروم', nameLatin: 'Ar-Rum', englishName: 'The Romans', ayahCount: 60, revelationType: 'meccan', printedPageStart: 404 },
  { id: 31, name: 'لقمان', nameLatin: 'Luqman', englishName: 'Luqman', ayahCount: 34, revelationType: 'meccan', printedPageStart: 411 },
  { id: 32, name: 'السجدة', nameLatin: 'As-Sajdah', englishName: 'The Prostration', ayahCount: 30, revelationType: 'meccan', printedPageStart: 415 },
  { id: 33, name: 'الأحزاب', nameLatin: 'Al-Ahzab', englishName: 'The Clans', ayahCount: 73, revelationType: 'medinan', printedPageStart: 418 },
  { id: 34, name: 'سبأ', nameLatin: 'Saba', englishName: 'Sheba', ayahCount: 54, revelationType: 'meccan', printedPageStart: 428 },
  { id: 35, name: 'فاطر', nameLatin: 'Fatir', englishName: 'The Originator', ayahCount: 45, revelationType: 'meccan', printedPageStart: 434 },
  { id: 36, name: 'يس', nameLatin: 'Ya-Sin', englishName: 'Ya Sin', ayahCount: 83, revelationType: 'meccan', printedPageStart: 440 },
  { id: 37, name: 'الصافات', nameLatin: 'As-Saffat', englishName: 'Those Who Set The Ranks', ayahCount: 182, revelationType: 'meccan', printedPageStart: 446 },
  { id: 38, name: 'ص', nameLatin: 'Sad', englishName: 'The Letter Sad', ayahCount: 88, revelationType: 'meccan', printedPageStart: 453 },
  { id: 39, name: 'الزمر', nameLatin: 'Az-Zumar', englishName: 'The Troops', ayahCount: 75, revelationType: 'meccan', printedPageStart: 458 },
  { id: 40, name: 'غافر', nameLatin: 'Ghafir', englishName: 'The Forgiver', ayahCount: 85, revelationType: 'meccan', printedPageStart: 467 },
  { id: 41, name: 'فصلت', nameLatin: 'Fussilat', englishName: 'Explained In Detail', ayahCount: 54, revelationType: 'meccan', printedPageStart: 477 },
  { id: 42, name: 'الشورى', nameLatin: 'Ash-Shura', englishName: 'The Consultation', ayahCount: 53, revelationType: 'meccan', printedPageStart: 483 },
  { id: 43, name: 'الزخرف', nameLatin: 'Az-Zukhruf', englishName: 'The Gold Adornments', ayahCount: 89, revelationType: 'meccan', printedPageStart: 489 },
  { id: 44, name: 'الدخان', nameLatin: 'Ad-Dukhan', englishName: 'The Smoke', ayahCount: 59, revelationType: 'meccan', printedPageStart: 496 },
  { id: 45, name: 'الجاثية', nameLatin: 'Al-Jathiyah', englishName: 'The Crouching', ayahCount: 37, revelationType: 'meccan', printedPageStart: 499 },
  { id: 46, name: 'الأحقاف', nameLatin: 'Al-Ahqaf', englishName: 'The Wind-Curved Sandhills', ayahCount: 35, revelationType: 'meccan', printedPageStart: 502 },
  { id: 47, name: 'محمد', nameLatin: 'Muhammad', englishName: 'Muhammad', ayahCount: 38, revelationType: 'medinan', printedPageStart: 507 },
  { id: 48, name: 'الفتح', nameLatin: 'Al-Fath', englishName: 'The Victory', ayahCount: 29, revelationType: 'medinan', printedPageStart: 511 },
  { id: 49, name: 'الحجرات', nameLatin: 'Al-Hujurat', englishName: 'The Rooms', ayahCount: 18, revelationType: 'medinan', printedPageStart: 515 },
  { id: 50, name: 'ق', nameLatin: 'Qaf', englishName: 'The Letter Qaf', ayahCount: 45, revelationType: 'meccan', printedPageStart: 518 },
  { id: 51, name: 'الذاريات', nameLatin: 'Adh-Dhariyat', englishName: 'The Winnowing Winds', ayahCount: 60, revelationType: 'meccan', printedPageStart: 520 },
  { id: 52, name: 'الطور', nameLatin: 'At-Tur', englishName: 'The Mount', ayahCount: 49, revelationType: 'meccan', printedPageStart: 523 },
  { id: 53, name: 'النجم', nameLatin: 'An-Najm', englishName: 'The Star', ayahCount: 62, revelationType: 'meccan', printedPageStart: 526 },
  { id: 54, name: 'القمر', nameLatin: 'Al-Qamar', englishName: 'The Moon', ayahCount: 55, revelationType: 'meccan', printedPageStart: 528 },
  { id: 55, name: 'الرحمن', nameLatin: 'Ar-Rahman', englishName: 'The Beneficent', ayahCount: 78, revelationType: 'medinan', printedPageStart: 531 },
  { id: 56, name: 'الواقعة', nameLatin: 'Al-Waqiah', englishName: 'The Inevitable', ayahCount: 96, revelationType: 'meccan', printedPageStart: 534 },
  { id: 57, name: 'الحديد', nameLatin: 'Al-Hadid', englishName: 'The Iron', ayahCount: 29, revelationType: 'medinan', printedPageStart: 537 },
  { id: 58, name: 'المجادلة', nameLatin: 'Al-Mujadila', englishName: 'The Pleading Woman', ayahCount: 22, revelationType: 'medinan', printedPageStart: 542 },
  { id: 59, name: 'الحشر', nameLatin: 'Al-Hashr', englishName: 'The Exile', ayahCount: 24, revelationType: 'medinan', printedPageStart: 545 },
  { id: 60, name: 'الممتحنة', nameLatin: 'Al-Mumtahanah', englishName: 'She That Is To Be Examined', ayahCount: 13, revelationType: 'medinan', printedPageStart: 549 },
  { id: 61, name: 'الصف', nameLatin: 'As-Saff', englishName: 'The Ranks', ayahCount: 14, revelationType: 'medinan', printedPageStart: 551 },
  { id: 62, name: 'الجمعة', nameLatin: 'Al-Jumuah', englishName: 'The Congregation', ayahCount: 11, revelationType: 'medinan', printedPageStart: 553 },
  { id: 63, name: 'المنافقون', nameLatin: 'Al-Munafiqun', englishName: 'The Hypocrites', ayahCount: 11, revelationType: 'medinan', printedPageStart: 554 },
  { id: 64, name: 'التغابن', nameLatin: 'At-Taghabun', englishName: 'The Mutual Disillusion', ayahCount: 18, revelationType: 'medinan', printedPageStart: 556 },
  { id: 65, name: 'الطلاق', nameLatin: 'At-Talaq', englishName: 'The Divorce', ayahCount: 12, revelationType: 'medinan', printedPageStart: 558 },
  { id: 66, name: 'التحريم', nameLatin: 'At-Tahrim', englishName: 'The Prohibition', ayahCount: 12, revelationType: 'medinan', printedPageStart: 560 },
  { id: 67, name: 'الملك', nameLatin: 'Al-Mulk', englishName: 'The Sovereignty', ayahCount: 30, revelationType: 'meccan', printedPageStart: 562 },
  { id: 68, name: 'القلم', nameLatin: 'Al-Qalam', englishName: 'The Pen', ayahCount: 52, revelationType: 'meccan', printedPageStart: 564 },
  { id: 69, name: 'الحاقة', nameLatin: 'Al-Haqqah', englishName: 'The Reality', ayahCount: 52, revelationType: 'meccan', printedPageStart: 566 },
  { id: 70, name: 'المعارج', nameLatin: 'Al-Maarij', englishName: 'The Ascending Stairways', ayahCount: 44, revelationType: 'meccan', printedPageStart: 568 },
  { id: 71, name: 'نوح', nameLatin: 'Nuh', englishName: 'Noah', ayahCount: 28, revelationType: 'meccan', printedPageStart: 570 },
  { id: 72, name: 'الجن', nameLatin: 'Al-Jinn', englishName: 'The Jinn', ayahCount: 28, revelationType: 'meccan', printedPageStart: 572 },
  { id: 73, name: 'المزمل', nameLatin: 'Al-Muzzammil', englishName: 'The Enshrouded One', ayahCount: 20, revelationType: 'meccan', printedPageStart: 574 },
  { id: 74, name: 'المدثر', nameLatin: 'Al-Muddaththir', englishName: 'The Cloaked One', ayahCount: 56, revelationType: 'meccan', printedPageStart: 575 },
  { id: 75, name: 'القيامة', nameLatin: 'Al-Qiyamah', englishName: 'The Resurrection', ayahCount: 40, revelationType: 'meccan', printedPageStart: 577 },
  { id: 76, name: 'الإنسان', nameLatin: 'Al-Insan', englishName: 'The Man', ayahCount: 31, revelationType: 'medinan', printedPageStart: 578 },
  { id: 77, name: 'المرسلات', nameLatin: 'Al-Mursalat', englishName: 'The Emissaries', ayahCount: 50, revelationType: 'meccan', printedPageStart: 580 },
  { id: 78, name: 'النبأ', nameLatin: 'An-Naba', englishName: 'The Tidings', ayahCount: 40, revelationType: 'meccan', printedPageStart: 582 },
  { id: 79, name: 'النازعات', nameLatin: 'An-Naziati', englishName: 'Those Who Drag Forth', ayahCount: 46, revelationType: 'meccan', printedPageStart: 583 },
  { id: 80, name: 'عبس', nameLatin: 'Abasa', englishName: 'He Frowned', ayahCount: 42, revelationType: 'meccan', printedPageStart: 585 },
  { id: 81, name: 'التكوير', nameLatin: 'At-Takwir', englishName: 'The Overthrowing', ayahCount: 29, revelationType: 'meccan', printedPageStart: 586 },
  { id: 82, name: 'الانفطار', nameLatin: 'Al-Infitar', englishName: 'The Cleaving', ayahCount: 19, revelationType: 'meccan', printedPageStart: 587 },
  { id: 83, name: 'المطففين', nameLatin: 'Al-Mutaffifin', englishName: 'The Defrauding', ayahCount: 36, revelationType: 'meccan', printedPageStart: 587 },
  { id: 84, name: 'الانشقاق', nameLatin: 'Al-Inshiqaq', englishName: 'The Sundering', ayahCount: 25, revelationType: 'meccan', printedPageStart: 589 },
  { id: 85, name: 'البروج', nameLatin: 'Al-Buruj', englishName: 'The Mansions of the Stars', ayahCount: 22, revelationType: 'meccan', printedPageStart: 590 },
  { id: 86, name: 'الطارق', nameLatin: 'At-Tariq', englishName: 'The Morning Star', ayahCount: 17, revelationType: 'meccan', printedPageStart: 591 },
  { id: 87, name: 'الأعلى', nameLatin: 'Al-Ala', englishName: 'The Most High', ayahCount: 19, revelationType: 'meccan', printedPageStart: 591 },
  { id: 88, name: 'الغاشية', nameLatin: 'Al-Ghashiyah', englishName: 'The Overwhelming', ayahCount: 26, revelationType: 'meccan', printedPageStart: 592 },
  { id: 89, name: 'الفجر', nameLatin: 'Al-Fajr', englishName: 'The Dawn', ayahCount: 30, revelationType: 'meccan', printedPageStart: 593 },
  { id: 90, name: 'البلد', nameLatin: 'Al-Balad', englishName: 'The City', ayahCount: 20, revelationType: 'meccan', printedPageStart: 594 },
  { id: 91, name: 'الشمس', nameLatin: 'Ash-Shams', englishName: 'The Sun', ayahCount: 15, revelationType: 'meccan', printedPageStart: 595 },
  { id: 92, name: 'الليل', nameLatin: 'Al-Lail', englishName: 'The Night', ayahCount: 21, revelationType: 'meccan', printedPageStart: 595 },
  { id: 93, name: 'الضحى', nameLatin: 'Ad-Duha', englishName: 'The Morning Hours', ayahCount: 11, revelationType: 'meccan', printedPageStart: 596 },
  { id: 94, name: 'الشرح', nameLatin: 'Ash-Sharh', englishName: 'The Relief', ayahCount: 8, revelationType: 'meccan', printedPageStart: 596 },
  { id: 95, name: 'التين', nameLatin: 'At-Tin', englishName: 'The Fig', ayahCount: 8, revelationType: 'meccan', printedPageStart: 597 },
  { id: 96, name: 'العلق', nameLatin: 'Al-Alaq', englishName: 'The Clot', ayahCount: 19, revelationType: 'meccan', printedPageStart: 597 },
  { id: 97, name: 'القدر', nameLatin: 'Al-Qadr', englishName: 'The Power', ayahCount: 5, revelationType: 'meccan', printedPageStart: 598 },
  { id: 98, name: 'البينة', nameLatin: 'Al-Bayyinah', englishName: 'The Clear Proof', ayahCount: 8, revelationType: 'medinan', printedPageStart: 598 },
  { id: 99, name: 'الزلزلة', nameLatin: 'Az-Zalzalah', englishName: 'The Earthquake', ayahCount: 8, revelationType: 'medinan', printedPageStart: 599 },
  { id: 100, name: 'العاديات', nameLatin: 'Al-Adiyat', englishName: 'The Courser', ayahCount: 11, revelationType: 'meccan', printedPageStart: 599 },
  { id: 101, name: 'القارعة', nameLatin: 'Al-Qariah', englishName: 'The Calamity', ayahCount: 11, revelationType: 'meccan', printedPageStart: 600 },
  { id: 102, name: 'التكاثر', nameLatin: 'At-Takathur', englishName: 'The Rivalry In World Increase', ayahCount: 8, revelationType: 'meccan', printedPageStart: 600 },
  { id: 103, name: 'العصر', nameLatin: 'Al-Asr', englishName: 'The Declining Day', ayahCount: 3, revelationType: 'meccan', printedPageStart: 601 },
  { id: 104, name: 'الهُمزة', nameLatin: 'Al-Humazah', englishName: 'The Traducer', ayahCount: 9, revelationType: 'meccan', printedPageStart: 601 },
  { id: 105, name: 'الفيل', nameLatin: 'Al-Fil', englishName: 'The Elephant', ayahCount: 5, revelationType: 'meccan', printedPageStart: 601 },
  { id: 106, name: 'قريش', nameLatin: 'Quraysh', englishName: 'Quraysh', ayahCount: 4, revelationType: 'meccan', printedPageStart: 602 },
  { id: 107, name: 'الماعون', nameLatin: 'Al-Maun', englishName: 'The Small Kindnesses', ayahCount: 7, revelationType: 'meccan', printedPageStart: 602 },
  { id: 108, name: 'الكوثر', nameLatin: 'Al-Kawthar', englishName: 'The Abundance', ayahCount: 3, revelationType: 'meccan', printedPageStart: 602 },
  { id: 109, name: 'الكافرون', nameLatin: 'Al-Kafirun', englishName: 'The Disbelievers', ayahCount: 6, revelationType: 'meccan', printedPageStart: 603 },
  { id: 110, name: 'النصر', nameLatin: 'An-Nasr', englishName: 'The Divine Support', ayahCount: 3, revelationType: 'medinan', printedPageStart: 603 },
  { id: 111, name: 'المسد', nameLatin: 'Al-Masad', englishName: 'The Palm Fiber', ayahCount: 5, revelationType: 'meccan', printedPageStart: 603 },
  { id: 112, name: 'الإخلاص', nameLatin: 'Al-Ikhlas', englishName: 'The Sincerity', ayahCount: 4, revelationType: 'meccan', printedPageStart: 604 },
  { id: 113, name: 'الفلق', nameLatin: 'Al-Falaq', englishName: 'The Daybreak', ayahCount: 5, revelationType: 'meccan', printedPageStart: 604 },
  { id: 114, name: 'الناس', nameLatin: 'An-Nas', englishName: 'Mankind', ayahCount: 6, revelationType: 'meccan', printedPageStart: 604 },
];

// Declared above every use: `JUZ_INFO` below builds its names with `toArabicNumber` while
// this module is still initialising, so a `const` further down would be in the TDZ.
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicNumber(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => ARABIC_DIGITS[parseInt(d, 10)]);
}

/**
 * Converts an already-formatted numeric string to Arabic-Indic digits.
 *
 * `toArabicNumber` only handles whole numbers, so sizes like "3.0" have to come through
 * here instead. The decimal point becomes U+066B (the Arabic decimal separator) rather than
 * a Latin full stop sitting inside RTL text, which renders on the wrong side.
 */
export function toArabicDigits(value: string | number): string {
  return String(value).replace(/[0-9.]/g, (c) =>
    c === '.' ? '٫' : ARABIC_DIGITS[parseInt(c, 10)],
  );
}

export const SURAHS: SurahMeta[] = SURAHS_RAW.map((s) => {
  // The page a surah starts on comes from the flow layout, not from the printed table: the
  // reader's pagination is ours, and a "page 50" label that disagrees with the page the
  // reader turns to is worse than one that differs from a physical mushaf.
  const pageStart = getAyahFlowPage(s.id, 1);
  return { ...s, pageStart, juzStart: getJuzForPage(pageStart) };
});

export const JUZ_INFO: { id: number; name: string; startPage: number; endPage: number }[] =
  JUZ_START_PAGES.map((startPage, i) => ({
    id: i + 1,
    name: `الجزء ${toArabicNumber(i + 1)}`,
    startPage,
    endPage: JUZ_START_PAGES[i + 1] !== undefined ? JUZ_START_PAGES[i + 1] - 1 : TOTAL_QURAN_PAGES,
  }));

export const TOTAL_QURAN_AYAHS = SURAHS.reduce((sum, s) => sum + s.ayahCount, 0);

export function getSurah(id: number): SurahMeta | undefined {
  return SURAHS.find((s) => s.id === id);
}

/**
 * Surahs that appear anywhere within the given juz (pages `startPage`..`endPage`).
 *
 * A long surah can span a juz boundary, so the first entry here may merely *overlap* the
 * juz rather than begin inside it. For navigation, prefer `getSurahsForPage(juz.startPage)`,
 * which resolves to the surah actually holding the juz's opening page.
 */
export function getSurahsByJuz(juzId: number): SurahMeta[] {
  const juz = JUZ_INFO.find((j) => j.id === juzId);
  if (!juz) return [];
  return SURAHS.filter((s) => s.pageStart <= juz.endPage && getSurahEndPage(s) >= juz.startPage);
}



/**
 * Page on which an ayah falls, in our mushaf.
 *
 * An exact lookup, not an interpolation. The line breaks are known (they were measured from
 * the real font and baked into `mushafFlow`), so the page of any ayah is a table read. The
 * previous version scaled an ayah's position inside its surah onto a page range, which could
 * not know that an ayah happened to be the first line of a page — and being able to jump
 * "to the page of this ayah" only means something if it is right.
 */
export function getAyahPage(surah: SurahMeta, ayahNumber: number): number {
  return getAyahFlowPage(surah.id, ayahNumber);
}

/**
 * Last page of a surah — the page its final ayah falls on.
 *
 * Taken from the same table as every other ayah rather than from "the page before the next
 * surah starts": with the flow layout a surah's last page can hold the head of the next one,
 * so the two are not the same thing.
 */
export function getSurahEndPage(surah: SurahMeta): number {
  return getAyahFlowPage(surah.id, surah.ayahCount);
}

/** Surahs whose page range covers the given page. */
export function getSurahsForPage(page: number): SurahMeta[] {
  return SURAHS.filter((s) => s.pageStart <= page && getSurahEndPage(s) >= page);
}

/**
 * Number of ayahs lying inside a juz's page range.
 *
 * Counts ayah by ayah rather than adding up whole surahs, because a long surah can span
 * several juz and would otherwise have its entire ayah count credited to each of them
 * (Al-Baqarah alone would inflate juz 1, 2 and 3 by 286 each).
 */
export function getAyahsInJuz(juzId: number): number {
  const juz = JUZ_INFO.find((j) => j.id === juzId);
  if (!juz) return 0;
  let count = 0;
  for (const surah of SURAHS) {
    const start = surah.pageStart;
    const end = getSurahEndPage(surah);
    if (end < juz.startPage || start > juz.endPage) continue;
    for (let ayah = 1; ayah <= surah.ayahCount; ayah++) {
      const page = getAyahPage(surah, ayah);
      if (page >= juz.startPage && page <= juz.endPage) count++;
    }
  }
  return count;
}
