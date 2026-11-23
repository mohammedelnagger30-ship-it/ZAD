import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { jest } from '@jest/globals';
import type { AyahText } from '@/data/quranText';

const { AyahSpan } = await import('@/components/quran/AyahSpan');

const AYAH: AyahText = {
  surahId: 1,
  ayahNumber: 1,
  text: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
  juz: 1,
  page: 1,
};

describe('AyahSpan hidden text', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('opens the ayah options when the hidden verse mask is tapped', async () => {
    const showChoice = jest.fn();
    const showTafsir = jest.fn();

    await act(async () => {
      root.render(
        <AyahSpan
          ayah={AYAH}
          isHifz
          bookmarked={false}
          hideText
          hideWordByWord={false}
          selected={false}
          activeAudio={false}
          onToggleBookmark={() => {}}
          onShowTafsir={showTafsir}
          onShowChoice={showChoice}
        />,
      );
    });

    const hiddenText = container.querySelector<HTMLElement>('.mushaf-ayah [style*="color: transparent"]');
    expect(hiddenText).not.toBeNull();

    await act(async () => {
      hiddenText!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(showChoice).toHaveBeenCalledTimes(1);
    expect(showTafsir).not.toHaveBeenCalled();
  });
});
