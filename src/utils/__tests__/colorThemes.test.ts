import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLOR_PALETTES } from '@/utils/colorThemes';

const stylesheet = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');

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
    expect(COLOR_PALETTES[0].id).toBe('qurra');
    expect(COLOR_PALETTES[0].color).toBe('#165b39');
    expect(COLOR_PALETTES[0].accent).toBe('#76560e');
    expect(COLOR_PALETTES.filter(({ id }) => ['obsidian', 'nocturne', 'abyss'].includes(id))).toHaveLength(3);
    expect(new Set(COLOR_PALETTES.map(({ id }) => id)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ color }) => color)).size).toBe(COLOR_PALETTES.length);
    expect(new Set(COLOR_PALETTES.map(({ accent }) => accent)).size).toBe(COLOR_PALETTES.length);
  });

  it('keeps accent colors readable on light surfaces and with white text', () => {
    for (const palette of COLOR_PALETTES) {
      expect(contrastAgainstWhite(palette.accent)).toBeGreaterThanOrEqual(4.5);
    }

    const qurra = COLOR_PALETTES[0];
    expect(contrastAgainstWhite(qurra.color)).toBeGreaterThanOrEqual(4.5);
    expect(qurra.gradient).toContain(qurra.color);
    expect(qurra.gradient).toContain(qurra.accent);
  });

  it('defines runtime tokens for every selectable palette', () => {
    for (const { id } of COLOR_PALETTES) {
      expect(stylesheet).toContain(`:root[data-palette='${id}']`);
    }
  });

  it('carries Qurra green and gold through feature color utilities', () => {
    const paletteRules = stylesheet.split(":root[data-palette='qurra']")[2];
    const shades = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

    for (const family of ['blue', 'cyan', 'sky', 'teal', 'emerald', 'green', 'lime', 'indigo', 'violet']) {
      for (const shade of shades) {
        expect(paletteRules).toContain(
          `--color-${family}-${shade}: rgb(var(--primary-${shade}));`,
        );
      }
    }

    for (const family of ['amber', 'warning', 'orange', 'yellow']) {
      for (const shade of shades) {
        expect(paletteRules).toContain(
          `--color-${family}-${shade}: rgb(var(--accent-${shade}));`,
        );
      }
    }
  });

  it('keeps RGB theme channels within the CSS color range', () => {
    const channelTriplets = stylesheet.matchAll(
      /--(?:primary|accent|surface)-(?:\d+|light|dark):\s*(\d+)\s+(\d+)\s+(\d+)/g,
    );

    for (const triplet of channelTriplets) {
      for (const channel of triplet.slice(1)) {
        expect(Number(channel)).toBeLessThanOrEqual(255);
      }
    }
  });
});
