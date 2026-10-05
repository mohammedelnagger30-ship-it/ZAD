export interface SurahMeta {
  id: number;
  name: string; // Arabic name
  nameLatin: string;
  englishName: string;
  ayahCount: number;
  revelationType: 'meccan' | 'medinan';
  juzStart: number;
  pageStart: number;
}

export const TOTAL_QURAN_PAGES = 604;

/**
 * Page on which each juz begins in the 604-page Madani mushaf.
 *
 * Juz 1-29 are exactly 20 pages each, but the boundaries are NOT at multiples of 20
 * (e.g. juz 2 starts at page 22, not 21), and juz 30 spans pages 582-604 (23 pages).
 * Any `page / 20` style formula therefore mislabels the last few pages, so the real
 * table is used instead.
 *
 * Declared above `SURAHS` on purpose: `SURAHS` derives each surah's `juzStart` from
 * `getJuzForPage`, and a `const` read before its declaration throws a TDZ error.
 */
export const JUZ_START_PAGES: readonly number[] = [
  1, 22, 42, 62, 82, 102, 122, 142, 162, 182,
  202, 222, 242, 262, 282, 302, 322, 342, 362, 382,
  402, 422, 442, 462, 482, 502, 522, 542, 562, 582,
];

/** Juz (1-30) that contains the given page of the 604-page Madani mushaf. */
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
const SURAHS_RAW: Omit<SurahMeta, 'juzStart'>[] = [
  { id: 1, name: 'الفاتحة', nameLatin: 'Al-Fatihah', englishName: 'The Opening', ayahCount: 7, revelationType: 'meccan', pageStart: 1 },
  { id: 2, name: 'البقرة', nameLatin: 'Al-Baqarah', englishName: 'The Cow', ayahCount: 286, revelationType: 'medinan', pageStart: 2 },
  { id: 3, name: 'آل عمران', nameLatin: 'Aal-E-Imran', englishName: 'The Family of Imran', ayahCount: 200, revelationType: 'medinan', pageStart: 50 },
  { id: 4, name: 'النساء', nameLatin: 'An-Nisa', englishName: 'The Women', ayahCount: 176, revelationType: 'medinan', pageStart: 77 },
  { id: 5, name: 'المائدة', nameLatin: 'Al-Maidah', englishName: 'The Table', ayahCount: 120, revelationType: 'medinan', pageStart: 106 },
  { id: 6, name: 'الأنعام', nameLatin: 'Al-Anam', englishName: 'The Cattle', ayahCount: 165, revelationType: 'meccan', pageStart: 128 },
  { id: 7, name: 'الأعراف', nameLatin: 'Al-Araf', englishName: 'The Heights', ayahCount: 206, revelationType: 'meccan', pageStart: 151 },
  { id: 8, name: 'الأنفال', nameLatin: 'Al-Anfal', englishName: 'The Spoils', ayahCount: 75, revelationType: 'medinan', pageStart: 177 },
  { id: 9, name: 'التوبة', nameLatin: 'At-Tawbah', englishName: 'The Repentance', ayahCount: 129, revelationType: 'medinan', pageStart: 187 },
  { id: 10, name: 'يونس', nameLatin: 'Yunus', englishName: 'Jonah', ayahCount: 109, revelationType: 'meccan', pageStart: 208 },
  { id: 11, name: 'هود', nameLatin: 'Hud', englishName: 'Hud', ayahCount: 123, revelationType: 'meccan', pageStart: 221 },
  { id: 12, name: 'يوسف', nameLatin: 'Yusuf', englishName: 'Joseph', ayahCount: 111, revelationType: 'meccan', pageStart: 235 },
  { id: 13, name: 'الرعد', nameLatin: 'Ar-Rad', englishName: 'The Thunder', ayahCount: 43, revelationType: 'medinan', pageStart: 249 },
  { id: 14, name: 'إبراهيم', nameLatin: 'Ibrahim', englishName: 'Abraham', ayahCount: 52, revelationType: 'meccan', pageStart: 255 },
  { id: 15, name: 'الحجر', nameLatin: 'Al-Hijr', englishName: 'The Rocky Tract', ayahCount: 99, revelationType: 'meccan', pageStart: 262 },
  { id: 16, name: 'النحل', nameLatin: 'An-Nahl', englishName: 'The Bee', ayahCount: 128, revelationType: 'meccan', pageStart: 267 },
  { id: 17, name: 'الإسراء', nameLatin: 'Al-Isra', englishName: 'The Night Journey', ayahCount: 111, revelationType: 'meccan', pageStart: 282 },
  { id: 18, name: 'الكهف', nameLatin: 'Al-Kahf', englishName: 'The Cave', ayahCount: 110, revelationType: 'meccan', pageStart: 293 },
  { id: 19, name: 'مريم', nameLatin: 'Maryam', englishName: 'Mary', ayahCount: 98, revelationType: 'meccan', pageStart: 305 },
  { id: 20, name: 'طه', nameLatin: 'Taha', englishName: 'Ta-Ha', ayahCount: 135, revelationType: 'meccan', pageStart: 312 },
  { id: 21, name: 'الأنبياء', nameLatin: 'Al-Anbiya', englishName: 'The Prophets', ayahCount: 112, revelationType: 'meccan', pageStart: 322 },
  { id: 22, name: 'الحج', nameLatin: 'Al-Hajj', englishName: 'The Pilgrimage', ayahCount: 78, revelationType: 'medinan', pageStart: 332 },
  { id: 23, name: 'المؤمنون', nameLatin: 'Al-Muminun', englishName: 'The Believers', ayahCount: 118, revelationType: 'meccan', pageStart: 342 },
  { id: 24, name: 'النور', nameLatin: 'An-Nur', englishName: 'The Light', ayahCount: 64, revelationType: 'medinan', pageStart: 350 },
  { id: 25, name: 'الفرقان', nameLatin: 'Al-Furqan', englishName: 'The Criterion', ayahCount: 77, revelationType: 'meccan', pageStart: 359 },
  { id: 26, name: 'الشعراء', nameLatin: 'Ash-Shuara', englishName: 'The Poets', ayahCount: 227, revelationType: 'meccan', pageStart: 367 },
  { id: 27, name: 'النمل', nameLatin: 'An-Naml', englishName: 'The Ant', ayahCount: 93, revelationType: 'meccan', pageStart: 377 },
  { id: 28, name: 'القصص', nameLatin: 'Al-Qasas', englishName: 'The Stories', ayahCount: 88, revelationType: 'meccan', pageStart: 385 },
  { id: 29, name: 'العنكبوت', nameLatin: 'Al-Ankabut', englishName: 'The Spider', ayahCount: 69, revelationType: 'meccan', pageStart: 396 },
  { id: 30, name: 'الروم', nameLatin: 'Ar-Rum', englishName: 'The Romans', ayahCount: 60, revelationType: 'meccan', pageStart: 404 },
  { id: 31, name: 'لقمان', nameLatin: 'Luqman', englishName: 'Luqman', ayahCount: 34, revelationType: 'meccan', pageStart: 411 },
  { id: 32, name: 'السجدة', nameLatin: 'As-Sajdah', englishName: 'The Prostration', ayahCount: 30, revelationType: 'meccan', pageStart: 415 },
  { id: 33, name: 'الأحزاب', nameLatin: 'Al-Ahzab', englishName: 'The Clans', ayahCount: 73, revelationType: 'medinan', pageStart: 418 },
  { id: 34, name: 'سبأ', nameLatin: 'Saba', englishName: 'Sheba', ayahCount: 54, revelationType: 'meccan', pageStart: 428 },
  { id: 35, name: 'فاطر', nameLatin: 'Fatir', englishName: 'The Originator', ayahCount: 45, revelationType: 'meccan', pageStart: 434 },
  { id: 36, name: 'يس', nameLatin: 'Ya-Sin', englishName: 'Ya Sin', ayahCount: 83, revelationType: 'meccan', pageStart: 440 },
  { id: 37, name: 'الصافات', nameLatin: 'As-Saffat', englishName: 'Those Who Set The Ranks', ayahCount: 182, revelationType: 'meccan', pageStart: 446 },
  { id: 38, name: 'ص', nameLatin: 'Sad', englishName: 'The Letter Sad', ayahCount: 88, revelationType: 'meccan', pageStart: 453 },
  { id: 39, name: 'الزمر', nameLatin: 'Az-Zumar', englishName: 'The Troops', ayahCount: 75, revelationType: 'meccan', pageStart: 458 },
  { id: 40, name: 'غافر', nameLatin: 'Ghafir', englishName: 'The Forgiver', ayahCount: 85, revelationType: 'meccan', pageStart: 467 },
  { id: 41, name: 'فصلت', nameLatin: 'Fussilat', englishName: 'Explained In Detail', ayahCount: 54, revelationType: 'meccan', pageStart: 477 },
  { id: 42, name: 'الشورى', nameLatin: 'Ash-Shura', englishName: 'The Consultation', ayahCount: 53, revelationType: 'meccan', pageStart: 483 },
  { id: 43, name: 'الزخرف', nameLatin: 'Az-Zukhruf', englishName: 'The Gold Adornments', ayahCount: 89, revelationType: 'meccan', pageStart: 489 },
  { id: 44, name: 'الدخان', nameLatin: 'Ad-Dukhan', englishName: 'The Smoke', ayahCount: 59, revelationType: 'meccan', pageStart: 496 },
  { id: 45, name: 'الجاثية', nameLatin: 'Al-Jathiyah', englishName: 'The Crouching', ayahCount: 37, revelationType: 'meccan', pageStart: 499 },
  { id: 46, name: 'الأحقاف', nameLatin: 'Al-Ahqaf', englishName: 'The Wind-Curved Sandhills', ayahCount: 35, revelationType: 'meccan', pageStart: 502 },
  { id: 47, name: 'محمد', nameLatin: 'Muhammad', englishName: 'Muhammad', ayahCount: 38, revelationType: 'medinan', pageStart: 507 },
  { id: 48, name: 'الفتح', nameLatin: 'Al-Fath', englishName: 'The Victory', ayahCount: 29, revelationType: 'medinan', pageStart: 511 },
  { id: 49, name: 'الحجرات', nameLatin: 'Al-Hujurat', englishName: 'The Rooms', ayahCount: 18, revelationType: 'medinan', pageStart: 515 },
  { id: 50, name: 'ق', nameLatin: 'Qaf', englishName: 'The Letter Qaf', ayahCount: 45, revelationType: 'meccan', pageStart: 518 },
  { id: 51, name: 'الذاريات', nameLatin: 'Adh-Dhariyat', englishName: 'The Winnowing Winds', ayahCount: 60, revelationType: 'meccan', pageStart: 520 },
  { id: 52, name: 'الطور', nameLatin: 'At-Tur', englishName: 'The Mount', ayahCount: 49, revelationType: 'meccan', pageStart: 523 },
  { id: 53, name: 'النجم', nameLatin: 'An-Najm', englishName: 'The Star', ayahCount: 62, revelationType: 'meccan', pageStart: 526 },
  { id: 54, name: 'القمر', nameLatin: 'Al-Qamar', englishName: 'The Moon', ayahCount: 55, revelationType: 'meccan', pageStart: 528 },
  { id: 55, name: 'الرحمن', nameLatin: 'Ar-Rahman', englishName: 'The Beneficent', ayahCount: 78, revelationType: 'medinan', pageStart: 531 },
  { id: 56, name: 'الواقعة', nameLatin: 'Al-Waqiah', englishName: 'The Inevitable', ayahCount: 96, revelationType: 'meccan', pageStart: 534 },
  { id: 57, name: 'الحديد', nameLatin: 'Al-Hadid', englishName: 'The Iron', ayahCount: 29, revelationType: 'medinan', pageStart: 537 },
  { id: 58, name: 'المجادلة', nameLatin: 'Al-Mujadila', englishName: 'The Pleading Woman', ayahCount: 22, revelationType: 'medinan', pageStart: 542 },
  { id: 59, name: 'الحشر', nameLatin: 'Al-Hashr', englishName: 'The Exile', ayahCount: 24, revelationType: 'medinan', pageStart: 545 },
  { id: 60, name: 'الممتحنة', nameLatin: 'Al-Mumtahanah', englishName: 'She That Is To Be Examined', ayahCount: 13, revelationType: 'medinan', pageStart: 549 },
  { id: 61, name: 'الصف', nameLatin: 'As-Saff', englishName: 'The Ranks', ayahCount: 14, revelationType: 'medinan', pageStart: 551 },
  { id: 62, name: 'الجمعة', nameLatin: 'Al-Jumuah', englishName: 'The Congregation', ayahCount: 11, revelationType: 'medinan', pageStart: 553 },
  { id: 63, name: 'المنافقون', nameLatin: 'Al-Munafiqun', englishName: 'The Hypocrites', ayahCount: 11, revelationType: 'medinan', pageStart: 554 },
  { id: 64, name: 'التغابن', nameLatin: 'At-Taghabun', englishName: 'The Mutual Disillusion', ayahCount: 18, revelationType: 'medinan', pageStart: 556 },
  { id: 65, name: 'الطلاق', nameLatin: 'At-Talaq', englishName: 'The Divorce', ayahCount: 12, revelationType: 'medinan', pageStart: 558 },
  { id: 66, name: 'التحريم', nameLatin: 'At-Tahrim', englishName: 'The Prohibition', ayahCount: 12, revelationType: 'medinan', pageStart: 560 },
  { id: 67, name: 'الملك', nameLatin: 'Al-Mulk', englishName: 'The Sovereignty', ayahCount: 30, revelationType: 'meccan', pageStart: 562 },
  { id: 68, name: 'القلم', nameLatin: 'Al-Qalam', englishName: 'The Pen', ayahCount: 52, revelationType: 'meccan', pageStart: 564 },
  { id: 69, name: 'الحاقة', nameLatin: 'Al-Haqqah', englishName: 'The Reality', ayahCount: 52, revelationType: 'meccan', pageStart: 566 },
  { id: 70, name: 'المعارج', nameLatin: 'Al-Maarij', englishName: 'The Ascending Stairways', ayahCount: 44, revelationType: 'meccan', pageStart: 568 },
  { id: 71, name: 'نوح', nameLatin: 'Nuh', englishName: 'Noah', ayahCount: 28, revelationType: 'meccan', pageStart: 570 },
  { id: 72, name: 'الجن', nameLatin: 'Al-Jinn', englishName: 'The Jinn', ayahCount: 28, revelationType: 'meccan', pageStart: 572 },
  { id: 73, name: 'المزمل', nameLatin: 'Al-Muzzammil', englishName: 'The Enshrouded One', ayahCount: 20, revelationType: 'meccan', pageStart: 574 },
  { id: 74, name: 'المدثر', nameLatin: 'Al-Muddaththir', englishName: 'The Cloaked One', ayahCount: 56, revelationType: 'meccan', pageStart: 575 },
  { id: 75, name: 'القيامة', nameLatin: 'Al-Qiyamah', englishName: 'The Resurrection', ayahCount: 40, revelationType: 'meccan', pageStart: 577 },
  { id: 76, name: 'الإنسان', nameLatin: 'Al-Insan', englishName: 'The Man', ayahCount: 31, revelationType: 'medinan', pageStart: 578 },
  { id: 77, name: 'المرسلات', nameLatin: 'Al-Mursalat', englishName: 'The Emissaries', ayahCount: 50, revelationType: 'meccan', pageStart: 580 },
  { id: 78, name: 'النبأ', nameLatin: 'An-Naba', englishName: 'The Tidings', ayahCount: 40, revelationType: 'meccan', pageStart: 582 },
  { id: 79, name: 'النازعات', nameLatin: 'An-Naziati', englishName: 'Those Who Drag Forth', ayahCount: 46, revelationType: 'meccan', pageStart: 583 },
  { id: 80, name: 'عبس', nameLatin: 'Abasa', englishName: 'He Frowned', ayahCount: 42, revelationType: 'meccan', pageStart: 585 },
  { id: 81, name: 'التكوير', nameLatin: 'At-Takwir', englishName: 'The Overthrowing', ayahCount: 29, revelationType: 'meccan', pageStart: 586 },
  { id: 82, name: 'الانفطار', nameLatin: 'Al-Infitar', englishName: 'The Cleaving', ayahCount: 19, revelationType: 'meccan', pageStart: 587 },
  { id: 83, name: 'المطففين', nameLatin: 'Al-Mutaffifin', englishName: 'The Defrauding', ayahCount: 36, revelationType: 'meccan', pageStart: 587 },
  { id: 84, name: 'الانشقاق', nameLatin: 'Al-Inshiqaq', englishName: 'The Sundering', ayahCount: 25, revelationType: 'meccan', pageStart: 589 },
  { id: 85, name: 'البروج', nameLatin: 'Al-Buruj', englishName: 'The Mansions of the Stars', ayahCount: 22, revelationType: 'meccan', pageStart: 590 },
  { id: 86, name: 'الطارق', nameLatin: 'At-Tariq', englishName: 'The Morning Star', ayahCount: 17, revelationType: 'meccan', pageStart: 591 },
  { id: 87, name: 'الأعلى', nameLatin: 'Al-Ala', englishName: 'The Most High', ayahCount: 19, revelationType: 'meccan', pageStart: 591 },
  { id: 88, name: 'الغاشية', nameLatin: 'Al-Ghashiyah', englishName: 'The Overwhelming', ayahCount: 26, revelationType: 'meccan', pageStart: 592 },
  { id: 89, name: 'الفجر', nameLatin: 'Al-Fajr', englishName: 'The Dawn', ayahCount: 30, revelationType: 'meccan', pageStart: 593 },
  { id: 90, name: 'البلد', nameLatin: 'Al-Balad', englishName: 'The City', ayahCount: 20, revelationType: 'meccan', pageStart: 594 },
  { id: 91, name: 'الشمس', nameLatin: 'Ash-Shams', englishName: 'The Sun', ayahCount: 15, revelationType: 'meccan', pageStart: 595 },
  { id: 92, name: 'الليل', nameLatin: 'Al-Lail', englishName: 'The Night', ayahCount: 21, revelationType: 'meccan', pageStart: 595 },
  { id: 93, name: 'الضحى', nameLatin: 'Ad-Duha', englishName: 'The Morning Hours', ayahCount: 11, revelationType: 'meccan', pageStart: 596 },
  { id: 94, name: 'الشرح', nameLatin: 'Ash-Sharh', englishName: 'The Relief', ayahCount: 8, revelationType: 'meccan', pageStart: 596 },
  { id: 95, name: 'التين', nameLatin: 'At-Tin', englishName: 'The Fig', ayahCount: 8, revelationType: 'meccan', pageStart: 597 },
  { id: 96, name: 'العلق', nameLatin: 'Al-Alaq', englishName: 'The Clot', ayahCount: 19, revelationType: 'meccan', pageStart: 597 },
  { id: 97, name: 'القدر', nameLatin: 'Al-Qadr', englishName: 'The Power', ayahCount: 5, revelationType: 'meccan', pageStart: 598 },
  { id: 98, name: 'البينة', nameLatin: 'Al-Bayyinah', englishName: 'The Clear Proof', ayahCount: 8, revelationType: 'medinan', pageStart: 598 },
  { id: 99, name: 'الزلزلة', nameLatin: 'Az-Zalzalah', englishName: 'The Earthquake', ayahCount: 8, revelationType: 'medinan', pageStart: 599 },
  { id: 100, name: 'العاديات', nameLatin: 'Al-Adiyat', englishName: 'The Courser', ayahCount: 11, revelationType: 'meccan', pageStart: 599 },
  { id: 101, name: 'القارعة', nameLatin: 'Al-Qariah', englishName: 'The Calamity', ayahCount: 11, revelationType: 'meccan', pageStart: 600 },
  { id: 102, name: 'التكاثر', nameLatin: 'At-Takathur', englishName: 'The Rivalry In World Increase', ayahCount: 8, revelationType: 'meccan', pageStart: 600 },
  { id: 103, name: 'العصر', nameLatin: 'Al-Asr', englishName: 'The Declining Day', ayahCount: 3, revelationType: 'meccan', pageStart: 601 },
  { id: 104, name: 'الهُمزة', nameLatin: 'Al-Humazah', englishName: 'The Traducer', ayahCount: 9, revelationType: 'meccan', pageStart: 601 },
  { id: 105, name: 'الفيل', nameLatin: 'Al-Fil', englishName: 'The Elephant', ayahCount: 5, revelationType: 'meccan', pageStart: 601 },
  { id: 106, name: 'قريش', nameLatin: 'Quraysh', englishName: 'Quraysh', ayahCount: 4, revelationType: 'meccan', pageStart: 602 },
  { id: 107, name: 'الماعون', nameLatin: 'Al-Maun', englishName: 'The Small Kindnesses', ayahCount: 7, revelationType: 'meccan', pageStart: 602 },
  { id: 108, name: 'الكوثر', nameLatin: 'Al-Kawthar', englishName: 'The Abundance', ayahCount: 3, revelationType: 'meccan', pageStart: 602 },
  { id: 109, name: 'الكافرون', nameLatin: 'Al-Kafirun', englishName: 'The Disbelievers', ayahCount: 6, revelationType: 'meccan', pageStart: 603 },
  { id: 110, name: 'النصر', nameLatin: 'An-Nasr', englishName: 'The Divine Support', ayahCount: 3, revelationType: 'medinan', pageStart: 603 },
  { id: 111, name: 'المسد', nameLatin: 'Al-Masad', englishName: 'The Palm Fiber', ayahCount: 5, revelationType: 'meccan', pageStart: 603 },
  { id: 112, name: 'الإخلاص', nameLatin: 'Al-Ikhlas', englishName: 'The Sincerity', ayahCount: 4, revelationType: 'meccan', pageStart: 604 },
  { id: 113, name: 'الفلق', nameLatin: 'Al-Falaq', englishName: 'The Daybreak', ayahCount: 5, revelationType: 'meccan', pageStart: 604 },
  { id: 114, name: 'الناس', nameLatin: 'An-Nas', englishName: 'Mankind', ayahCount: 6, revelationType: 'meccan', pageStart: 604 },
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

export const SURAHS: SurahMeta[] = SURAHS_RAW.map((s) => ({
  ...s,
  juzStart: getJuzForPage(s.pageStart),
}));

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
 * Last page of a surah in the 604-page Madani mushaf — exact, not an estimate.
 *
 * Surahs appear in the mushaf strictly in order with no gaps, so a surah ends on the
 * page before the next one begins; surah 114 ends on the last page. This replaces an
 * earlier "~15 ayahs per page" guess that was badly wrong for long surahs (Al-Baqarah
 * is 286 ayahs across 48 pages, i.e. ~6 per page) and made whole juz lookups come back
 * empty.
 */
export function getSurahEndPage(surah: SurahMeta): number {
  const next = SURAHS.find((s) => s.id === surah.id + 1);
  if (!next) return TOTAL_QURAN_PAGES;
  return Math.min(Math.max(next.pageStart - 1, surah.pageStart), TOTAL_QURAN_PAGES);
}

/** Surahs whose page range covers the given page. */
export function getSurahsForPage(page: number): SurahMeta[] {
  return SURAHS.filter((s) => s.pageStart <= page && getSurahEndPage(s) >= page);
}

/**
 * Page for a given ayah, spread evenly across the surah's real page range.
 *
 * The bundled data has no per-ayah page map, so the ayah's relative position in the surah
 * is scaled onto the exact `pageStart..endPage` interval. This is an interpolation, not a
 * lookup — it cannot know that one ayah happens to be the last line on a page — but it is
 * monotonic and lands on the correct start/end pages, which a flat "~15 ayahs per page"
 * guess did not (Al-Baqarah averages ~6 per page across its 48 pages).
 */
export function getAyahPage(surah: SurahMeta, ayahNumber: number): number {
  const start = surah.pageStart;
  const end = getSurahEndPage(surah);
  const span = end - start;
  if (span <= 0 || surah.ayahCount <= 1) return start;
  const offset = Math.round(((ayahNumber - 1) / (surah.ayahCount - 1)) * span);
  return Math.min(Math.max(start + offset, start), end);
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
