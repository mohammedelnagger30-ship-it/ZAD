/**
 * One sound at a time.
 *
 * The app plays the Qur'an and the lectures through two engines that know nothing about
 * each other. Without this registry, starting a lecture over a running recitation would
 * leave both audible — the exact bug a listener would report as «الصوت مختلط».
 */
import { jest } from '@jest/globals';
import { registerAudioSource, resetAudioFocus, takeAudioFocus } from '@/utils/audioFocus';

beforeEach(() => {
  resetAudioFocus();
});

test('taking the floor silences every other source and only the others', () => {
  const recitation = jest.fn();
  const adhan = jest.fn();
  registerAudioSource('recitation', recitation);
  registerAudioSource('adhan', adhan);

  takeAudioFocus('lecture');

  expect(recitation).toHaveBeenCalledTimes(1);
  expect(adhan).toHaveBeenCalledTimes(1);
});

test('a source may take the floor without silencing itself', () => {
  const lecture = jest.fn();
  registerAudioSource('lecture', lecture);

  takeAudioFocus('lecture');

  expect(lecture).not.toHaveBeenCalled();
});

test('re-registering replaces the previous stopper rather than stacking it', () => {
  const first = jest.fn();
  const second = jest.fn();
  registerAudioSource('recitation', first);
  registerAudioSource('recitation', second);

  takeAudioFocus('lecture');

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
