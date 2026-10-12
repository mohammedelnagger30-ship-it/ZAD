/**
 * The adhan page must reach the ear together with the page itself: no one should have
 * to hunt for a «تشغيل الأذان» button to hear the call. These tests pin the two halves
 * of that rule —
 *
 *  - the page starts its own audio whenever nothing else is ringing for it (preview,
 *    the in-app timer, a notification tapped long after the prayer), and
 *  - it stays out of the way while the prayer notification is ringing its own copy, so
 *    two recordings of the adhan never overlap.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

import { AzanOverlayModal } from '@/components/AzanOverlayModal';
import { DEFAULT_SETTINGS, type Settings } from '@/db/database';
import { trustedNow } from '@/utils/clock';
import type { PrayerKey } from '@/utils/prayerTracker';

/** jsdom ships no media stack, so the page's speaker is stood in for. */
class FakeAudio {
  static playCalls = 0;
  loop = false;
  muted = false;
  currentTime = 0;
  constructor(src: string) {
    this.src = src;
  }
  src: string;
  play(): Promise<void> {
    FakeAudio.playCalls += 1;
    return Promise.resolve();
  }
  pause(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

const PLAY_BUTTON_LABEL = 'تشغيل الأذان';
const MUTE_BUTTON_LABEL = 'كتم الصوت';

describe('AzanOverlayModal adhan sound', () => {
  let container: HTMLDivElement;
  let root: Root;

  const settings: Settings = { ...DEFAULT_SETTINGS, adhanSound: true };

  async function renderModal(props: Partial<Parameters<typeof AzanOverlayModal>[0]>) {
    const element = (
      <AzanOverlayModal
        isOpen
        prayerKey={'dhuhr' as PrayerKey}
        prayerTime={trustedNow()}
        settings={settings}
        onClose={() => {}}
        {...props}
      />
    ) as ReactElement;
    await act(async () => {
      root.render(element);
    });
    return container;
  }

  const queryByLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`);

  beforeEach(() => {
    FakeAudio.playCalls = 0;
    (globalThis as { Audio?: unknown }).Audio = FakeAudio;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('starts the adhan by itself on a preview, with no play button offered', async () => {
    await renderModal({ isPreview: true, prayerTime: undefined });

    expect(FakeAudio.playCalls).toBe(1);
    expect(queryByLabel(PLAY_BUTTON_LABEL)).toBeNull();
    // The mute switch means the page itself is the speaker.
    expect(queryByLabel(MUTE_BUTTON_LABEL)).not.toBeNull();
  });

  it('stays quiet while the prayer notification is ringing its own copy', async () => {
    await renderModal({
      fromNotification: true,
      prayerTime: new Date(trustedNow().getTime() - 5_000),
    });

    expect(FakeAudio.playCalls).toBe(0);
    expect(queryByLabel(PLAY_BUTTON_LABEL)).toBeNull();
    // Nothing this page could mute: the ringing belongs to the notification.
    expect(queryByLabel(MUTE_BUTTON_LABEL)).toBeNull();
    expect(container.textContent).toContain('مع التنبيه');
  });

  it('takes over the sound when the notification is opened after the call has ended', async () => {
    await renderModal({
      fromNotification: true,
      prayerTime: new Date(trustedNow().getTime() - 10 * 60_000),
    });

    expect(FakeAudio.playCalls).toBe(1);
    expect(queryByLabel(PLAY_BUTTON_LABEL)).toBeNull();
    expect(queryByLabel(MUTE_BUTTON_LABEL)).not.toBeNull();
  });
});
