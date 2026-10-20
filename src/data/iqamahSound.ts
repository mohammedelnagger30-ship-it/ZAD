/**
 * The iqamah's own sound (أذان الإقامة) — the short call that rings at the جماعة's
 * minute, *after* the adhan has had its own.
 *
 * It is a separate recording from the adhan on purpose: the adhan is a full call to
 * prayer, minutes long, and ringing it a second time a few minutes later would be the
 * same announcement twice. This file is the iqamah itself — takbirs and the invitation
 * to line up — so «حان وقت الإقامة» arrives as a distinct sound, once, at its minute.
 *
 * Bundled like the default adhan voice (`public/audio` for the WebView,
 * `android/app/src/main/res/raw` for the notification channel), so it works on a fresh
 * install with no network — the prayer minute cannot wait for a download.
 *
 * Both recordings are *restored*, not shipped as-is: the sources are quiet and — in the
 * mosque's case — heavily muffled (most of the voice sat under 100-300 Hz rumble). Each
 * was re-extracted from its highest-quality master, then denoised, de-boomed, brought
 * back to the speech presence band and normalised to −14 LUFS, so «حان وقت الإقامة» is
 * loud and intelligible on a phone speaker. CC BY / CC BY-SA both permit modification;
 * what they require — the credit — is kept below and in `SOURCES.md`.
 *
 * The source, author and licence are part of the record, not decoration: the file is
 * CC BY-SA 4.0 / CC BY 4.0, which requires attribution wherever it is redistributed.
 * They are documented in `src/data/SOURCES.md` and read by {@link iqamahSoundAttribution}.
 */
export interface IqamahSound {
  id: string;
  name: string;
  /** File name — the same file in `public/audio` and in `res/raw`. */
  file: string;
  /** Where the recording came from, for the credits. */
  source: string;
  sourceUrl: string;
  /** The recording's own title at its source. */
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** Ships inside the app; no download, no network. */
  bundled: boolean;
}

/** A complete iqamah (takbirs, both shahadahs, حي على الصلاة, قد قامت الصلاة, closing takbirs). */
export const IQAMAH_KAMIL: IqamahSound = {
  id: 'kamil_iqamah',
  name: 'الإقامة الكاملة — من تسجيل الصلاة',
  file: 'iqama_kamil.mp3',
  source: 'Internet Archive',
  sourceUrl: 'https://archive.org/details/salah-islamic-prayer-translation-with-audio',
  title: 'Islamic Salat Procedure',
  author: 'Joseph Lloyd Zacker',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  bundled: true,
};

/** The existing mosque recording (fragment starting mid-sentence). */
export const IQAMAH_MASJID: IqamahSound = {
  id: 'masjid_iqamah',
  name: 'الإقامة — تسجيل المسجد',
  file: 'iqama.mp3',
  source: 'Wikimedia Commons',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:Iqama_during_Ramadan.wav',
  title: 'Iqama during Ramadan',
  author: 'daSupremo',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  bundled: true,
};

/** A soft chime for users who prefer a gentle tone (synthesised in-app, no source file). */
export const IQAMAH_SOFT_TONE: IqamahSound = {
  id: 'soft_tone',
  name: 'نغمة إقامة هادئة',
  file: 'iqama_tone.wav',
  source: 'Bundled app asset',
  sourceUrl: '',
  title: 'Soft iqamah chime',
  author: 'Hifzi App',
  license: 'App bundled (CC0-like)',
  licenseUrl: '',
  bundled: true,
};

/** All available iqamah sounds, in display order. */
export const IQAMAH_SOUNDS: readonly IqamahSound[] = [
  IQAMAH_KAMIL,
  IQAMAH_MASJID,
  IQAMAH_SOFT_TONE,
] as const;

/** Default iqamah sound ID — the complete recording. */
export const DEFAULT_IQAMAH_SOUND_ID = IQAMAH_KAMIL.id;

/** Look up an iqamah sound by its ID. */
export function getIqamahSound(id: string): IqamahSound {
  return IQAMAH_SOUNDS.find((s) => s.id === id) ?? IQAMAH_KAMIL;
}

/** URL the WebView plays for a given iqamah sound ID. */
export function iqamahPlayUrl(id: string = DEFAULT_IQAMAH_SOUND_ID): string {
  const sound = getIqamahSound(id);
  return `/audio/${sound.file}`;
}

/**
 * The attribution line the licence asks for.
 *
 * The licence conditions redistribution on crediting the author, so this travels with
 * the file: shown beside its preview in Settings, and written out in `SOURCES.md`.
 */
export function iqamahSoundAttribution(id: string = DEFAULT_IQAMAH_SOUND_ID): string {
  const sound = getIqamahSound(id);
  return `«${sound.title}» لـ${sound.author} — ${sound.source}، ${sound.license}`;
}
