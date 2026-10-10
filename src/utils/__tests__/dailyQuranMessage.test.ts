import { describe, it, expect, jest } from '@jest/globals';
import { getDailyQuranMessage, type DailyMessageStorage } from '@/utils/dailyQuranMessage';
import { getAyah } from '@/data/quranText';
import { formatDateKey, addDays } from '@/utils/dateUtils';

/**
 * The daily-message invariants: one message per local day, yesterday's pick is
 * never repeated today, and invalid local data is replaced rather than shown.
 * Expected ayah text is always read from the bundled Quran text — never typed
 * from memory.
 */

function makeStorage(): DailyMessageStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const day1 = new Date('2026-03-10T12:00:00');
const day2 = new Date('2026-03-11T12:00:00');
const onlyKey = (storage: DailyMessageStorage & { data: Map<string, string> }): string => {
  const keys = [...storage.data.keys()];
  expect(keys).toHaveLength(1);
  return keys[0];
};

describe('getDailyQuranMessage', () => {
  it('returns the same message for the whole local day without consuming randomness', () => {
    const storage = makeStorage();
    const first = getDailyQuranMessage(day1, storage, () => 0);
    const random = jest.fn(() => 0.9);
    const second = getDailyQuranMessage(day1, storage, random);

    expect(second.surahId).toBe(first.surahId);
    expect(second.ayahNumber).toBe(first.ayahNumber);
    expect(second.text).toBe(first.text);
    expect(second.date).toBe(formatDateKey(day1));
    expect(random).not.toHaveBeenCalled();
  });

  it('reads the exact text of the chosen ayah from the bundled Quran data', () => {
    const storage = makeStorage();
    const message = getDailyQuranMessage(day1, storage, () => 0);
    const source = getAyah(message.surahId, message.ayahNumber);
    expect(source).toBeDefined();
    expect(message.text).toBe(source!.text);
    expect(message.text.length).toBeGreaterThan(0);
  });

  it('never repeats yesterday’s pick today', () => {
    const storage = makeStorage();
    // Day one with random=0 picks the very first offset (Al-Fatiha 1).
    const first = getDailyQuranMessage(day1, storage, () => 0);
    expect(first.surahId).toBe(1);
    expect(first.ayahNumber).toBe(1);

    // The same offset would repeat on day two — the guard must step aside.
    const second = getDailyQuranMessage(day2, storage, () => 0);
    expect(second.date).toBe(formatDateKey(day2));
    expect(
      second.surahId === first.surahId && second.ayahNumber === first.ayahNumber,
    ).toBe(false);
  });

  it('replaces corrupted local data with a fresh verified verse', () => {
    const storage = makeStorage();
    getDailyQuranMessage(day1, storage, () => 0);
    const key = onlyKey(storage);
    storage.setItem(key, 'not json at all');

    const message = getDailyQuranMessage(day1, storage, () => 0);
    expect(message.surahId).toBeGreaterThanOrEqual(1);
    expect(message.surahId).toBeLessThanOrEqual(114);
    expect(getAyah(message.surahId, message.ayahNumber)).toBeDefined();
    expect(JSON.parse(storage.getItem(key)!).date).toBe(formatDateKey(day1));
  });

  it('replaces a stored reference to a surah that does not exist', () => {
    const storage = makeStorage();
    getDailyQuranMessage(day1, storage, () => 0);
    const key = onlyKey(storage);
    storage.setItem(key, JSON.stringify({ date: formatDateKey(day1), surahId: 999, ayahNumber: 1 }));

    const message = getDailyQuranMessage(day1, storage, () => 0);
    expect(message.surahId).not.toBe(999);
    expect(getAyah(message.surahId, message.ayahNumber)).toBeDefined();
  });

  it('stores an entry another day can build on', () => {
    const storage = makeStorage();
    getDailyQuranMessage(day1, storage, () => 0);
    const key = onlyKey(storage);
    const stored = JSON.parse(storage.getItem(key)!);
    expect(stored.date).toBe(formatDateKey(day1));
    expect(formatDateKey(addDays(day1, 1))).toBe(formatDateKey(day2));
  });

  it('rejects randomness that lands outside the Quran', () => {
    const storage = makeStorage();
    expect(() => getDailyQuranMessage(day1, storage, () => 1)).toThrow(
      'تعذّر اختيار آية صالحة لرسالة القرآن اليومية.',
    );
    expect(() => getDailyQuranMessage(day1, storage, () => -0.5)).toThrow(
      'تعذّر اختيار آية صالحة لرسالة القرآن اليومية.',
    );
  });
});
