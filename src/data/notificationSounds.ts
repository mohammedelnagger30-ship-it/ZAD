import { ADHAN_SOUNDS, type AdhanSound } from '@/data/adhanSounds';

/**
 * What a *reminder* notification rings — the picker behind «أصوات تنبيهات المهام
 * والحفظ»، distinct from the adhan's own voice.
 *
 * A reminder is not the adhan: it lands in the middle of work or study and only needs
 * to be noticed, so it defaults to the app's own short chime rather than an adhan that
 * would be confusing outside a prayer context. Every voice the app already owns is
 * still on offer, because a memoriser may well want «مشاري العفاسي» to be the voice
 * that tells them their hifz portion is due — and there is no reason to ship a second
 * set of files for it.
 *
 * The adhan entries are *derived* from `ADHAN_SOUNDS` rather than copied, so a voice
 * added for the adhan appears here for free and the two pickers can never disagree
 * about which voices exist.
 */

/** Sentinel: reminders ring nothing at all. */
export const NOTIFICATION_VOICE_NONE = 'none';
/** The app's own short chime — always inside the package, and the default. */
export const NOTIFICATION_VOICE_DEFAULT = 'default';
export const DEFAULT_NOTIFICATION_VOICE_ID = NOTIFICATION_VOICE_DEFAULT;

export interface NotificationVoice {
  id: string;
  name: string;
  /** File name inside `public/audio` — and inside `res/raw` for the bundled ones. */
  file: string;
  bundled: boolean;
  /** The adhan voice this entry reuses; null for the app chime and for «بدون صوت». */
  adhan: AdhanSound | null;
  /** Offered in the picker but never resolvable to a file. */
  silent: boolean;
}

export const NOTIFICATION_VOICES: NotificationVoice[] = [
  {
    id: NOTIFICATION_VOICE_DEFAULT,
    name: 'نغمة التطبيق — تنبيه قصير',
    file: 'notification.wav',
    bundled: true,
    adhan: null,
    silent: false,
  },
  ...ADHAN_SOUNDS.map(
    (sound): NotificationVoice => ({
      id: sound.id,
      name: `${sound.name} — صوت الأذان`,
      file: sound.file,
      bundled: sound.bundled,
      adhan: sound,
      silent: false,
    }),
  ),
  {
    id: NOTIFICATION_VOICE_NONE,
    name: 'بدون صوت — تنبيه صامت',
    file: '',
    bundled: true,
    adhan: null,
    silent: true,
  },
];

export function getNotificationVoice(id: string | undefined): NotificationVoice {
  return NOTIFICATION_VOICES.find((voice) => voice.id === id) ?? NOTIFICATION_VOICES[0];
}

/** Whether this voice can play right now, without a download. */
export function isNotificationVoiceReady(
  voice: NotificationVoice,
  downloaded: ReadonlySet<string>,
): boolean {
  if (voice.silent) return true;
  return voice.bundled || downloaded.has(voice.id);
}

/**
 * The voice the reminders should actually ring.
 *
 * An adhan voice that was picked but never downloaded — or was deleted afterwards —
 * cannot be pointed at, and a channel naming a sound that is not there rings nothing
 * at all. The fallback is the app's own chime, which always ships inside the package.
 */
export function usableNotificationVoice(
  requestedId: string | undefined,
  downloaded: ReadonlySet<string> = new Set(),
): NotificationVoice {
  const voice = getNotificationVoice(requestedId);
  if (voice.silent || voice.bundled) return voice;
  return downloaded.has(voice.id)
    ? voice
    : getNotificationVoice(DEFAULT_NOTIFICATION_VOICE_ID);
}
