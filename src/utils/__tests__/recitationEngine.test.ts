import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * The engine pulls in `quranAudio`, whose store layer needs `TextEncoder` — a
 * Node global jsdom does not install — and jsdom ships no media pipeline at
 * all. Both are stubbed *for this file alone*: the loader is replaced outright,
 * and `play`/`pause` become spies that resolve so the engine's own intent
 * handling (which never looks at jsdom's playback state, only at its own) is
 * what gets exercised.
 */
const loadSurahAudioMock = jest.fn<
  (
    reciterId: string,
    surahId: number,
    signal?: AbortSignal,
  ) => Promise<{ url: string; blob: Blob | null; verseTimings: { ayah: number; startMs: number; endMs: number }[] }>
>();
jest.unstable_mockModule('@/utils/quranAudio', () => ({ loadSurahAudio: loadSurahAudioMock }));

/**
 * A stand-in for the system's media controls: `setActionHandler` captures each
 * handler so a test can press «التالي» exactly as a headset would.
 */
const sessionHandlers: Record<string, (() => void) | null | undefined> = {};
Object.defineProperty(navigator, 'mediaSession', {
  configurable: true,
  value: {
    metadata: null,
    playbackState: 'none',
    setActionHandler(action: string, handler: (() => void) | null) {
      sessionHandlers[action] = handler;
    },
    setPositionState() {
      /* cosmetic */
    },
  },
});
(globalThis as { MediaMetadata?: unknown }).MediaMetadata = class {
  constructor(init: Record<string, unknown>) {
    Object.assign(this, init);
  }
};

const engine = await import('@/utils/recitationEngine');

const TIMINGS = [
  { ayah: 1, startMs: 0, endMs: 1000 },
  { ayah: 2, startMs: 1000, endMs: 2000 },
  { ayah: 3, startMs: 2000, endMs: 3000 },
];

const FATIHA = { surahId: 1, surahName: 'الفاتحة', reciterId: 'mishary' };

/** Let the engine's play() promise chains settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function recitationAudio(): HTMLAudioElement {
  const element = document.querySelector('audio');
  if (!element) throw new Error('the engine did not attach its audio element');
  return element;
}

/** Start playback and wait until the engine agrees it is sounding. */
async function playFirstAyah(): Promise<void> {
  await engine.ensureSource();
  engine.playAyah(1, true);
  await flush();
}

describe('recitationEngine playback', () => {
  let playSpy: ReturnType<typeof jest.spyOn>;
  let pauseSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // Spies first: `stop()` below reaches for the element, and jsdom's real
    // `pause` is a not-implemented stub that logs an error.
    playSpy = jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    pauseSpy = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    engine.stop();
    for (const key of Object.keys(sessionHandlers)) delete sessionHandlers[key];
    loadSurahAudioMock.mockResolvedValue({
      url: 'blob:recitation',
      blob: null,
      verseTimings: TIMINGS,
    });
    engine.setTrack(FATIHA);
  });

  afterEach(() => {
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });

  it('opens the media session once playback actually starts', async () => {
    await playFirstAyah();

    const state = engine.getRecitationState();
    expect(state.isPlaying).toBe(true);
    expect(state.sessionOpen).toBe(true);
    expect(state.activeAyah).toBe(1);
    expect(sessionHandlers.play).toBeDefined();
    expect(sessionHandlers.pause).toBeDefined();
    expect(sessionHandlers.seekforward).toBeDefined();
    expect(sessionHandlers.seekbackward).toBeDefined();
  });

  /**
   * The feature: a phone call takes the audio. The recitation must read as
   * paused — not stopped — so the ayah, the source and the lock-screen card
   * are all still there when the call is over.
   */
  it('reads a system pause as an interruption rather than a stop', async () => {
    await playFirstAyah();

    recitationAudio().dispatchEvent(new Event('pause'));

    const state = engine.getRecitationState();
    expect(state.isPlaying).toBe(false);
    expect(state.interrupted).toBe(true);
    // Nothing was torn down — this is the difference from `stop()`.
    expect(state.activeAyah).toBe(1);
    expect(state.sessionOpen).toBe(true);
    expect(state.surahId).toBe(1);
  });

  it('resumes on its own when the app regains focus after the call', async () => {
    await playFirstAyah();
    recitationAudio().dispatchEvent(new Event('pause'));
    expect(engine.getRecitationState().interrupted).toBe(true);

    window.dispatchEvent(new Event('focus'));
    await flush();

    const state = engine.getRecitationState();
    expect(state.isPlaying).toBe(true);
    expect(state.interrupted).toBe(false);
  });

  /** Our own pause flips the intent in the same tick, before the event lands. */
  it('does not mistake its own pause for an interruption', async () => {
    await playFirstAyah();
    await engine.toggleSurah();

    // The element's `pause` event is queued and arrives afterwards — it must
    // not be read as the system stealing the sound.
    recitationAudio().dispatchEvent(new Event('pause'));

    const state = engine.getRecitationState();
    expect(state.isPlaying).toBe(false);
    expect(state.interrupted).toBe(false);
  });

  it('leaves a deliberate pause alone when the window regains focus', async () => {
    await playFirstAyah();
    await engine.toggleSurah();
    expect(engine.getRecitationState().isPlaying).toBe(false);

    window.dispatchEvent(new Event('focus'));
    await flush();

    expect(engine.getRecitationState().isPlaying).toBe(false);
    expect(engine.getRecitationState().interrupted).toBe(false);
  });

  it('advances one ayah when a headset presses «التالي»', async () => {
    await playFirstAyah();
    expect(engine.getRecitationState().activeAyah).toBe(1);

    sessionHandlers.seekforward?.();
    await flush();

    expect(engine.getRecitationState().activeAyah).toBe(2);
    expect(engine.getRecitationState().isPlaying).toBe(true);
  });

  it('never wraps past the ends of the surah', async () => {
    await playFirstAyah();

    sessionHandlers.seekbackward?.();
    await flush();
    expect(engine.getRecitationState().activeAyah).toBe(1);

    for (let i = 0; i < 5; i += 1) {
      sessionHandlers.seekforward?.();
      await flush();
    }
    expect(engine.getRecitationState().activeAyah).toBe(TIMINGS.length);
  });

  it('moves the needle without making sound when skipped while paused', async () => {
    await playFirstAyah();
    await engine.toggleSurah();
    const playsBefore = playSpy.mock.calls.length;

    sessionHandlers.seekforward?.();
    await flush();

    const state = engine.getRecitationState();
    expect(state.activeAyah).toBe(2);
    expect(state.isPlaying).toBe(false);
    expect(playSpy.mock.calls.length).toBe(playsBefore);
  });
});

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
describe('recitationEngine setTrack', () => {
  const BAQARAH = { surahId: 2, surahName: 'البقرة', reciterId: 'mishary' } as const;

  it('is a no-op when the reader remounts over the same track', () => {
    engine.setTrack(BAQARAH);
    engine.selectAyah(7);
    expect(engine.getRecitationState().selectedAyah).toBe(7);

    // The reader unmounted (the user went to the home screen) and mounted
    // again on the same surah. This call is the whole feature: if it tore
    // anything down, leaving the screen would still stop the recitation.
    engine.setTrack(BAQARAH);

    const state = engine.getRecitationState();
    expect(state.surahId).toBe(2);
    expect(state.selectedAyah).toBe(7);
  });

  it('resets the selection when the track really changes', () => {
    engine.setTrack(FATIHA);
    engine.selectAyah(9);
    expect(engine.getRecitationState().selectedAyah).toBe(9);

    engine.setTrack(BAQARAH);

    const state = engine.getRecitationState();
    expect(state.surahId).toBe(2);
    // Ayah 9 may not exist in the new surah — carrying it over would make the
    // next «استمع للآية» fail on a timing that is not there.
    expect(state.selectedAyah).toBe(1);
  });

  it('treats a reciter change as a track change', () => {
    engine.setTrack(BAQARAH);
    expect(engine.getRecitationState().reciterId).toBe('mishary');
    engine.setTrack({ ...BAQARAH, reciterId: 'abdulbasit' });
    expect(engine.getRecitationState().reciterId).toBe('abdulbasit');
  });
});
