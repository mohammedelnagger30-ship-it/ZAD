/**
 * What a *reminder* notification rings — the picker behind «أصوات تنبيهات المهام
 * والحفظ»، distinct from the adhan's own voice.
 *
 * A reminder is not the adhan: it lands in the middle of work or study and only needs
 * to be noticed, so it offers short message-style ringtones rather than adhan voices.
 * The app's own chime stays the default; «بدون صوت» silences it entirely.
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
  /** The adhan voice this entry reuses; null for the app chime and message tones. */
  adhan: null;
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
  {
    id: 'msg_chime',
    name: 'رنين — نغمة قصيرة',
    file: 'msg_chime.wav',
    bundled: true,
    adhan: null,
    silent: false,
  },
  {
    id: 'msg_bell',
    name: 'رنين — جرس',
    file: 'msg_bell.wav',
    bundled: true,
    adhan: null,
    silent: false,
  },
  {
    id: 'msg_pop',
    name: 'رنين — نقرة',
    file: 'msg_pop.wav',
    bundled: true,
    adhan: null,
    silent: false,
  },
  {
    id: 'msg_soft',
    name: 'رنين — هادئ',
    file: 'msg_soft.wav',
    bundled: true,
    adhan: null,
    silent: false,
  },
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
  downloaded: ReadonlySet<string> = new Set(),
): boolean {
  if (voice.silent) return true;
  return voice.bundled || downloaded.has(voice.id);
}

/**
 * The voice the reminders should actually ring.
 *
 * All message ringtones ship inside the package, so no download check is needed;
 * an unknown id falls back to the app's own chime.
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
