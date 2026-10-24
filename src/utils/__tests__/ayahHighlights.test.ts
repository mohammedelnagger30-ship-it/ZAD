import { describe, it, expect } from '@jest/globals';
import {
  HIGHLIGHT_COLORS,
  isHighlightColor,
  getHighlightColor,
  highlightWash,
} from '@/utils/ayahHighlights';

describe('HIGHLIGHT_COLORS', () => {
  it('has unique ids', () => {
    const ids = HIGHLIGHT_COLORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every colour a label and a solid swatch', () => {
    for (const c of HIGHLIGHT_COLORS) {
      expect(c.labelAr.length).toBeGreaterThan(0);
      expect(c.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('labels each colour in Arabic', () => {
    for (const c of HIGHLIGHT_COLORS) {
      expect(c.labelAr).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe('isHighlightColor', () => {
  it('accepts every palette id', () => {
    for (const c of HIGHLIGHT_COLORS) expect(isHighlightColor(c.id)).toBe(true);
  });

  it('rejects anything not in the palette', () => {
    expect(isHighlightColor('chartreuse')).toBe(false);
    expect(isHighlightColor('')).toBe(false);
    expect(isHighlightColor(undefined)).toBe(false);
    expect(isHighlightColor(null)).toBe(false);
    expect(isHighlightColor(42)).toBe(false);
  });
});

describe('getHighlightColor', () => {
  it('returns the palette entry for a known id', () => {
    expect(getHighlightColor('gold')?.labelAr).toBe('ذهبي');
  });

  it('returns undefined for unknown or absent ids', () => {
    expect(getHighlightColor('nope')).toBeUndefined();
    expect(getHighlightColor(undefined)).toBeUndefined();
  });
});

describe('highlightWash', () => {
  it('resolves a known id to its theme variable', () => {
    expect(highlightWash('gold')).toBe('var(--hl-gold)');
    expect(highlightWash('violet')).toBe('var(--hl-violet)');
  });

  it('resolves nothing for an unknown id, so the caller falls back', () => {
    expect(highlightWash('chartreuse')).toBeUndefined();
    expect(highlightWash(undefined)).toBeUndefined();
    expect(highlightWash('')).toBeUndefined();
  });
});
