import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * Usage reporting has to stay invisible and cheap: one counted open per
 * identity per window, a stable anonymous id per device, and no error ever
 * surfacing to the reader. Supabase's client pulls in Vite's `import.meta.env`,
 * so it is stubbed here and the RPC answers are scripted per test.
 */

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = { data: null, error: null };
let rpcImpl: (name: string, args: Record<string, unknown>) => Promise<unknown> = () =>
  Promise.resolve(rpcResult);

jest.unstable_mockModule('@/utils/supabaseClient', () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    },
  },
  isSupabaseConfigured: true,
}));

const {
  TRACK_WINDOW_MS,
  mintDeviceId,
  parseMarker,
  readOrCreateDeviceId,
  shouldTrackAppOpen,
  trackAppOpen,
} = await import('@/utils/analytics');

beforeEach(() => {
  localStorage.clear();
  rpcCalls.length = 0;
  rpcResult = { data: null, error: null };
  rpcImpl = () => Promise.resolve(rpcResult);
});

describe('device id', () => {
  it('is minted once and then reused, so a guest stays one guest', () => {
    const first = readOrCreateDeviceId();
    const second = readOrCreateDeviceId();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(first.length).toBeLessThanOrEqual(64);
  });

  it('mints ids within the range the server column accepts', () => {
    for (let i = 0; i < 5; i += 1) {
      const id = mintDeviceId();
      expect(id.length).toBeGreaterThanOrEqual(8);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(Array.from({ length: 5 }, mintDeviceId)).size).toBe(5);
  });

  it('replaces a stored id that the server would reject', () => {
    localStorage.setItem('zad:device-id', 'x');
    expect(readOrCreateDeviceId()).not.toBe('x');
    expect(readOrCreateDeviceId().length).toBeGreaterThanOrEqual(8);
  });
});

describe('parseMarker', () => {
  it('reads a well-formed marker', () => {
    expect(parseMarker(JSON.stringify({ identity: 'device:abc', at: 5 }))).toEqual({
      identity: 'device:abc',
      at: 5,
    });
  });

  it.each([null, '', 'not json', '[]', '{}', '{"identity":"x"}', '{"identity":"x","at":"soon"}'])(
    'treats %s as no marker instead of throwing',
    (raw) => {
      expect(parseMarker(raw)).toBeNull();
    },
  );
});

describe('shouldTrackAppOpen', () => {
  const now = 1_000_000;

  it('counts an identity that was never counted', () => {
    expect(shouldTrackAppOpen(null, 'device:a', now)).toBe(true);
  });

  it('counts a different identity at once — a fresh sign-in is not a repeat', () => {
    expect(shouldTrackAppOpen({ identity: 'device:a', at: now - 1 }, 'user:b', now)).toBe(true);
  });

  it('skips the same identity inside the window', () => {
    expect(shouldTrackAppOpen({ identity: 'device:a', at: now - TRACK_WINDOW_MS + 1 }, 'device:a', now)).toBe(false);
  });

  it('counts the same identity once the window has passed', () => {
    expect(shouldTrackAppOpen({ identity: 'device:a', at: now - TRACK_WINDOW_MS }, 'device:a', now)).toBe(true);
  });

  it('treats a marker from the future as stale rather than staying silent', () => {
    expect(shouldTrackAppOpen({ identity: 'device:a', at: now + 60_000 }, 'device:a', now)).toBe(true);
  });
});

describe('trackAppOpen', () => {
  it('reports a guest open under the device id', async () => {
    await expect(trackAppOpen(null)).resolves.toBe(true);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('track_app_open');
    expect(rpcCalls[0].args.p_device_id).toBe(readOrCreateDeviceId());
  });

  it('does not call the server again for the same identity inside the window', async () => {
    await expect(trackAppOpen(null)).resolves.toBe(true);
    await expect(trackAppOpen(null)).resolves.toBe(false);
    expect(rpcCalls).toHaveLength(1);
  });

  it('reports immediately after a sign-in, without waiting for the window', async () => {
    await expect(trackAppOpen(null)).resolves.toBe(true);
    await expect(trackAppOpen('user-1')).resolves.toBe(true);
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[1].args.p_device_id).toBe(readOrCreateDeviceId());
  });

  it('records nothing locally when the server declines', async () => {
    rpcResult = { data: null, error: { message: 'relation does not exist' } };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(trackAppOpen(null)).resolves.toBe(false);
    expect(localStorage.getItem('zad:last-app-open')).toBeNull();

    // The next attempt is allowed to try again — a failure is not a visit.
    rpcResult = { data: null, error: null };
    await expect(trackAppOpen(null)).resolves.toBe(true);
    warn.mockRestore();
  });

  it('stays quiet when the network throws, and leaves no marker behind', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    rpcImpl = () => Promise.reject(new Error('offline'));

    await expect(trackAppOpen(null)).resolves.toBe(false);
    expect(localStorage.getItem('zad:last-app-open')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
