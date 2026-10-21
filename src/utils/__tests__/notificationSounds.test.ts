/**
 * The reminder voice.
 *
 * A reminder is not the adhan: it lands in the middle of work or study and only needs to
 * be noticed, so the picker offers short message ringtones rather than adhan voices. Every
 * tone ships inside the package — there is nothing to download — so the one thing that must
 * never happen is a channel pointed at a file that is not on the device, which would ring
 * nothing at all and be discovered only when a reminder never arrives.
 */
import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_NOTIFICATION_VOICE_ID,
  NOTIFICATION_VOICES,
  NOTIFICATION_VOICE_DEFAULT,
  NOTIFICATION_VOICE_NONE,
  getNotificationVoice,
  isNotificationVoiceReady,
  usableNotificationVoice,
} from '@/data/notificationSounds';

describe('notification voices', () => {
  it('offers the app chime, the message ringtones and silence', () => {
    const ids = NOTIFICATION_VOICES.map((voice) => voice.id);

    expect(ids).toContain(NOTIFICATION_VOICE_DEFAULT);
    expect(ids).toContain(NOTIFICATION_VOICE_NONE);
    expect(ids).toEqual(expect.arrayContaining(['msg_chime', 'msg_bell', 'msg_pop', 'msg_soft']));
    // Ids are the identity; a duplicate would make the picker select the wrong tone.
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The design decision the old adhan-derived list did not have: the ringtones are all
   * in the package, so no chosen voice can be missing its file.
   */
  it('bundles every audible tone, so none of them needs a download', () => {
    const audible = NOTIFICATION_VOICES.filter((voice) => !voice.silent);

    expect(audible.length).toBeGreaterThan(1);
    expect(audible.every((voice) => voice.bundled)).toBe(true);
    expect(audible.every((voice) => voice.file.length > 0)).toBe(true);
    // None of them is an adhan voice any more.
    expect(audible.every((voice) => voice.adhan === null)).toBe(true);
  });

  it('gives «بدون صوت» no file at all', () => {
    const none = getNotificationVoice(NOTIFICATION_VOICE_NONE);

    expect(none.silent).toBe(true);
    expect(none.file).toBe('');
  });

  it('names the app chime for the default', () => {
    expect(DEFAULT_NOTIFICATION_VOICE_ID).toBe(NOTIFICATION_VOICE_DEFAULT);
    expect(getNotificationVoice(undefined).id).toBe(NOTIFICATION_VOICE_DEFAULT);
    // An id from a build that no longer exists degrades instead of throwing.
    expect(getNotificationVoice('a-voice-from-2024').id).toBe(NOTIFICATION_VOICE_DEFAULT);
  });

  it('resolves a chosen ringtone with nothing downloaded', () => {
    const chosen = usableNotificationVoice('msg_bell');

    expect(chosen.id).toBe('msg_bell');
    expect(isNotificationVoiceReady(chosen, new Set())).toBe(true);
  });

  it('falls back to the app chime for an unknown voice', () => {
    expect(usableNotificationVoice('a-voice-from-2024').id).toBe(DEFAULT_NOTIFICATION_VOICE_ID);
  });

  it('leaves «بدون صوت» alone — it is a choice, not a missing file', () => {
    const chosen = usableNotificationVoice(NOTIFICATION_VOICE_NONE);

    expect(chosen.silent).toBe(true);
    expect(isNotificationVoiceReady(chosen, new Set())).toBe(true);
  });
});
