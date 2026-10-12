export interface AdhanSound {
  id: string;
  name: string;
  file: string;
  source: string;
}

export const ADHAN_SOUNDS: AdhanSound[] = [
  {
    // The Makkah adhan (المسجد الحرام) is the app's out-of-the-box voice: first in the
    // picker, the fallback for unknown ids, and the default a fresh install starts with.
    id: 'makkah_masjid',
    name: 'المسجد الحرام مكة — أذان',
    file: 'adhan_makkah_masjid.mp3',
    source: 'IslamDownload',
  },
  {
    id: 'makkah_fajr',
    name: 'المسجد الحرام مكة — أذان الفجر',
    file: 'adhan_makkah_fajr.mp3',
    source: 'Archive.org',
  },
  {
    id: 'mishary_alafasy_fajr',
    name: 'مشاري راشد العفاسي — أذان الفجر (مقام حجاز)',
    file: 'adhan_mishary_alafasy_fajr.mp3',
    source: 'Archive.org',
  },
  {
    id: 'makkah_2',
    name: 'مكة — أذان',
    file: 'adhan_makkah_2.mp3',
    source: 'IslamDownload',
  },
  {
    id: 'asim_javed',
    name: 'عاصم جاويد — أذان الجمعة الثاني',
    file: 'adhan_asim_javed.mp3',
    source: 'CC0',
  },
  {
    id: 'adam_synagda',
    name: 'آدم سيناجدا — أذان',
    file: 'adhan_adam_synagda.ogg',
    source: 'CC0',
  },
  {
    id: 'alafasy_general',
    name: 'مشاري راشد العفاسي — أذان',
    file: 'adhan_alafasy_general.mp3',
    source: 'Archive.org',
  },
  {
    id: 'sayyid_naqshbandi',
    name: 'السيد النقشبندي — أذان',
    file: 'adhan_sayyid_naqshbandi.mp3',
    source: 'Archive.org',
  },
  {
    id: 'tablawi',
    name: 'محمود الطبلاوي — أذان',
    file: 'adhan_tablawi.mp3',
    source: 'Archive.org',
  },
  {
    id: 'ahmad_kurdi',
    name: 'أحمد الكوردي — أذان',
    file: 'adhan_ahmad_kurdi.mp3',
    source: 'Archive.org',
  },
  {
    id: 'mansur_salmi',
    name: 'منصور السالمي — أذان',
    file: 'adhan_mansur_salmi.mp3',
    source: 'Archive.org',
  },
  {
    id: 'nasir_qatami',
    name: 'ناصر القطامي — أذان',
    file: 'adhan_nasir_qatami.mp3',
    source: 'Archive.org',
  },
];

/** The out-of-the-box adhan: أذان المسجد الحرام بمكة, on every fresh install. */
export const DEFAULT_ADHAN_SOUND_ID = 'makkah_masjid';

export function getAdhanSound(id: string): AdhanSound {
  return ADHAN_SOUNDS.find((sound) => sound.id === id) ?? ADHAN_SOUNDS[0];
}
