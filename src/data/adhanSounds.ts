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
];

/** The out-of-the-box adhan: أذان المسجد الحرام بمكة, on every fresh install. */
export const DEFAULT_ADHAN_SOUND_ID = 'makkah_masjid';

export function getAdhanSound(id: string): AdhanSound {
  return ADHAN_SOUNDS.find((sound) => sound.id === id) ?? ADHAN_SOUNDS[0];
}
