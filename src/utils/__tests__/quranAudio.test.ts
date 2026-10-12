import './jsdomPolyfills';
import { describe, it, expect } from '@jest/globals';
import { archiveSurahFileUrl, perAyahFileUrl, stripId3, timingsFromDurations } from '@/utils/quranAudio';
import { AUDIO_RECITERS, DEFAULT_RECITER_ID, getAudioReciter } from '@/data/audioReciters';

/**
 * Per-ayah archive sources: URL naming, ID3 stripping for stitching, and
 * timing construction. Network stitching itself needs a browser AudioContext
 * and is verified manually; everything pure around it is pinned here.
 */
describe('perAyahFileUrl', () => {
  it('zero-pads surah and ayah to 3 digits (001001.mp3 = 1:1)', () => {
    expect(perAyahFileUrl('Quran4u_Sweed_Muallim_Ayah', 1, 1)).toBe(
      'https://archive.org/download/Quran4u_Sweed_Muallim_Ayah/001001.mp3',
    );
    expect(perAyahFileUrl('Quran4u_Sweed_Muallim_Ayah', 1, 2)).toBe(
      'https://archive.org/download/Quran4u_Sweed_Muallim_Ayah/001002.mp3',
    );
    expect(perAyahFileUrl('Quran4u_Sweed_Muallim_Ayah', 2, 1)).toBe(
      'https://archive.org/download/Quran4u_Sweed_Muallim_Ayah/002001.mp3',
    );
    expect(perAyahFileUrl('Quran4u_Sweed_Muallim_Ayah', 114, 6)).toBe(
      'https://archive.org/download/Quran4u_Sweed_Muallim_Ayah/114006.mp3',
    );
  });
});

describe('archiveSurahFileUrl', () => {
  it('names whole-surah files 001.mp3 … 114.mp3', () => {
    expect(archiveSurahFileUrl('quran-minshawi-child-repeat', 1)).toBe(
      'https://archive.org/download/quran-minshawi-child-repeat/001.mp3',
    );
    expect(archiveSurahFileUrl('quran-minshawi-child-repeat', 114)).toBe(
      'https://archive.org/download/quran-minshawi-child-repeat/114.mp3',
    );
  });
});

describe('stripId3', () => {
  it('removes an ID3v2 header so stitched frames hold audio only', () => {
    const tagSize = 20;
    const raw = new Uint8Array(10 + tagSize + 100);
    raw[0] = 0x49; // I
    raw[1] = 0x44; // D
    raw[2] = 0x33; // 3
    raw[9] = tagSize; // sync-safe low byte
    raw.fill(0xff, 10 + tagSize); // fake audio frames
    const stripped = stripId3(raw);
    expect(stripped.length).toBe(100);
    expect(stripped[0]).toBe(0xff);
  });

  it('removes a trailing ID3v1 tag', () => {
    const raw = new Uint8Array(200 + 128);
    raw.fill(0xff, 0, 200);
    raw[200] = 0x54; // T
    raw[201] = 0x41; // A
    raw[202] = 0x47; // G
    expect(stripId3(raw).length).toBe(200);
  });

  it('leaves tagless audio untouched', () => {
    const raw = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);
    const stripped = stripId3(raw);
    expect(stripped.length).toBe(raw.length);
    expect(stripped[0]).toBe(0xff);
  });
});

describe('timingsFromDurations', () => {
  it('builds contiguous ayah boundaries from per-ayah durations', () => {
    const timings = timingsFromDurations([2.5, 3.0, 1.25]);
    expect(timings).toEqual([
      { ayah: 1, startMs: 0, endMs: 2500 },
      { ayah: 2, startMs: 2500, endMs: 5500 },
      { ayah: 3, startMs: 5500, endMs: 6750 },
    ]);
  });

  it('returns no timings for no ayahs', () => {
    expect(timingsFromDurations([])).toEqual([]);
  });
});

describe('audio reciters registry', () => {
  it('keeps every Quran.com reciter id resolving to its recitation id', () => {
    for (const reciter of AUDIO_RECITERS) {
      const found = getAudioReciter(reciter.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe(reciter.name);
    }
  });

  it('registers the Sweed muallim per-ayah source', () => {
    const reciter = getAudioReciter('sweed-muallim');
    expect(reciter).toBeDefined();
    expect(reciter!.name).toContain('سويد');
    expect(reciter!.source).toEqual({
      kind: 'per-ayah',
      item: 'Quran4u_Sweed_Muallim_Ayah',
    });
  });

  it('registers the Minshawi children-repetition whole-surah source', () => {
    const reciter = getAudioReciter('minshawi-kids');
    expect(reciter).toBeDefined();
    expect(reciter!.name).toContain('ترديد الأطفال');
    expect(reciter!.source).toEqual({
      kind: 'archive-surah',
      item: 'quran-minshawi-child-repeat',
    });
  });

  it('resolves the stored default reciter', () => {
    expect(getAudioReciter(DEFAULT_RECITER_ID)).toBeDefined();
  });
});
