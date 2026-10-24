/**
 * One sound at a time.
 *
 * The app plays the Qur'an and the lectures through two engines that know nothing about
 * each other. Without this registry, starting a lecture over a running recitation would
 * leave both audible — the exact bug a listener would report as «الصوت مختلط».
 */
import { jest } from '@jest/globals';
import {
  hasAudioFocus,
  registerAudioSource,
  resetAudioFocus,
  takeAudioFocus,
} from '@/utils/audioFocus';

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

test('nobody holds the floor before anything has sounded', () => {
  registerAudioSource('lecture', jest.fn());
  registerAudioSource('recitation', jest.fn());

  expect(hasAudioFocus('lecture')).toBe(false);
  expect(hasAudioFocus('recitation')).toBe(false);
});

test('the floor is held by the last source to take it, and by no one else', () => {
  registerAudioSource('lecture', jest.fn());
  registerAudioSource('recitation', jest.fn());

  takeAudioFocus('lecture');
  expect(hasAudioFocus('lecture')).toBe(true);
  expect(hasAudioFocus('recitation')).toBe(false);

  takeAudioFocus('recitation');
  expect(hasAudioFocus('lecture')).toBe(false);
  expect(hasAudioFocus('recitation')).toBe(true);
});

test('the silenced source is told it lost the floor before it runs its own stop', () => {
  // This is the ordering the lecture player depends on: silencing is what ends its turn,
  // so by the time its `pause` handler runs — a queued task later — it must already see
  // that it no longer holds the card. Otherwise an interrupted lecture repaints the
  // shared player card as «paused» while the recitation that took over is playing.
  let heldWhenStopped: boolean | null = null;
  registerAudioSource('lecture', () => {
    heldWhenStopped = hasAudioFocus('lecture');
  });
  registerAudioSource('recitation', jest.fn());

  takeAudioFocus('recitation');

  expect(heldWhenStopped).toBe(false);
});
