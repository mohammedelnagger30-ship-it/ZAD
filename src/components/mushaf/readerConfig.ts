import { Sun, Moon, MoveVertical, MoveHorizontal } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getSurah } from '@/data/surahs';

/**
 * Everything the MushafReader reads but does not own: the tuning constants,
 * the saved-reading-prefs contract, the mode/orientation choosers and the two
 * pure predicates. Split out so the reader component itself is left with only
 * the state and handlers that genuinely belong to one mounted instance.
 */

export const ZOOM_STEP = 0.1;
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 2;
/** Pages are the smallest useful jump target; below this the text stops being readable. */
export const PAGE_KEYBOARD_STEP = 10;
export const SWIPE_DISTANCE = 50;
export const PREFS_KEY = 'zad:mushaf-prefs';

/**
 * The vertical stack never holds the whole mushaf: 602 sheets of set type are far too
 * many to mount. It keeps a sliding window instead — LEAF_PRELOAD sheets to open on,
 * LEAF_CHUNK sheets added at a time when the reader runs out, and never more than
 * LEAF_WINDOW at once, so the tail is trimmed as the head grows.
 */
export const LEAF_PRELOAD = 8;
export const LEAF_CHUNK = 6;
export const LEAF_WINDOW = 40;
/** Within this many pixels of the head the stack pre-loads, so it never dead-ends. */
export const LEAF_HEADROOM = 8;

export type MushafMode = 'day' | 'night';
/** Which way the reader travels: down a stack of sheets, or across one sheet at a time. */
export type Orientation = 'vertical' | 'horizontal';
/** What the voice carries when an ayah is asked about: that ayah, or the surah through it. */
export type VoiceScope = 'ayah' | 'surah';
export type JumpTarget = 'page' | 'surah' | 'juz' | 'hizb';

/**
 * How the reader looks, kept in one object on purpose.
 *
 * Night, zoom and spacing used to live in five independent pieces of
 * state, so the shell could end up half themed — chrome in one mode, page in
 * another — and every change was lost on close. One object, one writer, one
 * key in localStorage.
 */
export interface MushafPrefs {
  mode: MushafMode;
  orientation: Orientation;
  zoom: number;
  readingScale: number;
  lineSpacing: number;
  wordSpacing: number;
  /** Kept here because a reader who listens to surahs keeps hearing surahs. */
  scope: VoiceScope;
}

export const DEFAULT_PREFS: MushafPrefs = {
  mode: 'day',
  orientation: 'vertical',
  zoom: 1,
  readingScale: 1,
  lineSpacing: 1,
  wordSpacing: 0,
  scope: 'ayah',
};

/**
 * The ways into the mushaf, ordered by how a reader reaches for them: the surah by
 * name first — the list is the front door — then the parts, then a page number
 * typed by someone who already knows it.
 */
export const JUMP_TABS: { id: JumpTarget; label: string }[] = [
  { id: 'surah', label: 'سورة' },
  { id: 'juz', label: 'جزء' },
  { id: 'hizb', label: 'حزب' },
  { id: 'page', label: 'صفحة' },
];

export const MODES: { id: MushafMode; label: string; Icon: LucideIcon }[] = [
  { id: 'day', label: 'نهاري', Icon: Sun },
  { id: 'night', label: 'ليلي', Icon: Moon },
];

export const ORIENTATIONS: { id: Orientation; label: string; hint: string; Icon: LucideIcon }[] = [
  {
    id: 'vertical',
    label: 'بالطول',
    hint: 'التنقّل الافتراضي: تنزل بالصفحة تحتها فتأتي التي بعدها، بلا أزرار.',
    Icon: MoveVertical,
  },
  {
    id: 'horizontal',
    label: 'بالعرض',
    hint: 'ورقة واحدة أمامك: اسحب يميناً أو يساراً لقلبها، أو استخدم أسهم لوحة المفاتيح.',
    Icon: MoveHorizontal,
  },
];

export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Nothing follows a surah's own last ayah, so the transport has nothing to offer there. */
export function isSurahEnd(choice: { surahId: number; ayahNumber: number } | null): boolean {
  if (!choice) return false;
  const surah = getSurah(choice.surahId);
  return !!surah && choice.ayahNumber >= surah.ayahCount;
}

export function loadPrefs(): MushafPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<MushafPrefs>;
    return {
      // Anything saved before the paper mode was dropped, or by a later build,
      // opens as the default day sheet rather than on a mode nothing draws.
      mode: parsed.mode === 'night' ? 'night' : 'day',
      // Saved before the option existed, so it opens the way it reads by default.
      orientation: parsed.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      zoom: clampNumber(parsed.zoom, ZOOM_MIN, ZOOM_MAX, DEFAULT_PREFS.zoom),
      readingScale: clampNumber(parsed.readingScale, 0.85, 1.35, DEFAULT_PREFS.readingScale),
      lineSpacing: clampNumber(parsed.lineSpacing, 0.9, 1.35, DEFAULT_PREFS.lineSpacing),
      wordSpacing: clampNumber(parsed.wordSpacing, 0, 0.3, DEFAULT_PREFS.wordSpacing),
      // Saved before the option existed, so it opens the way it reads by default.
      scope: parsed.scope === 'surah' ? 'surah' : 'ayah',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
