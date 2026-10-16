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
  it('provides twelve distinct, labeled palettes', () => {
    expect(COLOR_PALETTES).toHaveLength(12);
    expect(new Set(COLOR_PALETTES.map(({ id }) => id)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ color }) => color)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ accent }) => accent)).size).toBe(COLOR_PALETTES.length);
  });

  it('keeps accent colors readable on light surfaces and with white text', () => {
    for (const palette of COLOR_PALETTES) {
      expect(contrastAgainstWhite(palette.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
