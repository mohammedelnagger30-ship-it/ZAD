/**
 * A card that cannot be read is a card that should not have been drawn, and
 * everything that decides readability happens in `wrapLines`: the words that
 * fit, the ones that break, and — the case that matters most here — the ones
 * that are never cut. Measuring is passed in rather than taken from a canvas
 * because a canvas is the one thing a test cannot make.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { composeSharePayload, shareAyahCard, wrapLines } from '@/utils/shareCard';

/** One unit per character: widths become counts, which are easy to reason about. */
const measure = (line: string) => line.length;

describe('wrapLines', () => {
  it('says nothing for an empty line', () => {
    expect(wrapLines('', 20, measure)).toEqual([]);
    expect(wrapLines('   \n\t ', 20, measure)).toEqual([]);
  });

  it('keeps a line that already fits on one line', () => {
    expect(wrapLines('alpha bravo', 40, measure)).toEqual(['alpha bravo']);
  });

  it('breaks greedily — as much as fits, then the next word alone', () => {
    // "charlie delta" is 13 characters and the box is 12, so the line ends at
    // "charlie" and "delta" starts the next one.
    expect(wrapLines('alpha bravo charlie delta echo', 12, measure)).toEqual([
      'alpha bravo',
      'charlie',
      'delta echo',
    ]);
  });

  /** A word sliced in half is a word that has been changed. */
  it('never cuts a word, however much wider than the box it is', () => {
    expect(wrapLines('alpha supercalifragilistic bravo', 12, measure)).toEqual([
      'alpha',
      'supercalifragilistic',
      'bravo',
    ]);
  });

  it('loses no word along the way', () => {
    const text = 'وكان الناس يفعلون ما يفعلون وليست القصة في ذلك البتة أبداً';
    const lines = wrapLines(text, 17, measure);

    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(17);
  });

  it('collapses the whitespace that line breaks were made of', () => {
    expect(wrapLines('alpha\n  bravo', 40, measure)).toEqual(['alpha bravo']);
  });
});

describe('composeSharePayload', () => {
  it('puts the ayah first and its place second, the way the clipboard always has', () => {
    expect(
      composeSharePayload({
        surahId: 2,
        ayahText: 'الٓمٓ',
        surahName: 'البقرة',
        ayahNumber: 1,
      }),
    ).toBe('﴿الٓمٓ﴾\nالبقرة — الآية ١');
  });

  it('counts the ayah in Arabic-Indic figures', () => {
    expect(
      composeSharePayload({
        surahId: 73,
        ayahText: 'يَا أَيُّهَا الْمُدَّثِّرُ',
        surahName: 'المدثر',
        ayahNumber: 45,
      }),
    ).toContain('الآية ٤٥');
  });
});

describe('shareAyahCard', () => {
  it('shares the prepared image file directly from the tap', async () => {
    const shareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'share');
    const canShareDescriptor = Object.getOwnPropertyDescriptor(navigator, 'canShare');
    const share = jest.fn(async (_data: ShareData) => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: jest.fn(() => true),
    });

    try {
      const outcome = await shareAyahCard(
        { surahId: 1, ayahText: 'بِسْمِ اللَّهِ', surahName: 'الفاتحة', ayahNumber: 1 },
        { blob: new Blob(['png'], { type: 'image/png' }) },
      );

      expect(outcome).toBe('shared');
      expect(share).toHaveBeenCalledWith(expect.objectContaining({
        title: 'آية اليوم',
        files: [expect.objectContaining({ name: 'ayah-1-1.png', type: 'image/png' })],
      }));
    } finally {
      if (shareDescriptor) Object.defineProperty(navigator, 'share', shareDescriptor);
      else Reflect.deleteProperty(navigator, 'share');
      if (canShareDescriptor) Object.defineProperty(navigator, 'canShare', canShareDescriptor);
      else Reflect.deleteProperty(navigator, 'canShare');
    }
  });
});
