/**
 * Ayah highlight colours — the wash an ayah wears when it is marked with a colour,
 * distinct from the plain bookmark wash.
 *
 * A highlight is stored as a colour *id*, never a raw CSS value: the record stays
 * meaningful across themes (one id resolves to a light wash or a dark one from the
 * same `--hl-<id>` variable), survives a redesign of the palette, and reads as a
 * name in an export or a sync payload instead of `rgba(...)`. An unknown id
 * resolves to *no* highlight rather than throwing, because a record may outlive the
 * palette entry it named or arrive from another version of the app.
 */

export interface HighlightColor {
  /** Stable id persisted on the bookmark. */
  id: string;
  /** Label shown on the colour's swatch in the reader's «تمييز» row. */
  labelAr: string;
  /**
   * Solid fill for the picker's swatch — a wash (`--hl-<id>`) is right behind an
   * ayah but too faint to recognise as a button, so the choice is shown as a
   * definite colour and applied as a wash.
   */
  swatch: string;
}

/** The five washes the reader offers, in the order they are shown. */
export const HIGHLIGHT_COLORS: HighlightColor[] = [
  { id: 'gold', labelAr: 'ذهبي', swatch: '#cfa95c' },
  { id: 'green', labelAr: 'أخضر', swatch: '#34a873' },
  { id: 'blue', labelAr: 'أزرق', swatch: '#3b82f6' },
  { id: 'rose', labelAr: 'وردي', swatch: '#f43f5e' },
  { id: 'violet', labelAr: 'بنفسجي', swatch: '#8b5cf6' },
];

/** True when `value` names a colour this build knows how to paint. */
export function isHighlightColor(value: unknown): value is string {
  return typeof value === 'string' && HIGHLIGHT_COLORS.some((c) => c.id === value);
}

/** The palette entry an id names, or `undefined` for an unknown/absent id. */
export function getHighlightColor(colorId: string | undefined): HighlightColor | undefined {
  if (!colorId) return undefined;
  return HIGHLIGHT_COLORS.find((c) => c.id === colorId);
}

/**
 * The CSS colour to paint behind a marked ayah, or `undefined` when there is no
 * (valid) highlight — the caller then falls back to the default bookmark wash.
 */
export function highlightWash(colorId: string | undefined): string | undefined {
  if (!isHighlightColor(colorId)) return undefined;
  return `var(--hl-${colorId})`;
}
