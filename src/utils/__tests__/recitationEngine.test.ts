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
const { isRecitationSheetOpen, setRecitationSheetOpen } = await import('@/utils/recitationPlayerUi');

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

/**
 * Surah to surah — the part of the engine a listener driving it from a pocket, a car
 * or the notification card actually relies on.
 *
 * Two rules are load-bearing here: the recitation must carry on into the next surah by
 * itself (and stop at سورة الناس, where there is nowhere left to go), and every control
 * — the card, the headset, the expanded player — must take the *surah* step, with the
 * ayah step left to the reader's own controls.
 */
describe('recitationEngine surah navigation', () => {
  let playSpy: ReturnType<typeof jest.spyOn>;
  let pauseSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
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

  it('walks on to the next surah when the last ayah runs out', async () => {
    await playFirstAyah();
    sessionHandlers.seekforward?.();
    await flush();
    sessionHandlers.seekforward?.();
    await flush();
    expect(engine.getRecitationState().activeAyah).toBe(TIMINGS.length);

    recitationAudio().dispatchEvent(new Event('ended'));
    await flush();

    const state = engine.getRecitationState();
    expect(state.surahId).toBe(2);
    expect(state.isPlaying).toBe(true);
    expect(state.activeAyah).toBe(1);
    // The card must survive the switch rather than blinking away between surahs.
    expect(state.sessionOpen).toBe(true);
  });

  it('walks on from the last ayah as the stream itself runs past the end', async () => {
    await playFirstAyah();
    engine.seekTo(2900);
    expect(engine.getRecitationState().activeAyah).toBe(TIMINGS.length);

    // The stream reaching the end of the recording, one tick after the last verse.
    recitationAudio().currentTime = 3.2;
    recitationAudio().dispatchEvent(new Event('timeupdate'));
    await flush();

    expect(engine.getRecitationState().surahId).toBe(2);
  });

  it('ends the recitation at سورة الناس, where there is no next surah', async () => {
    engine.setTrack({ surahId: 114, surahName: 'الناس', reciterId: 'mishary' });
    await playFirstAyah();
    sessionHandlers.seekforward?.();
    await flush();
    sessionHandlers.seekforward?.();
    await flush();

    recitationAudio().dispatchEvent(new Event('ended'));
    await flush();

    const state = engine.getRecitationState();
    expect(state.isPlaying).toBe(false);
    expect(state.sessionOpen).toBe(false);
    expect(state.surahId).toBe(114);
  });

  it('takes the surah step — not the ayah step — from the lock screen', async () => {
    await playFirstAyah();
    expect(sessionHandlers.nexttrack).toBeDefined();
    expect(sessionHandlers.previoustrack).toBeDefined();

    sessionHandlers.nexttrack?.();
    await flush();

    const state = engine.getRecitationState();
    expect(state.surahId).toBe(2);
    expect(state.isPlaying).toBe(true);
    expect(state.activeAyah).toBe(1);
  });

  it('goes back a surah from a headset «السابق»', async () => {
    engine.setTrack({ surahId: 3, surahName: 'آل عمران', reciterId: 'mishary' });
    await playFirstAyah();

    sessionHandlers.previoustrack?.();
    await flush();

    expect(engine.getRecitationState().surahId).toBe(2);
  });

  it('restarts the current surah when «السابق» comes a few seconds in', async () => {
    engine.setTrack({ surahId: 3, surahName: 'آل عمران', reciterId: 'mishary' });
    await playFirstAyah();
    recitationAudio().currentTime = 5;

    sessionHandlers.previoustrack?.();
    await flush();

    const state = engine.getRecitationState();
    // The habit every player shares: a hand reaching for «السابق» mid-surah means
    // "start this one again", not "fetch the one before it".
    expect(state.surahId).toBe(3);
    expect(state.activeAyah).toBe(1);
  });

  it('moves the selection without making sound when «التالي» lands while paused', async () => {
    await playFirstAyah();
    await engine.toggleSurah();
    const playsBefore = playSpy.mock.calls.length;

    await engine.playNextSurah();

    const state = engine.getRecitationState();
    expect(state.surahId).toBe(2);
    expect(state.isPlaying).toBe(false);
    // Still a live session: the card must show the new surah, paused.
    expect(state.sessionOpen).toBe(true);
    expect(playSpy.mock.calls.length).toBe(playsBefore);
  });

  /**
   * The reader keeps its own `selectedSurah`, so it has to be told when the *player*
   * moved. `setTrack` must stay silent: that call is the reader's own and echoing it
   * back would drag a reader opened at آية ٥٠ to the first ayah of its own surah.
   */
  it('announces the player’s own surah changes, and only those', async () => {
    const seen: number[] = [];
    const unsubscribe = engine.subscribeSurahChange((id) => seen.push(id));
    try {
      await playFirstAyah();
      expect(seen).toEqual([]);

      await engine.playNextSurah();
      expect(seen).toEqual([2]);
    } finally {
      unsubscribe();
    }
  });

  it('carries the highlight with a system seek', async () => {
    await playFirstAyah();

    engine.seekTo(2500);

    expect(engine.getRecitationState().activeAyah).toBe(3);
    expect(engine.getRecitationProgress().positionMs).toBe(2500);
  });

  /**
   * The expanded player outlives the bar it was opened from, so nothing else would
   * ever close it: stopping has to, or the next surah would open straight into a sheet
   * that the listener had already dismissed by ending the recitation.
   */
  it('closes the expanded player when the recitation stops', async () => {
    await playFirstAyah();
    setRecitationSheetOpen(true);

    engine.stop();

    expect(isRecitationSheetOpen()).toBe(false);
  });
});
