import { describe, it, expect, beforeEach, jest } from '@jest/globals';

/**
 * The dashboard's only defenses live in these two functions: a payload that must
 * never render as "undefined", and a refusal that must read as "not an admin"
 * rather than as a crash. The Supabase client is stubbed because it reads Vite's
 * `import.meta.env`, which does not exist under Jest.
 */

interface RpcAnswer {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let answer: RpcAnswer = { data: null, error: null };
let shouldThrow = false;
/** A request that never answers — the captive-portal case the gate must not wait on. */
let neverSettles = false;

/**
 * The real client returns a query builder, not a bare promise: `isAdminAccount`
 * arms an `AbortSignal` on it so a network that never answers cannot park the
 * signed-in user at the gate forever. The stub has to be that shape — a bare
 * promise has no `abortSignal`, and awaiting the builder's own `then` is what
 * `fetchAdminStats` does.
 */
function rpcStub() {
  const settle = (): Promise<RpcAnswer> =>
    shouldThrow ? Promise.reject(new Error('offline')) : Promise.resolve(answer);
  return {
    abortSignal(signal: AbortSignal): Promise<RpcAnswer> {
      if (!neverSettles) return settle();
      // Mirrors the real client: an aborted request rejects rather than hanging.
      return new Promise<RpcAnswer>((_resolve, reject) => {
        const abort = () => reject(new Error('AbortError: The operation was aborted'));
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort);
      });
    },
    then: (
      onFulfilled?: (value: RpcAnswer) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => settle().then(onFulfilled, onRejected),
  };
}

jest.unstable_mockModule('@/utils/supabaseClient', () => ({
  supabase: {
    rpc: rpcStub,
  },
  isSupabaseConfigured: true,
}));

const { AdminStatsError, fetchAdminStats, isAdminAccount, normalizeAdminStats } = await import(
  '@/utils/adminStats'
);

beforeEach(() => {
  answer = { data: null, error: null };
  shouldThrow = false;
  neverSettles = false;
});

describe('normalizeAdminStats', () => {
  it('maps the RPC payload to the dashboard shape', () => {
    const stats = normalizeAdminStats({
      total_users: 120,
      users_created_7d: 7,
      users_created_30d: 25,
      active_users_7d: 40,
      active_users_30d: 70,
      guest_devices_total: 300,
      guest_devices_7d: 60,
      guest_opens_7d: 150,
      app_opens_7d: 260,
      first_event_at: '2026-10-01T00:00:00+00:00',
      last_event_at: '2026-10-15T09:00:00+00:00',
      daily: [
        { day: '2026-10-14', users: 12, guests: 30 },
        { day: '2026-10-15', users: 9, guests: 21 },
      ],
    });

    expect(stats.totalUsers).toBe(120);
    expect(stats.guestDevicesTotal).toBe(300);
    expect(stats.appOpens7d).toBe(260);
    expect(stats.lastTrackedAt).toBe('2026-10-15T09:00:00+00:00');
    expect(stats.daily).toEqual([
      { day: '2026-10-14', users: 12, guests: 30 },
      { day: '2026-10-15', users: 9, guests: 21 },
    ]);
  });

  it('renders zeros instead of undefined when the payload is empty or null', () => {
    for (const payload of [null, undefined, 'oops', 42, {}]) {
      const stats = normalizeAdminStats(payload);
      expect(stats.totalUsers).toBe(0);
      expect(stats.activeUsers7d).toBe(0);
      expect(stats.guestDevicesTotal).toBe(0);
      expect(stats.daily).toEqual([]);
      expect(stats.firstTrackedAt).toBeNull();
    }
  });

  it('coerces numeric strings and discards malformed days', () => {
    const stats = normalizeAdminStats({
      total_users: '15',
      active_users_7d: -3,
      daily: [{ day: '2026-10-14', users: '4', guests: null }, { users: 1 }, null, 'x'],
    });
    expect(stats.totalUsers).toBe(15);
    expect(stats.activeUsers7d).toBe(0);
    expect(stats.daily).toEqual([{ day: '2026-10-14', users: 4, guests: 0 }]);
  });
});

describe('isAdminAccount', () => {
  it('is true only for an explicit yes', async () => {
    answer = { data: true, error: null };
    await expect(isAdminAccount()).resolves.toBe(true);

    answer = { data: false, error: null };
    await expect(isAdminAccount()).resolves.toBe(false);
  });

  it('is false when the RPC is missing — a project without the migration is not a dashboard', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    answer = { data: null, error: { code: 'PGRST202', message: 'function public.is_admin() does not exist' } };
    await expect(isAdminAccount()).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('is false when the network is gone', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    shouldThrow = true;
    await expect(isAdminAccount()).resolves.toBe(false);
    warn.mockRestore();
  });

  it('opens the ordinary app instead of waiting forever on a hung network', async () => {
    jest.useFakeTimers();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    neverSettles = true;

    // Without the abort this never settles: the user would sit on the gate's
    // «جارٍ فتح الحساب...» for as long as the connection stays black-holed.
    const pending = isAdminAccount();
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('Admin check timed out — opening the ordinary app.');

    warn.mockRestore();
    jest.useRealTimers();
  });
});

describe('fetchAdminStats', () => {
  it('returns the normalized stats on success', async () => {
    answer = { data: { total_users: 3 }, error: null };
    await expect(fetchAdminStats()).resolves.toMatchObject({ totalUsers: 3, daily: [] });
  });

  it('marks a 42501 refusal as not authorized', async () => {
    answer = { data: null, error: { code: '42501', message: 'Not authorized' } };
    await expect(fetchAdminStats()).rejects.toMatchObject({
      notAuthorized: true,
      missingRpc: false,
    });
  });

  it('marks an unrun migration as a setup problem, not a permission one', async () => {
    answer = { data: null, error: { code: 'PGRST202', message: 'function admin_stats() does not exist' } };
    await expect(fetchAdminStats()).rejects.toMatchObject({
      notAuthorized: false,
      missingRpc: true,
    });
  });

  it('carries any other failure through as its message', async () => {
    answer = { data: null, error: { message: 'rate limit reached' } };
    const failure = await fetchAdminStats().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdminStatsError);
    expect((failure as InstanceType<typeof AdminStatsError>).message).toBe('rate limit reached');
  });
});
