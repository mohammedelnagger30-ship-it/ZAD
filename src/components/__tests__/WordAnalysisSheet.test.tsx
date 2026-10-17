/**
 * ورقة «معلومات لغوية عن الكلمة»: الكتاب الذي لا يعرف الكلمة لا يُعرض كأنّه يعرفها.
 *
 * الكتب الأربعة لا تعلّق إلا على الغريب من الكلمات، فمعظم الضغطات يُسكت منها ثلاثة.
 * وكان الورقة تعرض الأربعة أزراراً حيّةً سواءً، فيضغط القارئ واحداً منها فلا يجد شيئاً
 * ويظنّ أنّ الكتب لا تعمل. والصواب أن يظهر الصامت مُعطَّلاً، فلا يُطلب منه ما ليس عنده.
 *
 * ويُثبّت الاختبار الثاني أنّ الورقة حين تفتح على كتابٍ لا يعرف هذه الكلمة تنزل عنه
 * إلى أوّل كتابٍ يعرفها، بدل أن تجلس على الصمت.
 *
 * لازم `unstable_mockModule` لا `jest.mock`: المشروع يجري في وضع ESM، وهناك لا تُرفع
 * نداءات `jest.mock` قبل الاستيراد، فلا يُمسك الوحدة المزيفة إلا بهذه الطريق.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { jest } from '@jest/globals';

import type { SelectedQuranWord } from '@/components/mushaf/WordAnalysisSheet';
import type { WordMeaningHit } from '@/utils/wordMeaningsService';

const lookup = jest.fn<
  (surah: number, ayah: number, wordPosition: number) => Promise<WordMeaningHit[]>
>();

jest.unstable_mockModule('@/hooks/useContent', () => ({
  useWordMeanings: () => ({ installed: true, loading: false }),
}));

jest.unstable_mockModule('@/utils/wordMeaningsService', () => ({
  DEFAULT_WORD_MEANINGS_BOOK: 491,
  downloadWordMeanings: jest.fn(),
  getWordMeanings: lookup,
}));

const { WordAnalysisSheet } = await import('@/components/mushaf/WordAnalysisSheet');

const WORD: SelectedQuranWord = {
  surahId: 1,
  surahName: 'الفاتحة',
  ayahNumber: 2,
  word: 'الْعَالَمِينَ',
  wordPosition: 4,
};

/** معنى واحدٌ في كتابٍ واحد، والباقي صامت عنه. */
const onlyIn = (book: number): WordMeaningHit[] => [
  { wordIndex: WORD.wordPosition - 1, book, gloss: { text: 'العالمين', meaning: 'أصناف الخلق' } },
];

describe('WordAnalysisSheet book choices', () => {
  let container: HTMLDivElement;
  let root: Root;

  const bookButtons = () =>
    [...container.querySelectorAll<HTMLButtonElement>('.mushaf-word-analysis__book')];

  const labelled = (shortAr: string) =>
    bookButtons().find((b) => b.textContent?.trim() === shortAr);

  const render = async (hits: WordMeaningHit[]) => {
    lookup.mockResolvedValue(hits);
    await act(async () => {
      root.render(<WordAnalysisSheet selectedWord={WORD} onClose={() => {}} />);
    });
    // The sheet resolves the lookup inside an effect; let it land.
    await act(async () => {
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    lookup.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('leaves only the book that knows the word enabled, and marks the silent three', async () => {
    await render(onlyIn(327));

    const tibyan = labelled('التبيان');
    const siraj = labelled('السراج');
    const tadhkirah = labelled('تذكرة الأريب');
    const kalimat = labelled('كلمات القرآن');

    expect(tibyan).toBeDefined();
    expect(siraj).toBeDefined();
    expect(tadhkirah).toBeDefined();
    expect(kalimat).toBeDefined();

    expect(tibyan!.disabled).toBe(false);
    expect(tibyan!.getAttribute('aria-pressed')).toBe('true');

    // The three that say nothing read as unavailable — not as three broken books.
    for (const silent of [siraj, tadhkirah, kalimat]) {
      expect(silent!.disabled).toBe(true);
      expect(silent!.getAttribute('aria-disabled')).toBe('true');
      expect(silent!.getAttribute('aria-pressed')).not.toBe('true');
    }
  });

  it('falls off a book that is silent here onto the first book that is not', async () => {
    // 491 (السراج) is the stored default, but this word is known only to 1424.
    localStorage.setItem('word-meanings-book', '491');
    await render(onlyIn(1424));

    const kalimat = labelled('كلمات القرآن');
    expect(kalimat).toBeDefined();
    expect(kalimat!.disabled).toBe(false);
    expect(kalimat!.getAttribute('aria-pressed')).toBe('true');

    // …and the meaning it carries is the one on screen.
    expect(container.textContent).toContain('أصناف الخلق');
    expect(labelled('السراج')!.disabled).toBe(true);
  });
});
