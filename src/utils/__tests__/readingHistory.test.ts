import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  recordReading,
  listReading,
  lastReading,
  resumeReading,
  readingParams,
  describeReading,
  describeReadingAge,
  clearReadingHistory,
  READING_STATE_KEY,
} from '@/utils/readingHistory';

const HISTORY_KEY = 'zad:reading-history';

describe('recordReading / listReading', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps a page reading newest-first', () => {
    recordReading({ kind: 'page', page: 5 });
    recordReading({ kind: 'page', page: 6 });

    const entries = listReading();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'page', page: 6 });
    expect(entries[1]).toMatchObject({ kind: 'page', page: 5 });
    expect(lastReading()).toMatchObject({ kind: 'page', page: 6 });
  });

  it('lifts a re-read position to the front instead of duplicating it', () => {
    recordReading({ kind: 'page', page: 5 });
    recordReading({ kind: 'page', page: 6 });
    recordReading({ kind: 'page', page: 5 });

    const entries = listReading();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'page', page: 5 });
    expect(entries[1]).toMatchObject({ kind: 'page', page: 6 });
  });

  it('treats the same surah read from a different ayah as a different place', () => {
    recordReading({ kind: 'surah', surahId: 2, ayah: 1 });
    recordReading({ kind: 'surah', surahId: 2, ayah: 15 });

    const entries = listReading();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'surah', surahId: 2, ayah: 15 });
  });

  it('caps the history at twelve entries', () => {
    for (let page = 1; page <= 20; page++) recordReading({ kind: 'page', page });

    const capped = listReading(100);
    expect(capped).toHaveLength(12);
    expect(lastReading()).toMatchObject({ kind: 'page', page: 20 });
    expect(capped[capped.length - 1]).toMatchObject({ kind: 'page', page: 9 });
  });

  it('drops impossible positions instead of recording them', () => {
    recordReading({ kind: 'page', page: 0 });
    recordReading({ kind: 'page', page: 603 });
    recordReading({ kind: 'page', page: 2.5 });
    recordReading({ kind: 'surah', surahId: 999 });
    recordReading({ kind: 'surah', surahId: 1, ayah: 99 });
    recordReading({ kind: 'surah', surahId: 1, ayah: -3 });

    expect(listReading()).toEqual([]);
  });

  it('recovers from a malformed stored list', () => {
    localStorage.setItem(HISTORY_KEY, '{not json');

    expect(listReading()).toEqual([]);

    // The write path starts from the parsed (empty) list rather than failing.
    recordReading({ kind: 'page', page: 7 });
    expect(lastReading()).toMatchObject({ kind: 'page', page: 7 });
  });

  it('ignores entries a foreign writer left behind', () => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify([
      { kind: 'page', page: 999, at: 10 },   // out of range
      { kind: 'aiyah', page: 3, at: 20 },    // unknown kind
      { kind: 'page', page: 8, at: 'soon' }, // no usable timestamp
      { kind: 'page', page: 9, at: 30 },     // the only survivor
    ]));

    expect(listReading()).toEqual([{ kind: 'page', page: 9, at: 30 }]);
  });

  it('wipes the history and the reader state at sign-out', () => {
    recordReading({ kind: 'page', page: 3 });
    localStorage.setItem(READING_STATE_KEY, '{"viewMode":"mushaf","mushafPage":3}');

    clearReadingHistory();

    expect(localStorage.getItem(HISTORY_KEY)).toBeNull();
    expect(localStorage.getItem(READING_STATE_KEY)).toBeNull();
    expect(resumeReading()).toBeNull();
  });
});

describe('resumeReading', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers the newest history entry', () => {
    localStorage.setItem(READING_STATE_KEY, JSON.stringify({
      viewMode: 'mushaf', mushafPage: 40, hasMushafPosition: true,
    }));
    recordReading({ kind: 'surah', surahId: 36, ayah: 5 });

    expect(resumeReading()).toEqual({ kind: 'surah', surahId: 36, ayah: 5 });
  });

  it('falls back to the reader state saved before the history existed', () => {
    localStorage.setItem(READING_STATE_KEY, JSON.stringify({
      viewMode: 'mushaf', mushafPage: 58, hasMushafPosition: true,
    }));

    expect(resumeReading()).toEqual({ kind: 'page', page: 58 });
  });

  it('resumes a surah view from its own saved view, not the older page behind it', () => {
    localStorage.setItem(READING_STATE_KEY, JSON.stringify({
      viewMode: 'reader', surahId: 36, fromAyah: 12, mushafPage: 40, hasMushafPosition: true,
    }));

    expect(resumeReading()).toEqual({ kind: 'surah', surahId: 36, ayah: 12 });
  });

  it('returns null when there is nothing to resume', () => {
    expect(resumeReading()).toBeNull();

    localStorage.setItem(READING_STATE_KEY, '{broken');
    expect(resumeReading()).toBeNull();

    // A stored page outside the mushaf is not a position.
    localStorage.setItem(READING_STATE_KEY, JSON.stringify({ viewMode: 'mushaf', mushafPage: 0 }));
    expect(resumeReading()).toBeNull();
  });
});

describe('describeReading', () => {
  it('names a page in Arabic-Indic numerals', () => {
    expect(describeReading({ kind: 'page', page: 58, at: 1 })).toBe('الصفحة ٥٨');
    expect(describeReading({ kind: 'page', page: 1, at: 1 })).toBe('الصفحة ١');
  });

  it('names a surah, and adds the starting ayah only when it is not the first', () => {
    expect(describeReading({ kind: 'surah', surahId: 36, ayah: 1, at: 1 })).toBe('سورة يس');
    expect(describeReading({ kind: 'surah', surahId: 2, ayah: 15, at: 1 })).toBe('سورة البقرة · من الآية ١٥');
  });
});

describe('describeReadingAge', () => {
  const now = 1_760_000_000_000;
  const ago = (minutes: number) => now - minutes * 60_000;

  it('says «الآن» inside the first minute', () => {
    expect(describeReadingAge(ago(0), now)).toBe('الآن');
    expect(describeReadingAge(ago(0.9), now)).toBe('الآن');
  });

  it('counts minutes, hours and days with Arabic plural agreement', () => {
    expect(describeReadingAge(ago(5), now)).toBe('منذ ٥ دقائق');
    expect(describeReadingAge(ago(2), now)).toBe('منذ دقيقتان');
    expect(describeReadingAge(ago(11), now)).toBe('منذ ١١ دقيقة');
    expect(describeReadingAge(ago(3 * 60), now)).toBe('منذ ٣ ساعات');
    expect(describeReadingAge(ago(60), now)).toBe('منذ ساعة');
    expect(describeReadingAge(ago(2 * 60), now)).toBe('منذ ساعتان');
  });

  it('says «أمس» for a single day, then counts days', () => {
    expect(describeReadingAge(ago(24 * 60), now)).toBe('أمس');
    expect(describeReadingAge(ago(3 * 24 * 60), now)).toBe('منذ ٣ أيام');
    expect(describeReadingAge(ago(11 * 24 * 60), now)).toBe('منذ ١١ يوماً');
  });
});

describe('readingParams', () => {
  it('maps positions onto the reader deep links', () => {
    expect(readingParams({ kind: 'page', page: 58 })).toEqual({ openPage: 58 });
    expect(readingParams({ kind: 'surah', surahId: 2, ayah: 15 })).toEqual({ openSurahId: 2, openAyah: 15 });
    expect(readingParams({ kind: 'surah', surahId: 2 })).toEqual({ openSurahId: 2, openAyah: 1 });
  });
});
