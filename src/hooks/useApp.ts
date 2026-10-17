import { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings, type Settings } from '@/db/database';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';

/**
 * Pre-paint mirror of the theme settings in localStorage.
 *
 * The real values live in IndexedDB, which only async code can read — so on a
 * cold start the page used to paint light and flip dark a beat later, every
 * single time. index.html runs a tiny blocking script before first paint that
 * reads these two keys and sets `html.dark` / `data-palette` right away; every
 * path that applies the theme also rewrites the mirror here. Keep the key
 * strings in step with that script (it cannot import this module).
 */
const THEME_MIRROR_KEY = 'zad:theme';
const PALETTE_MIRROR_KEY = 'zad:palette';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /**
   * `silent` refreshes the settings without touching the UI's loading state.
   * A cloud sync finishing in the background used to call this plainly, which
   * flipped the whole app back to its loading screen — scroll position, playing
   * audio and all. Silent failures keep the data already on screen and only
   * log: the initial load still reports database errors loudly, with retry.
   */
  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const s = await getSettings();
      setSettings(s);
    } catch (cause) {
      if (silent) {
        console.error('Silent settings reload failed:', cause);
        return;
      }
      setError(cause instanceof Error ? cause.message : 'تعذّر قراءة إعدادات التطبيق من قاعدة البيانات.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (patch: Partial<Settings>) => {
    // updateSettings returns the row it wrote, so a save is one read + one
    // write instead of write-then-read-again.
    const updated = await updateSettings(patch);
    setSettings(updated);
  }, []);

  return { settings, loading, error, save, reload: load };
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('dark');
  const [colorPalette, setColorPalette] = useState<ColorPalette>('ocean');

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const s = await getSettings();
        setThemeMode(s.theme);
        const palette = COLOR_PALETTES.find((item) => item.id === s.colorPalette)?.id ?? 'ocean';
        setColorPalette(palette);
        document.documentElement.dataset.palette = palette;
        try {
          localStorage.setItem(PALETTE_MIRROR_KEY, palette);
        } catch {
          // Storage unavailable: the next cold start keeps the default palette's colors.
        }
        document.querySelector('meta[name="theme-color"]')?.setAttribute(
          'content',
          COLOR_PALETTES.find((item) => item.id === palette)?.color ?? '#1f734e',
        );
        applyTheme(s.theme);
      } catch {
        // useSettings reports startup database failures with a retry action.
      }
    };
    void loadTheme();
    window.addEventListener('zad:cloud-sync-complete', loadTheme);
    return () => window.removeEventListener('zad:cloud-sync-complete', loadTheme);
  }, []);

  useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  const applyTheme = (mode: 'light' | 'dark' | 'system') => {
    let isDark: boolean;
    if (mode === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = mode === 'dark';
    }
    setTheme(isDark ? 'dark' : 'light');
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Mirror the *mode* (not the resolved value): the pre-paint script re-resolves
    // 'system' itself, so a device that flips its own setting gets the new answer
    // even before any React code runs.
    try {
      localStorage.setItem(THEME_MIRROR_KEY, mode);
    } catch {
      // Storage unavailable: the flash returns on the next cold start; nothing breaks.
    }
  };

  const changeTheme = async (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
    applyTheme(mode);
    await updateSettings({ theme: mode });
  };

  const changeColorPalette = async (palette: ColorPalette) => {
    await updateSettings({ colorPalette: palette });
    setColorPalette(palette);
    document.documentElement.dataset.palette = palette;
    try {
      localStorage.setItem(PALETTE_MIRROR_KEY, palette);
    } catch {
      // Storage unavailable: only the pre-paint mirror is lost.
    }
    const themeColor = COLOR_PALETTES.find((item) => item.id === palette)?.color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor ?? '#1f734e');
  };

  return { theme, themeMode, changeTheme, colorPalette, changeColorPalette };
}

// Simple navigation hook (no router library)
const SCREEN_NAMES = [
  'home',
  'quran',
  'planner',
  'prayer',
  'salah',
  'hadith',
  'library',
  'progress',
  'settings',
  'more',
  'adhkar',
  'tasbih',
  'bookmarks',
  'search',
] as const;

export type ScreenName = (typeof SCREEN_NAMES)[number];

const VALID_SCREENS: readonly string[] = SCREEN_NAMES;

export type NavParams = Record<string, unknown>;

const NAVIGATION_STORAGE_KEY = 'zad:navigation-state';

function getStoredNavigationState() {
  try {
    const raw = localStorage.getItem(NAVIGATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      screen?: ScreenName;
      params?: NavParams;
      history?: ScreenName[];
      paramsByScreen?: Record<string, NavParams>;
    };

    const screen = parsed.screen && VALID_SCREENS.includes(parsed.screen)
      ? parsed.screen
      : 'home';

    const history = Array.isArray(parsed.history) && parsed.history.length > 0
      ? parsed.history.filter((item): item is ScreenName => VALID_SCREENS.includes(item))
      : [screen];

    return {
      screen,
      params: parsed.params ?? {},
      history,
      paramsByScreen: parsed.paramsByScreen ?? { [screen]: parsed.params ?? {} },
    };
  } catch {
    return null;
  }
}

/** Stable identity for "no params" so the derived `params` never forces a render. */
const EMPTY_PARAMS: NavParams = {};

export function useNavigation() {
  // Restored once per mount: this parses localStorage, and the hook re-renders
  // on every navigation and every params change — reading it per render burned
  // a getItem + JSON.parse on each one. A `useState` lazy initializer runs
  // exactly once.
  const [restored] = useState(getStoredNavigationState);
  const [history, setHistory] = useState<ScreenName[]>(restored?.history ?? ['home']);
  const [paramsByScreen, setParamsByScreen] = useState<Record<string, NavParams>>(
    restored?.paramsByScreen ?? { home: restored?.params ?? {} },
  );
  // Bumped only when the user re-taps the tab they are already on. Without it,
  // navigating to the current screen is a React no-op, so tapping "القرآن" while
  // reading a surah did nothing at all and the reader stayed open. Pairing this
  // nonce with the screen `key` in App turns a repeat tap into a reset-to-initial-state.
  const [resetNonce, setResetNonce] = useState(0);

  // `screen` and `params` are derived from the stack and the per-screen map, so
  // there is no second copy of "where am I" left to fall out of sync — and
  // goBack is a pure state update instead of calling setScreen from inside a
  // setHistory updater (a side effect in an updater runs twice under StrictMode,
  // and React never guaranteed it ran at all).
  const screen = history[history.length - 1] ?? 'home';
  const params = paramsByScreen[screen] ?? EMPTY_PARAMS;

  useEffect(() => {
    try {
      localStorage.setItem(
        NAVIGATION_STORAGE_KEY,
        JSON.stringify({ screen, params, history, paramsByScreen }),
      );
    } catch {
      // Best-effort persistence only.
    }
  }, [history, params, paramsByScreen, screen]);

  const navigate = (target: ScreenName, p: NavParams = {}) => {
    setParamsByScreen((current) => ({ ...current, [target]: p }));
    window.scrollTo(0, 0);
    if (target === screen) {
      setResetNonce((n) => n + 1);
      return;
    }
    setHistory((current) => (current[current.length - 1] === target ? current : [...current, target]));
  };

  const goBack = () => {
    setHistory((current) => (current.length <= 1 ? current : current.slice(0, -1)));
  };

  return { screen, params, navigate, resetNonce, goBack, history };
}
