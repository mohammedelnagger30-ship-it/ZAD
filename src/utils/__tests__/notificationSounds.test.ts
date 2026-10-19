/**
 * The reminder voice.
 *
 * What is on the device decides what a task, a review, the hadith of the day or a dhikr
 * reminder can actually ring: a channel pointed at a file that is not there rings
 * nothing at all, and the failure is only discovered when a reminder never arrives.
 * The fallback is therefore the whole point of this module.
 */
import { describe, it, expect } from '@jest/globals';
import { ADHAN_SOUNDS } from '@/data/adhanSounds';
import {
  DEFAULT_NOTIFICATION_VOICE_ID,
  NOTIFICATION_VOICES,
  NOTIFICATION_VOICE_DEFAULT,
  NOTIFICATION_VOICE_NONE,
  getNotificationVoice,
  isNotificationVoiceReady,
  usableNotificationVoice,
} from '@/data/notificationSounds';

const DOWNLOADABLE = ADHAN_SOUNDS.find((sound) => !sound.bundled);
if (!DOWNLOADABLE) throw new Error('the adhan list must keep at least one downloadable voice');

const BUNDLED_ADHAN = ADHAN_SOUNDS.find((sound) => sound.bundled);
if (!BUNDLED_ADHAN) throw new Error('the adhan list must keep at least one bundled voice');

describe('notification voices', () => {
  it('offers every adhan voice, the app chime and silence', () => {
    const ids = NOTIFICATION_VOICES.map((voice) => voice.id);

    expect(ids).toContain(NOTIFICATION_VOICE_DEFAULT);
    expect(ids).toContain(NOTIFICATION_VOICE_NONE);
    for (const sound of ADHAN_SOUNDS) expect(ids).toContain(sound.id);
    // The adhan entries are derived, so the two pickers cannot drift apart.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names the app chime for both defaults', () => {
    expect(DEFAULT_NOTIFICATION_VOICE_ID).toBe(NOTIFICATION_VOICE_DEFAULT);
    expect(getNotificationVoice(undefined).id).toBe(NOTIFICATION_VOICE_DEFAULT);
    // An id from a build that no longer exists degrades instead of throwing.
    expect(getNotificationVoice('a-voice-from-2024').id).toBe(NOTIFICATION_VOICE_DEFAULT);
  });

  it('keeps a bundled voice with nothing downloaded', () => {
    const chosen = usableNotificationVoice(BUNDLED_ADHAN.id);
    expect(chosen.id).toBe(BUNDLED_ADHAN.id);
    expect(isNotificationVoiceReady(chosen, new Set())).toBe(true);
  });

  /**
   * The picker offers a voice the user may never have downloaded — the download button
   * sits right under it. Until that button is pressed, the reminders must ring the app
   * chime rather than a file that is not on the device.
   */
  it('falls back to the app chime for a voice that was never downloaded', () => {
    const chosen = usableNotificationVoice(DOWNLOADABLE.id, new Set());

    expect(chosen.id).toBe(DEFAULT_NOTIFICATION_VOICE_ID);
    expect(chosen.bundled).toBe(true);
  });

  it('uses a downloaded voice once it is on the device', () => {
    const chosen = usableNotificationVoice(DOWNLOADABLE.id, new Set([DOWNLOADABLE.id]));

    expect(chosen.id).toBe(DOWNLOADABLE.id);
    expect(isNotificationVoiceReady(chosen, new Set([DOWNLOADABLE.id]))).toBe(true);
  });

  it('leaves «بدون صوت» alone — it is a choice, not a missing file', () => {
    const chosen = usableNotificationVoice(NOTIFICATION_VOICE_NONE);

    expect(chosen.silent).toBe(true);
    expect(isNotificationVoiceReady(chosen, new Set())).toBe(true);
  });
});
