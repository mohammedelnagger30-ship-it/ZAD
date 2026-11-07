/**
 * Professional tri-color identities — world-class, harmonious, high-contrast palettes.
 *
 * Every palette is a complete identity built on three distinct signature colors:
 * - `color`     → primary-600: buttons, headers, brand actions (اللون الأساسي)
 * - `tertiary`  → signature bridge color: navigation accents, badges, highlights (اللون الثالث المكمل)
 * - `accent`    → accent-500: focus rings, secondary actions, selections (لون التمييز)
 * - `gradient`  → signature multi-stop brand blend uniting all 3 tones in luxury harmony
 * - `glow`      → ambient shadow tint derived from the primary
 * - `soft`      → light tinted surface for chips and highlights
 * - `latin`/`vibe` → shown in the picker so each identity reads as a story
 */
export const COLOR_PALETTES = [
  {
    // The master signature identity: Forest Green, Pristine Ivory White, Royal Aged Gold.
    id: 'qurra',
    name: 'قُرّة',
    latin: 'Qurra',
    vibe: 'أخضر زمردي نضر · أبيض عاجي · ذهب ساطع',
    color: '#165b39',
    tertiary: '#ffffff',
    accent: '#d4a520',
    gradient:
      'linear-gradient(135deg, #105936 0%, #165b39 42%, #1fa363 70%, #d4a520 100%)',
    glow: 'rgba(23, 122, 75, 0.36)',
    soft: '#f0fdf4',
  },
  {
    id: 'emerald',
    name: 'زمردي',
    latin: 'Emerald',
    vibe: 'زمرد غابي · نعناع مشرق · كهرمان دافئ',
    color: '#15803d',
    tertiary: '#6ee7b7',
    accent: '#b45309',
    gradient:
      'linear-gradient(135deg, #15803d 0%, #34d399 45%, #ecfdf5 70%, #b45309 100%)',
    glow: 'rgba(21, 128, 61, 0.35)',
    soft: '#ecfdf5',
  },
  {
    id: 'ocean',
    name: 'محيطي',
    latin: 'Ocean',
    vibe: 'أعماق البحر · زرقة السماء · شمس الغروب',
    color: '#0369a1',
    tertiary: '#7dd3fc',
    accent: '#b84414',
    gradient:
      'linear-gradient(135deg, #0369a1 0%, #38bdf8 45%, #f0f9ff 70%, #b84414 100%)',
    glow: 'rgba(3, 105, 161, 0.35)',
    soft: '#f0f9ff',
  },
  {
    id: 'plum',
    name: 'ملكي',
    latin: 'Royal Plum',
    vibe: 'مخمل بنفسجي · ليلك رقيق · ذهب عتيق',
    color: '#7e2f8e',
    tertiary: '#d8b4fe',
    accent: '#92400e',
    gradient:
      'linear-gradient(135deg, #7e2f8e 0%, #c084fc 45%, #faf5ff 70%, #92400e 100%)',
    glow: 'rgba(126, 47, 142, 0.35)',
    soft: '#faf5ff',
  },
  {
    id: 'sand',
    name: 'صحراوي',
    latin: 'Desert',
    vibe: 'كثبان برونزية · رمال ذهبية · واحة فيروزية',
    color: '#854d0e',
    tertiary: '#fcd34d',
    accent: '#0f766e',
    gradient:
      'linear-gradient(135deg, #854d0e 0%, #fbbf24 45%, #fef3c7 70%, #0f766e 100%)',
    glow: 'rgba(133, 77, 14, 0.35)',
    soft: '#fbfaf3',
  },
  {
    id: 'olive',
    name: 'زيتوني',
    latin: 'Olive',
    vibe: 'بستان زيتون · مريمية ناعمة · طوب قرميدي',
    color: '#4d7c0f',
    tertiary: '#bef264',
    accent: '#b91c1c',
    gradient:
      'linear-gradient(135deg, #4d7c0f 0%, #a3e635 45%, #f7fee7 70%, #b91c1c 100%)',
    glow: 'rgba(77, 124, 15, 0.35)',
    soft: '#f8faf2',
  },
  {
    id: 'rose',
    name: 'وردي',
    latin: 'Rose',
    vibe: 'ورد مخملي · بتلات زهرية · زمرد نضر',
    color: '#be185d',
    tertiary: '#fda4af',
    accent: '#047857',
    gradient:
      'linear-gradient(135deg, #be185d 0%, #f472b6 45%, #fff1f2 70%, #047857 100%)',
    glow: 'rgba(190, 24, 93, 0.35)',
    soft: '#fff1f3',
  },
  {
    id: 'midnight',
    name: 'ليلي',
    latin: 'Midnight',
    vibe: 'سماء داكنة · زرقة فولاذية · قمر عنبري',
    color: '#1e3a8a',
    tertiary: '#93c5fd',
    accent: '#a16207',
    gradient:
      'linear-gradient(135deg, #1e3a8a 0%, #60a5fa 45%, #eff6ff 70%, #a16207 100%)',
    glow: 'rgba(30, 58, 138, 0.35)',
    soft: '#eff6ff',
  },
  {
    id: 'ruby',
    name: 'ياقوتي',
    latin: 'Ruby',
    vibe: 'ياقوت أحمر · مرجان ساطع · فيروز بحري',
    color: '#991b1b',
    tertiary: '#fca5a5',
    accent: '#0e7490',
    gradient:
      'linear-gradient(135deg, #991b1b 0%, #f87171 45%, #fef2f2 70%, #0e7490 100%)',
    glow: 'rgba(153, 27, 27, 0.35)',
    soft: '#fef2f2',
  },
  {
    id: 'amber',
    name: 'عنبري',
    latin: 'Amber',
    vibe: 'عسل كهرماني · شمس ذهبية · زرقة نيلية',
    color: '#b45309',
    tertiary: '#fbbf24',
    accent: '#2563eb',
    gradient:
      'linear-gradient(135deg, #b45309 0%, #f59e0b 45%, #fffbeb 70%, #2563eb 100%)',
    glow: 'rgba(180, 83, 9, 0.35)',
    soft: '#fffbeb',
  },
  {
    id: 'forest',
    name: 'غابي',
    latin: 'Forest',
    vibe: 'غابة عميقة · طحلب مشرق · توت قرمزي',
    color: '#14532d',
    tertiary: '#86efac',
    accent: '#86198f',
    gradient:
      'linear-gradient(135deg, #14532d 0%, #4ade80 45%, #f0fdf4 70%, #86198f 100%)',
    glow: 'rgba(20, 83, 45, 0.35)',
    soft: '#f0fdf4',
  },
  {
    id: 'slate',
    name: 'رمادي',
    latin: 'Slate',
    vibe: 'حجر أردواز · فضي معدني · نحاس متقد',
    color: '#334155',
    tertiary: '#cbd5e1',
    accent: '#c2410c',
    gradient:
      'linear-gradient(135deg, #334155 0%, #94a3b8 45%, #f8fafc 70%, #c2410c 100%)',
    glow: 'rgba(51, 65, 85, 0.35)',
    soft: '#f8fafc',
  },
  {
    id: 'lavender',
    name: 'خزامي',
    latin: 'Lavender',
    vibe: 'حقول لافندر · بنفسج رقيق · ورق أخضر',
    color: '#6d28d9',
    tertiary: '#c4b5fd',
    accent: '#15803d',
    gradient:
      'linear-gradient(135deg, #6d28d9 0%, #a78bfa 45%, #f5f3ff 70%, #15803d 100%)',
    glow: 'rgba(109, 40, 217, 0.35)',
    soft: '#f5f3ff',
  },
  {
    id: 'obsidian',
    name: 'أونيكس',
    latin: 'Obsidian',
    vibe: 'فحم بلاتيني · فولاذ ناصع · بريق الزمرد',
    color: '#1f2937',
    tertiary: '#9ca3af',
    accent: '#115e59',
    gradient:
      'linear-gradient(135deg, #111827 0%, #374151 45%, #e5e7eb 70%, #115e59 100%)',
    glow: 'rgba(17, 94, 89, 0.38)',
    soft: '#f1f7f7',
  },
  {
    id: 'nocturne',
    name: 'نوكتورن',
    latin: 'Nocturne',
    vibe: 'مخمل ليلي · ليلك ملوكي · ذهب معتق',
    color: '#3b1f5c',
    tertiary: '#a855f7',
    accent: '#78350f',
    gradient:
      'linear-gradient(135deg, #24123a 0%, #581c87 45%, #fae8ff 70%, #78350f 100%)',
    glow: 'rgba(91, 44, 115, 0.4)',
    soft: '#f7f2fa',
  },
  {
    id: 'abyss',
    name: 'لُجّي',
    latin: 'Abyss',
    vibe: 'أعماق كحلية · زرقة فيروزية · ضوء البحر',
    color: '#0b3954',
    tertiary: '#22d3ee',
    accent: '#155e75',
    gradient:
      'linear-gradient(135deg, #08283b 0%, #0284c7 45%, #e0f2fe 70%, #155e75 100%)',
    glow: 'rgba(14, 116, 144, 0.4)',
    soft: '#eff7fa',
  },
] as const;

export type ColorPalette = (typeof COLOR_PALETTES)[number]['id'];

export const FEATURED_COLOR_PALETTE_IDS: readonly ColorPalette[] = [
  'qurra',
  'emerald',
  'ocean',
  'sand',
  'plum',
  'midnight',
];
