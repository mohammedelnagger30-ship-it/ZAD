export interface QuranComReciterSource {
  kind: 'qurancom';
  /** Recitation id on api.quran.com (whole-surah file + verse timestamps). */
  recitationId: string;
}

export interface PerAyahArchiveReciterSource {
  kind: 'per-ayah';
  /**
   * archive.org item whose files are named `{surah:03d}{ayah:03d}.mp3`,
   * one file per ayah (e.g. `001001.mp3` = Al-Fatiha, ayah 1).
   */
  item: string;
}

export interface ArchiveSurahReciterSource {
  kind: 'archive-surah';
  /**
   * archive.org item with one MP3 file per surah, named `{surah:03d}.mp3
   * (e.g. `001.mp3` = Al-Fatiha). Used for recordings with no published
   * verse timings — the surah plays as one whole file.
   */
  item: string;
}

export type AudioReciterSource =
  | QuranComReciterSource
  | PerAyahArchiveReciterSource
  | ArchiveSurahReciterSource;

export interface AudioReciter {
  id: string;
  name: string;
  source: AudioReciterSource;
}

function qurancom(recitationId: string): AudioReciterSource {
  return { kind: 'qurancom', recitationId };
}

/** Arabic recitations and narration styles available from Quran.com. */
export const AUDIO_RECITERS: AudioReciter[] = [
  { id: '97', name: 'ياسر الدوسري', source: qurancom('97') },
  { id: '7', name: 'مشاري العفاسي — مرتل', source: qurancom('7') },
  { id: '3', name: 'عبدالرحمن السديس', source: qurancom('3') },
  { id: '6', name: 'محمود خليل الحصري — مرتل', source: qurancom('6') },
  { id: '12', name: 'محمود خليل الحصري — معلم', source: qurancom('12') },
  { id: '4', name: 'أبو بكر الشاطري', source: qurancom('4') },
  { id: '5', name: 'هاني الرفاعي', source: qurancom('5') },
  { id: '9', name: 'محمد صديق المنشاوي — مرتل', source: qurancom('9') },
  { id: '10', name: 'سعود الشريم', source: qurancom('10') },
  { id: '1', name: 'عبد الباسط عبد الصمد — مجود', source: qurancom('1') },
  { id: '2', name: 'عبد الباسط عبد الصمد — مرتل', source: qurancom('2') },
  // المصحف المعلّم للشيخ أيمن سويد (إيقاع تعليمي بطيء بوقفات): ملف لكل آية
  // على archive.org — التسمية `{سورة ٣ أرقام}{آية ٣ أرقام}.mp3` بعدد آيات المصحف.
  {
    id: 'sweed-muallim',
    name: 'أيمن سويد — معلم',
    source: { kind: 'per-ayah', item: 'Quran4u_Sweed_Muallim_Ayah' },
  },
  // المصحف المعلّم للشيخ محمد صديق المنشاوي **مع ترديد الأطفال**: الشيخ يقرأ
  // المقطع ثم يعيده الأطفال وراءه داخل التسجيل نفسه — ملف واحد لكل سورة على
  // archive.org (`001.mp3` = الفاتحة). لا توجد توقيتات آيات منشورة لهذا
  // التسجيل، فيُشغَّل سورةً كاملة (ملف واحد) بلا تقطيع للآيات.
  {
    id: 'minshawi-kids',
    name: 'المنشاوي — معلم (ترديد الأطفال)',
    source: { kind: 'archive-surah', item: 'quran-minshawi-child-repeat' },
  },
];

export function getAudioReciter(id: string): AudioReciter | undefined {
  return AUDIO_RECITERS.find((reciter) => reciter.id === id);
}

export const DEFAULT_RECITER_ID = AUDIO_RECITERS[0].id;
export const RECITER_STORAGE_KEY = 'hifzi-audio-reciter';

export function loadPreferredReciter(): string {
  const stored = localStorage.getItem(RECITER_STORAGE_KEY);
  return AUDIO_RECITERS.some((reciter) => reciter.id === stored) ? stored! : DEFAULT_RECITER_ID;
}

export function savePreferredReciter(reciterId: string): void {
  localStorage.setItem(RECITER_STORAGE_KEY, reciterId);
}
