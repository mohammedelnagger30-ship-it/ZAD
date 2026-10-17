/**
 * Professional color identities — world-class, harmonious, high-contrast palettes.
 *
 * Every palette is a complete identity, not a single swatch:
 * - `color`        → primary-600: buttons, headers, brand actions
 * - `accent`       → accent-500: focus rings, secondary actions, selections
 * - `gradient`     → signature multi-stop brand blend (primary → mid → accent)
 * - `glow`         → ambient shadow tint derived from the primary
 * - `soft`         → light tinted surface for chips and highlights
 * - `latin`/`vibe` → shown in the picker so each identity reads as a story
 *
 * Contrast: every `accent` measures ≥ 4.5:1 against white (WCAG AA) and most
 * primary-600s measure ≥ 7:1 against white (WCAG AAA). Enforced by
 * `colorThemes.test.ts`.
 *
 * The pairings below stay distinct in both light and dark modes:
 * emerald×copper, sea×ember, plum×antique-gold, bronze×oasis,
 * olive×brick, rose×emerald, midnight×amber, ruby×teal,
 * honey×indigo, forest×berry, slate×rust, lavender×leaf
 */
export const COLOR_PALETTES = [
  {
    id: 'emerald',
    name: 'زمردي',
    latin: 'Emerald',
    vibe: 'غابة هادئة بلمسة كهرمان',
    color: '#15803d',
    accent: '#b45309',
    gradient:
      'linear-gradient(135deg, #15803d 0%, #2dd4bf 40%, #6ee7b7 65%, #b45309 100%)',
    glow: 'rgba(21, 128, 61, 0.35)',
    soft: '#ecfdf5',
  },
  {
    id: 'ocean',
    name: 'محيطي',
    latin: 'Ocean',
    vibe: 'أعماق البحر وقت الغروب',
    color: '#0369a1',
    accent: '#b84414',
    gradient:
      'linear-gradient(135deg, #0369a1 0%, #38bdf8 40%, #7dd3fc 65%, #b84414 100%)',
    glow: 'rgba(3, 105, 161, 0.35)',
    soft: '#f0f9ff',
  },
  {
    id: 'plum',
    name: 'ملكي',
    latin: 'Royal Plum',
    vibe: 'مخمل بنفسجي بذهب عتيق',
    color: '#7e2f8e',
    accent: '#92400e',
    gradient:
      'linear-gradient(135deg, #7e2f8e 0%, #c084fc 40%, #e9d5ff 65%, #92400e 100%)',
    glow: 'rgba(126, 47, 142, 0.35)',
    soft: '#faf5ff',
  },
  {
    id: 'sand',
    name: 'صحراوي',
    latin: 'Desert',
    vibe: 'كثبان برونزية وواحة فيروزية',
    color: '#854d0e',
    accent: '#0f766e',
    gradient:
      'linear-gradient(135deg, #854d0e 0%, #d97706 40%, #fcd34d 65%, #0f766e 100%)',
    glow: 'rgba(133, 77, 14, 0.35)',
    soft: '#fbfaf3',
  },
  {
    id: 'olive',
    name: 'زيتوني',
    latin: 'Olive',
    vibe: 'بستان زيتون بطوب دافئ',
    color: '#4d7c0f',
    accent: '#b91c1c',
    gradient:
      'linear-gradient(135deg, #4d7c0f 0%, #86efac 40%, #fecaca 65%, #b91c1c 100%)',
    glow: 'rgba(77, 124, 15, 0.35)',
    soft: '#f8faf2',
  },
  {
    id: 'rose',
    name: 'وردي',
    latin: 'Rose',
    vibe: 'ورد عميق بزمردة منعشة',
    color: '#be185d',
    accent: '#047857',
    gradient:
      'linear-gradient(135deg, #be185d 0%, #f472b6 40%, #fce7f3 65%, #047857 100%)',
    glow: 'rgba(190, 24, 93, 0.35)',
    soft: '#fff1f3',
  },
  {
    id: 'midnight',
    name: 'ليلي',
    latin: 'Midnight',
    vibe: 'سماء منتصف الليل بضوء العنبر',
    color: '#1e3a8a',
    accent: '#a16207',
    gradient:
      'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 40%, #93c5fd 65%, #a16207 100%)',
    glow: 'rgba(30, 58, 138, 0.35)',
    soft: '#eff6ff',
  },
  {
    id: 'ruby',
    name: 'ياقوتي',
    latin: 'Ruby',
    vibe: 'ياقوتة حمراء بإطار فيروزي',
    color: '#991b1b',
    accent: '#0e7490',
    gradient:
      'linear-gradient(135deg, #991b1b 0%, #fca5a5 40%, #fecaca 65%, #0e7490 100%)',
    glow: 'rgba(153, 27, 27, 0.35)',
    soft: '#fef2f2',
  },
  {
    id: 'amber',
    name: 'عنبري',
    latin: 'Amber',
    vibe: 'عسل ذهبي بلمسة نيلية',
    color: '#b45309',
    accent: '#2563eb',
    gradient:
      'linear-gradient(135deg, #b45309 0%, #fbbf24 40%, #fef3c7 65%, #2563eb 100%)',
    glow: 'rgba(180, 83, 9, 0.35)',
    soft: '#fffbeb',
  },
  {
    id: 'forest',
    name: 'غابي',
    latin: 'Forest',
    vibe: 'أعماق الغابة بتوت بري',
    color: '#14532d',
    accent: '#86198f',
    gradient:
      'linear-gradient(135deg, #14532d 0%, #86efac 40%, #fce7f3 65%, #86198f 100%)',
    glow: 'rgba(20, 83, 45, 0.35)',
    soft: '#f0fdf4',
  },
  {
    id: 'slate',
    name: 'رمادي',
    latin: 'Slate',
    vibe: 'صخرة أردوازية بنحاس دافئ',
    color: '#334155',
    accent: '#c2410c',
    gradient:
      'linear-gradient(135deg, #334155 0%, #94a3b8 40%, #cbd5e1 65%, #c2410c 100%)',
    glow: 'rgba(51, 65, 85, 0.35)',
    soft: '#f8fafc',
  },
  {
    id: 'lavender',
    name: 'خزامي',
    latin: 'Lavender',
    vibe: 'حقل الخزامى بأعشاب خضراء',
    color: '#6d28d9',
    accent: '#15803d',
    gradient:
      'linear-gradient(135deg, #6d28d9 0%, #a78bfa 40%, #d8b4fe 65%, #15803d 100%)',
    glow: 'rgba(109, 40, 217, 0.35)',
    soft: '#f5f3ff',
  },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]['id'];
