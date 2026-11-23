import { COLOR_PALETTES } from '@/utils/colorThemes';

function relativeLuminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi);
  if (!channels || channels.length !== 3) throw new Error(`Invalid hex color: ${hex}`);
  const [red, green, blue] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastAgainstWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

describe('color palettes', () => {
  it('provides sixteen distinct, labeled palettes including three dark palettes', () => {
    expect(COLOR_PALETTES).toHaveLength(16);
    expect(COLOR_PALETTES.filter(({ id }) => ['obsidian', 'nocturne', 'abyss'].includes(id))).toHaveLength(3);
    expect(new Set(COLOR_PALETTES.map(({ id }) => id)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ color }) => color)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ accent }) => accent)).size).toBe(COLOR_PALETTES.length);
  });

  it('ensures each palette is built on three distinct harmonious colors', () => {
    for (const palette of COLOR_PALETTES) {
      expect(palette.color).toBeTruthy();
      expect(palette.tertiary).toBeTruthy();
      expect(palette.accent).toBeTruthy();
      expect(palette.color.toLowerCase()).not.toBe(palette.tertiary.toLowerCase());
      expect(palette.color.toLowerCase()).not.toBe(palette.accent.toLowerCase());
      expect(palette.tertiary.toLowerCase()).not.toBe(palette.accent.toLowerCase());
    }
  });

  it('keeps brand colors accessible and readable on light surfaces', () => {
    for (const palette of COLOR_PALETTES) {
      // Primary color provides high contrast (≥ 4.5:1)
      expect(contrastAgainstWhite(palette.color)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
