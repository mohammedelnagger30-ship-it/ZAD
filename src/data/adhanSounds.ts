export interface AdhanSound {
  id: string;
  name: string;
  /** File name — the bundled asset when `bundled`, the stored file name otherwise. */
  file: string;
  source: string;
  /**
   * Ships inside the app (public/audio + android res/raw). Bundled voices work on a
   * fresh install with no network; every other voice is downloaded on demand.
   */
  bundled: boolean;
  /** Where an on-demand voice is published, and how big it is once downloaded. */
  remote?: { path: string; sizeBytes: number };
}

/**
 * On-demand voices are published in the repo (outside `public/`, so they never reach
 * the APK) and served from raw.githubusercontent. The repo is public and raw sends
 * `Access-Control-Allow-Origin: *`, so the WebView can fetch these directly.
 */
export const ADHAN_DOWNLOAD_BASE =
  'https://raw.githubusercontent.com/mohammedelnagger30-ship-it/ZAD/main/content/adhans/';

export function adhanDownloadUrl(sound: AdhanSound): string | null {
  return sound.remote ? ADHAN_DOWNLOAD_BASE + sound.remote.path : null;
}

export const ADHAN_SOUNDS: AdhanSound[] = [
  {
    // أذان السيد النقشبندي is the app's out-of-the-box voice: first in the picker, the
    // fallback for unknown ids, and the default a fresh install starts with.
    id: 'sayyid_naqshbandi',
    name: 'السيد النقشبندي — أذان',
    file: 'adhan_sayyid_naqshbandi.mp3',
    source: 'Archive.org',
    bundled: true,
  },
  {
    id: 'makkah_masjid',
    name: 'المسجد الحرام مكة — أذان',
    file: 'adhan_makkah_masjid.mp3',
    source: 'IslamDownload',
    bundled: true,
  },
  {
    id: 'mishary_alafasy_fajr',
    name: 'مشاري راشد العفاسي — أذان الفجر (مقام حجاز)',
    file: 'adhan_mishary_alafasy_fajr.mp3',
    source: 'Archive.org',
    bundled: true,
  },
  {
    id: 'makkah_2',
    name: 'مكة — أذان',
    file: 'adhan_makkah_2.mp3',
    source: 'IslamDownload',
    bundled: true,
  },
  {
    id: 'asim_javed',
    name: 'عاصم جاويد — أذان الجمعة الثاني',
    file: 'adhan_asim_javed.mp3',
    source: 'CC0',
    bundled: true,
  },
  {
    id: 'adam_synagda',
    name: 'آدم سيناجدا — أذان',
    file: 'adhan_adam_synagda.ogg',
    source: 'CC0',
    bundled: true,
  },
  {
    id: 'alafasy_general',
    name: 'مشاري راشد العفاسي — أذان',
    file: 'adhan_alafasy_general.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_alafasy_general.mp3', sizeBytes: 3094324 },
  },
  {
    id: 'tablawi',
    name: 'محمود الطبلاوي — أذان',
    file: 'adhan_tablawi.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_tablawi.mp3', sizeBytes: 2262980 },
  },
  {
    id: 'ahmad_kurdi',
    name: 'أحمد الكوردي — أذان',
    file: 'adhan_ahmad_kurdi.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_ahmad_kurdi.mp3', sizeBytes: 2446266 },
  },
  {
    id: 'mansur_salmi',
    name: 'منصور السالمي — أذان',
    file: 'adhan_mansur_salmi.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_mansur_salmi.mp3', sizeBytes: 1864689 },
  },
  {
    id: 'nasir_qatami',
    name: 'ناصر القطامي — أذان',
    file: 'adhan_nasir_qatami.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_nasir_qatami.mp3', sizeBytes: 1569272 },
  },
  {
    id: 'makkah_fajr',
    name: 'المسجد الحرام مكة — أذان الفجر',
    file: 'adhan_makkah_fajr.mp3',
    source: 'Archive.org',
    bundled: false,
    remote: { path: 'adhan_makkah_fajr.mp3', sizeBytes: 2926595 },
  },
];

/** The out-of-the-box adhan: أذان السيد النقشبندي, on every fresh install. */
export const DEFAULT_ADHAN_SOUND_ID = 'sayyid_naqshbandi';

export function getAdhanSound(id: string): AdhanSound {
  return ADHAN_SOUNDS.find((sound) => sound.id === id) ?? ADHAN_SOUNDS[0];
}

/** Voices a user can pick straight away: the bundled ones plus any already downloaded. */
export function isAdhanSoundReady(sound: AdhanSound, downloaded: ReadonlySet<string>): boolean {
  return sound.bundled || downloaded.has(sound.id);
}
