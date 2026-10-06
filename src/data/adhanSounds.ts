export interface AdhanSound {
  id: string;
  name: string;
  file: string;
  source: string;
}

export const ADHAN_SOUNDS: AdhanSound[] = [
  {
    id: 'mishary_alafasy_fajr',
    name: 'مشاري راشد العفاسي — أذان الفجر (مقام حجاز)',
    file: 'adhan_mishary_alafasy_fajr.mp3',
    source: 'Archive.org',
  },
  {
    id: 'makkah_masjid',
    name: 'المسجد الحرام مكة — أذان',
    file: 'adhan_makkah_masjid.mp3',
    source: 'IslamDownload',
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

export const DEFAULT_ADHAN_SOUND_ID = ADHAN_SOUNDS[0].id;

export function getAdhanSound(id: string): AdhanSound {
  return ADHAN_SOUNDS.find((sound) => sound.id === id) ?? ADHAN_SOUNDS[0];
}
