/**
 * The gates that decide whether a notification may raise the adhan page.
 *
 * Three complaints share one shape — a page that opens for a prayer which is not
 * happening now:
 *
 *  - a card tapped hours after its prayer, raising a page that claims «حَانَ الآنْ»;
 *  - a card tapped *late* (an OEM deferral) raising a page for a prayer already gone;
 *  - a self-test alarm writing a prayer record, or being taken for a real call.
 *
 * The hook is mounted with no settings, which is exactly the state that matters here:
 * the in-app timers stay out of the way, so every page the test sees came from the
 * notification path and nothing else.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect } from 'react';
import { jest } from '@jest/globals';

import type { PrayerKey } from '@/utils/prayerTracker';

/** The listeners the hook registered, so a test can fire a notification at it. */
const notificationHandlers: Record<string, (payload: unknown) => void> = {};
/** The overlay listener the hook registered. */
let overlayHandler: ((data: unknown, source: 'received' | 'launch') => void) | null = null;

/** What the hook's state looks like right now. */
interface HookState {
  isOpen: boolean;
  isPreview: boolean;
  prayerKey: string;
  prayerName?: string;
}

let latestState: HookState = { isOpen: false, isPreview: false, prayerKey: 'fajr' };

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));

jest.unstable_mockModule('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    addListener: async (event: string, handler: (payload: unknown) => void) => {
      notificationHandlers[event] = handler;
      return { remove: () => undefined };
    },
    checkPermissions: async () => ({ display: 'granted' }),
    getDeliveredNotifications: async () => ({ notifications: [] }),
  },
}));

jest.unstable_mockModule('@/utils/adhanOverlay', () => ({
  onAdhanOverlay: async (handler: (data: unknown, source: 'received' | 'launch') => void) => {
    overlayHandler = handler;
    return () => undefined;
  },
}));

const { useAzanTrigger } = await import('@/hooks/useAzanTrigger');
const { trustedNow } = await import('@/utils/clock');

/** Mounts the hook and reports its state back to the test. */
function Probe() {
  const { azanState } = useAzanTrigger(null);
  useEffect(() => {
    latestState = {
      isOpen: azanState.isOpen,
      isPreview: azanState.isPreview ?? false,
      prayerKey: azanState.prayerKey,
      prayerName: azanState.prayerName,
    };
  }, [azanState]);
  return null;
}

/** A notification card, as the plugin delivers it. */
function card(extra: Record<string, unknown>) {
  return { id: 1_000_000, title: 'حان وقت صلاة الظهر', extra };
}

describe('useAzanTrigger — the notification gates', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    latestState = { isOpen: false, isPreview: false, prayerKey: 'fajr' };
    for (const key of Object.keys(notificationHandlers)) delete notificationHandlers[key];
    overlayHandler = null;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Probe />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  /** Fires a tap on a notification card — the path a person takes. */
  async function tap(extra: Record<string, unknown>) {
    await act(async () => {
      notificationHandlers.localNotificationActionPerformed?.({ notification: card(extra) });
    });
  }

  it('opens the page for a card tapped while its prayer is still current', async () => {
    await tap({
      type: 'prayer',
      prayerKey: 'dhuhr' as PrayerKey,
      prayerName: 'الظهر',
      time: new Date(trustedNow().getTime() - 60_000).toISOString(),
    });

    expect(latestState.isOpen).toBe(true);
    expect(latestState.prayerKey).toBe('dhuhr');
  });

  it('refuses a card tapped long after its prayer — the wrong-hour page', async () => {
    // The reported complaint in its plainest form: a card that outlived its prayer
    // still standing in the shade, tapped later, opening a page that says «now».
    await tap({
      type: 'prayer',
      prayerKey: 'dhuhr' as PrayerKey,
      prayerName: 'الظهر',
      time: new Date(trustedNow().getTime() - 3 * 60 * 60_000).toISOString(),
    });

    expect(latestState.isOpen).toBe(false);
  });

  it('refuses a card that arrived late, even when it is only a quarter of an hour old', async () => {
    // Past the fifteen-minute line the native receiver posts the «تأخّر التنبيه»
    // notice instead of the call; this side has to agree with it exactly.
    await tap({
      type: 'prayer',
      prayerKey: 'asr' as PrayerKey,
      prayerName: 'العصر',
      time: new Date(trustedNow().getTime() - 20 * 60_000).toISOString(),
    });

    expect(latestState.isOpen).toBe(false);
  });

  it('keeps a card that is only a few minutes late', async () => {
    // Inside the window it is still the adhan: a phone that woke up late must not
    // lose the call altogether.
    await tap({
      type: 'prayer',
      prayerKey: 'asr' as PrayerKey,
      prayerName: 'العصر',
      time: new Date(trustedNow().getTime() - 5 * 60_000).toISOString(),
    });

    expect(latestState.isOpen).toBe(true);
  });

  it('opens a self-test as a preview, never as a prayer', async () => {
    await tap({
      type: 'test',
      prayerKey: 'fajr' as PrayerKey,
      prayerName: 'الفجر',
      time: new Date(trustedNow().getTime() - 2_000).toISOString(),
    });

    expect(latestState.isOpen).toBe(true);
    // A preview: it writes no prayer record, so a test can never be mistaken for one.
    expect(latestState.isPreview).toBe(true);
  });

  it('opens a self-test from the overlay path as a preview too', async () => {
    await act(async () => {
      overlayHandler?.(
        {
          prayerKey: 'fajr',
          prayerName: 'الفجر',
          type: 'test',
          time: new Date(trustedNow().getTime() - 2_000).toISOString(),
          ringing: true,
        },
        'received',
      );
    });

    expect(latestState.isOpen).toBe(true);
    expect(latestState.isPreview).toBe(true);
  });

  it('refuses a stale overlay event, whatever brought it', async () => {
    await act(async () => {
      overlayHandler?.(
        {
          prayerKey: 'dhuhr',
          prayerName: 'الظهر',
          type: 'prayer',
          time: new Date(trustedNow().getTime() - 2 * 60 * 60_000).toISOString(),
        },
        'launch',
      );
    });

    expect(latestState.isOpen).toBe(false);
  });
});
