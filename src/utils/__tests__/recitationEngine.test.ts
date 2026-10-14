import { describe, it, expect, jest } from '@jest/globals';

/**
 * The engine pulls in `quranAudio`, whose store layer needs `TextEncoder` — a
 * Node global jsdom does not install. Nothing here loads a source (the tests
 * drive `setTrack` and the selection only), so the loader is stubbed *for this
 * file alone* rather than reaching for a global jest setup.
 */
jest.unstable_mockModule('@/utils/quranAudio', () => ({ loadSurahAudio: jest.fn() }));

const { getRecitationState, selectAyah, setTrack } = await import('@/utils/recitationEngine');

/**
 * `setTrack` decides what survives navigation.
 *
 * The reader unmounts whenever the user leaves it and mounts again whenever
 * they come back — with `key={surah.id}` it also remounts on every surah
 * change. So the engine has to tell two events apart that look identical from
 * the outside: the *same* track arriving again (the reader coming back over
 * live audio — everything must survive) and a *different* track arriving (the
 * listener has moved on — the previous surah's sound must stop).
 */
const FATIHA = { surahId: 1, surahName: 'الفاتحة', reciterId: 'mishary' } as const;
const BAQARAH = { surahId: 2, surahName: 'البقرة', reciterId: 'mishary' } as const;

describe('recitationEngine setTrack', () => {
  it('binds the track when the reader first mounts', () => {
    setTrack(FATIHA);
    const state = getRecitationState();
    expect(state.surahId).toBe(1);
    expect(state.surahName).toBe('الفاتحة');
    expect(state.reciterId).toBe('mishary');
  });

  it('is a no-op when the reader remounts over the same track', () => {
    setTrack(BAQARAH);
    selectAyah(7);
    expect(getRecitationState().selectedAyah).toBe(7);

    // The reader unmounted (the user went to the home screen) and mounted
    // again on the same surah. This call is the whole feature: if it tore
    // anything down, leaving the screen would still stop the recitation.
    setTrack(BAQARAH);

    const state = getRecitationState();
    expect(state.surahId).toBe(2);
    expect(state.selectedAyah).toBe(7);
  });

  it('resets the selection when the track really changes', () => {
    setTrack(FATIHA);
    selectAyah(9);
    expect(getRecitationState().selectedAyah).toBe(9);

    setTrack(BAQARAH);

    const state = getRecitationState();
    expect(state.surahId).toBe(2);
    // Ayah 9 may not exist in the new surah — carrying it over would make the
    // next «استمع للآية» fail on a timing that is not there.
    expect(state.selectedAyah).toBe(1);
  });

  it('treats a reciter change as a track change', () => {
    setTrack(BAQARAH);
    expect(getRecitationState().reciterId).toBe('mishary');
    setTrack({ ...BAQARAH, reciterId: 'abdulbasit' });
    expect(getRecitationState().reciterId).toBe('abdulbasit');
  });
});
