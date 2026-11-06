import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { jest } from '@jest/globals';
import { getAyahs } from '@/data/quranText';
import { AyahVoiceSheet } from '@/components/mushaf/AyahVoiceSheet';

type Props = Parameters<typeof AyahVoiceSheet>[0];

function sheet(overrides: Partial<Props> = {}): ReactElement {
  const props: Props = {
    ayahChoice: { surahId: 1, ayahNumber: 1 },
    closeAyahChoice: () => {},
    ayahPanelRef: { current: null },
    setTafsirAyah: () => {},
    openVoice: () => {},
    startVoice: () => {},
    voiceEngaged: true,
    voiceWholeFile: false,
    voiceHint: 'اختر نطاق التلاوة.',
    voiceScope: 'ayah',
    handleVoiceScope: () => {},
    reciterId: 'ar.alafasy',
    handleVoiceReciter: () => {},
    replayVoice: () => {},
    voicePhase: 'idle',
    voiceTime: { current: 0, duration: 0 },
    playbackRate: 1,
    repeatCount: 1,
    handleVoiceRate: () => {},
    handleRepeatCount: () => {},
    seekVoice: () => {},
    voicePrimaryDisabled: false,
    voicePrimaryLabel: 'استماع',
    voiceError: null,
    ...overrides,
  };
  return <AyahVoiceSheet {...props} />;
}

describe('AyahVoiceSheet recitation choices', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(sheet());
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows the selected ayah and a clear choice between the ayah and full surah', () => {
    expect(container.querySelector('.mushaf-voice__ayah')?.textContent).toBe(getAyahs(1, 1, 1)[0]?.text);
    expect(container.textContent).toContain('التفسير');
    expect(container.textContent).toContain('تلاوة الآية');
    expect(container.textContent).toContain('السورة كاملة');
  });

  it('starts the requested full-surah scope without rendering a second audio player', async () => {
    const startVoice = jest.fn();
    await act(async () => {
      root.render(sheet({ startVoice }) as ReactElement);
    });

    const surahButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('السورة كاملة'));
    expect(surahButton).toBeDefined();
    await act(async () => {
      surahButton?.click();
    });

    expect(startVoice).toHaveBeenCalledWith('surah');
    expect(container.querySelector('audio')).toBeNull();
  });

  it('shows the shared transport after playback starts', async () => {
    await act(async () => {
      root.render(sheet({
        voicePhase: 'ready',
        voicePrimaryLabel: 'إيقاف مؤقت',
      }) as ReactElement);
    });

    expect(container.textContent).toContain('تلاوة الآية ١');
    expect(container.textContent).toContain('إيقاف مؤقت');
    expect(container.querySelector('audio')).toBeNull();
  });
});
