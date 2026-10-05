export const COLOR_PALETTES = [
  { id: 'emerald', name: 'زمردي', color: '#1f734e' },
  { id: 'ocean', name: 'محيطي', color: '#1d6782' },
  { id: 'plum', name: 'ليلكي', color: '#6d407b' },
  { id: 'sand', name: 'رملي', color: '#7f6d32' },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]['id'];
