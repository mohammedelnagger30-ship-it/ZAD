import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

/**
 * One account, one sync loop — however many views ask for it.
 *
 * The admin's dashboard and its «فتح التطبيق» view are the same session, and
 * each called `startCloudSync` in turn. The loop is a module-level singleton
 * built from module-level handles, so the second call overwrote `syncInterval`:
 * the first interval became unreachable and kept ticking for the life of the
 * document, while the first caller's stop tore down the loop the second view
 * was still using. Ref-counting makes the loop belong to the count, not to
 * whoever asked last.
 *
 * Dexie, Supabase and the App plugin are stubbed for this file only. The run is
 * held offline on purpose: `synchronizeNow` returns before touching the network
 * when `navigator.onLine` is false, which is exactly the state needed to reach
 * the loop's own bookkeeping without a server.
 */

const hooked: string[] = [];

jest.unstable_mockModule('@/db/database', () => ({
  db: {
    table: (name: string) => ({
      hook: () => ({
        subscribe: () => {
          hooked.push(name);
        },
      }),
    }),
  },
  DEFAULT_SETTINGS: {},
}));
jest.unstable_mockModule('@/utils/supabaseClient', () => ({
  supabase: {
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: async () => undefined,
  },
  isSupabaseConfigured: true,
}));

jest.unstable_mockModule('@capacitor/app', () => ({
  App: {
    addListener: async () => ({ remove: async () => undefined }),
  },
}));

const { startCloudSync } = await import('@/utils/cloudSync');

const originalOnLine = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');

function goOffline(): void {
  Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
}

describe('startCloudSync ref-counting', () => {
  let setIntervalSpy: jest.SpiedFunction<typeof setInterval>;
  let clearIntervalSpy: jest.SpiedFunction<typeof clearInterval>;

  beforeEach(() => {
    goOffline();
    setIntervalSpy = jest.spyOn(globalThis, 'setInterval').mockImplementation((() => 1) as never);
    clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    if (originalOnLine) Object.defineProperty(window.navigator, 'onLine', originalOnLine);
  });

  it('starts one loop however many views ask for sync', async () => {
    const stopFirst = await startCloudSync('user-1', jest.fn());

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    const stopSecond = await startCloudSync('user-1', jest.fn());

    // The second view joins the loop already running; it does not arm a second
    // interval, channel and online listener behind the first.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    stopFirst();
    stopSecond();
  });

  it('keeps the loop alive while one of two holders still wants it', async () => {
    const stopFirst = await startCloudSync('user-1', jest.fn());
    const stopSecond = await startCloudSync('user-1', jest.fn());

    stopFirst();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    stopSecond();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('tears the loop down once the last holder releases it', async () => {
    const stop = await startCloudSync('user-1', jest.fn());

    stop();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('releasing twice does not tear down a loop someone else has since taken', async () => {
    const stopFirst = await startCloudSync('user-1', jest.fn());
    const stopSecond = await startCloudSync('user-1', jest.fn());

    stopFirst();
    stopFirst();
    expect(clearIntervalSpy).not.toHaveBeenCalled();

    stopSecond();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
