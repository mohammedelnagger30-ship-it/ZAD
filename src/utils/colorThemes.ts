/**
 * World-class color identities.
 *
 * Every palette is a complete, harmonious identity — not a single swatch:
 * - `color`        → primary-600: buttons, headers, reader chrome, theme-color meta
 * - `accent`       → accent-500: focus rings, secondary actions, selections
 * - `gradient`     → the signature 135° brand blend (primary → accent)
 * - `glow`         → ambient shadow/glow tint derived from the primary
 * - `soft`         → light tinted surface for chips and highlights
 * - `latin`/`vibe` → shown in the picker so each identity reads as a story
 *
 * The complementary pairings (green×ember, sea×copper, violet×antique-gold,
 * bronze×oasis, olive×brick, rose×emerald) keep every theme distinct in both
 * light and dark modes. `accent` must stay ≥ 4.5:1 against white — enforced
 * by `colorThemes.test.ts`.
 */
export const COLOR_PALETTES = [
  {
    id: 'emerald',
    name: 'زمردي',
    latin: 'Emerald',
    vibe: 'غابة هادئة بلمسة كهرمان',
    color: '#1f734e',
    accent: '#b84414',
    gradient: 'linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%)',
    glow: 'rgba(31, 115, 78, 0.28)',
    soft: '#eef7f1',
  },
  {
    id: 'ocean',
    name: 'محيطي',
    latin: 'Ocean',
    vibe: 'أعماق البحر وقت الغروب',
    color: '#1d6782',
    accent: '#b45309',
    gradient: 'linear-gradient(135deg, #1d6782 0%, #2b8aa5 45%, #b45309 100%)',
    glow: 'rgba(29, 103, 130, 0.28)',
    soft: '#ecf5f8',
  },
  {
    id: 'plum',
    name: 'ملكي',
    latin: 'Royal Plum',
    vibe: 'مخمل بنفسجي بذهب عتيق',
    color: '#6d407b',
    accent: '#96660a',
    gradient: 'linear-gradient(135deg, #6d407b 0%, #9a6fb0 45%, #96660a 100%)',
    glow: 'rgba(109, 64, 123, 0.30)',
    soft: '#f4eef7',
  },
  {
    id: 'sand',
    name: 'صحراوي',
    latin: 'Desert',
    vibe: 'كثبان برونزية وواحة فيروزية',
    color: '#7f6d32',
    accent: '#0e7490',
    gradient: 'linear-gradient(135deg, #7f6d32 0%, #a68c3f 45%, #0e7490 100%)',
    glow: 'rgba(127, 109, 50, 0.30)',
    soft: '#f8f4e7',
  },
  {
    id: 'olive',
    name: 'زيتوني',
    latin: 'Olive',
    vibe: 'بستان زيتون بطوب دافئ',
    color: '#586b3d',
    accent: '#a83a2e',
    gradient: 'linear-gradient(135deg, #586b3d 0%, #7d9159 45%, #a83a2e 100%)',
    glow: 'rgba(88, 107, 61, 0.30)',
    soft: '#f1f4e9',
  },
  {
    id: 'rose',
    name: 'وردي',
    latin: 'Rose',
    vibe: 'ورد عميق بزمردة منعشة',
    color: '#a34158',
    accent: '#1f6f4a',
    gradient: 'linear-gradient(135deg, #a34158 0%, #cc7489 45%, #1f6f4a 100%)',
    glow: 'rgba(163, 65, 88, 0.30)',
    soft: '#faeff2',
  },
  {
    id: 'midnight',
    name: 'ليلي',
    latin: 'Midnight',
    vibe: 'سماء منتصف الليل بضوء العنبر',
    color: '#1e3a5f',
    accent: '#a16207',
    gradient: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a8a 45%, #a16207 100%)',
    glow: 'rgba(30, 58, 95, 0.28)',
    soft: '#edf2f8',
  },
  {
    id: 'ruby',
    name: 'ياقوتي',
    latin: 'Ruby',
    vibe: 'ياقوتة حمراء بإطار فيروزي',
    color: '#9b1b30',
    accent: '#0d7377',
    gradient: 'linear-gradient(135deg, #9b1b30 0%, #c44055 45%, #0d7377 100%)',
    glow: 'rgba(155, 27, 48, 0.28)',
    soft: '#fceef1',
  },
  {
    id: 'amber',
    name: 'عنبري',
    latin: 'Amber',
    vibe: 'عسل ذهبي بلمسة نيلية',
    color: '#92680a',
    accent: '#4338ca',
    gradient: 'linear-gradient(135deg, #92680a 0%, #b8860b 45%, #4338ca 100%)',
    glow: 'rgba(146, 104, 10, 0.30)',
    soft: '#faf6e9',
  },
  {
    id: 'forest',
    name: 'غابي',
    latin: 'Forest',
    vibe: 'أعماق الغابة بتوت بري',
    color: '#2d5016',
    accent: '#8b2252',
    gradient: 'linear-gradient(135deg, #2d5016 0%, #4a7c2e 45%, #8b2252 100%)',
    glow: 'rgba(45, 80, 22, 0.28)',
    soft: '#f0f5eb',
  },
  {
    id: 'slate',
    name: 'رمادي',
    latin: 'Slate',
    vibe: 'صخرة أردوازية بنحاس دافئ',
    color: '#475569',
    accent: '#c2410c',
    gradient: 'linear-gradient(135deg, #475569 0%, #64748b 45%, #c2410c 100%)',
    glow: 'rgba(71, 85, 105, 0.28)',
    soft: '#f1f3f6',
  },
  {
    id: 'lavender',
    name: 'خزامي',
    latin: 'Lavender',
    vibe: 'حقل الخزامى بأعشاب خضراء',
    color: '#7c3aed',
    accent: '#4d7c0f',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 45%, #4d7c0f 100%)',
    glow: 'rgba(124, 58, 237, 0.28)',
    soft: '#f3f0ff',
  },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]['id'];
