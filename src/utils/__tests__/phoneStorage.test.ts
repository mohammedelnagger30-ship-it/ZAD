/**
 * The name a lecture takes with it onto the phone, and the little map that remembers
 * which file on the phone belongs to which lecture.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, isPluginAvailable: () => false },
  registerPlugin: () => ({ list: jest.fn(), save: jest.fn(), remove: jest.fn() }),
}));

const { phoneFileName, readPhoneManifest, writePhoneManifest } = await import('@/utils/phoneStorage');

beforeEach(() => {
  window.localStorage.clear();
});

test('the file is named after the lecture, not after its archive id', () => {
  expect(phoneFileName('سلسلة النبلاء — الدرس ١')).toBe('سلسلة النبلاء — الدرس ١.mp3');
});

test('no character a file system would choke on survives', () => {
  expect(phoneFileName('a/b:c*d?"e"<f>g|h')).toBe('a b c d e f g h.mp3');
});

test('a title of nothing but separators still makes a usable name', () => {
  expect(phoneFileName('///')).toBe('محاضرة.mp3');
  expect(phoneFileName('   ')).toBe('محاضرة.mp3');
});

test('a leading dot cannot hide the file, and a long title is cut short', () => {
  expect(phoneFileName('.درس')).toBe('درس.mp3');
  expect(phoneFileName('د'.repeat(400))).toBe(`${'د'.repeat(100)}.mp3`);
});

test('the map survives a round trip', () => {
  writePhoneManifest({ 'a-1': 'درس.mp3' });
  expect(readPhoneManifest()).toEqual({ 'a-1': 'درس.mp3' });
});

test('a damaged or unexpected map is read as empty, never as a crash', () => {
  window.localStorage.setItem('huwaini-phone-files', 'not json');
  expect(readPhoneManifest()).toEqual({});

  window.localStorage.setItem('huwaini-phone-files', '[1,2,3]');
  expect(readPhoneManifest()).toEqual({});

  window.localStorage.setItem('huwaini-phone-files', '{"a-1":42,"b-2":"درس.mp3"}');
  expect(readPhoneManifest()).toEqual({ 'b-2': 'درس.mp3' });
});
