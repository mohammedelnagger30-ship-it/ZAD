import { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings, type Settings } from '@/db/database';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await getSettings();
      setSettings(s);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر قراءة إعدادات التطبيق من قاعدة البيانات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (patch: Partial<Settings>) => {
    await updateSettings(patch);
    const updated = await getSettings();
    setSettings(updated);
  }, []);

  return { settings, loading, error, save, reload: load };
}

export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
  const [colorPalette, setColorPalette] = useState<ColorPalette>('emerald');

  useEffect(() => {
    const loadTheme = async () => {
      try {
        const s = await getSettings();
        setThemeMode(s.theme);
        const palette = COLOR_PALETTES.find((item) => item.id === s.colorPalette)?.id ?? 'emerald';
        setColorPalette(palette);
        document.documentElement.dataset.palette = palette;
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
    const themeColor = COLOR_PALETTES.find((item) => item.id === palette)?.color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor ?? '#1f734e');
  };

  return { theme, themeMode, changeTheme, colorPalette, changeColorPalette };
}

// Simple navigation hook (no router library)
export type ScreenName =
  | 'home'
  | 'quran'
  | 'planner'
  | 'prayer'
  | 'hadith'
  | 'library'
  | 'progress'
  | 'settings'
  | 'more'
  | 'adhkar'
  | 'tasbih';

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

    const screen = parsed.screen && ['home', 'quran', 'planner', 'prayer', 'hadith', 'library', 'progress', 'settings', 'more', 'adhkar', 'tasbih'].includes(parsed.screen)
      ? parsed.screen
      : 'home';

    const history = Array.isArray(parsed.history) && parsed.history.length > 0
      ? parsed.history.filter((item): item is ScreenName => ['home', 'quran', 'planner', 'prayer', 'hadith', 'library', 'progress', 'settings', 'more', 'adhkar', 'tasbih'].includes(item))
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

export function useNavigation() {
  const restored = getStoredNavigationState();
  const [screen, setScreen] = useState<ScreenName>(restored?.screen ?? 'home');
  const [params, setParams] = useState<NavParams>(restored?.params ?? {});
  const [history, setHistory] = useState<ScreenName[]>(restored?.history ?? ['home']);
  const [paramsByScreen, setParamsByScreen] = useState<Record<string, NavParams>>(restored?.paramsByScreen ?? { home: {} });
  // Bumped only when the user re-taps the tab they are already on. Without it,
  // setScreen(currentScreen) is a React no-op, so tapping "القرآن" while reading a
  // surah did nothing at all and the reader stayed open. Pairing this nonce with the
  // screen `key` in App turns a repeat tap into a reset-to-initial-state.
  const [resetNonce, setResetNonce] = useState(0);

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
    if (target === screen) {
      setParams(p);
      setParamsByScreen((current) => ({ ...current, [target]: p }));
      setResetNonce((n) => n + 1);
      window.scrollTo(0, 0);
      return;
    }

    setParams(p);
    setParamsByScreen((current) => ({ ...current, [target]: p }));
    setHistory((current) => {
      if (current[current.length - 1] === target) return current;
      return [...current, target];
    });
    setScreen(target);
    window.scrollTo(0, 0);
  };

  const goBack = () => {
    setHistory((current) => {
      if (current.length <= 1) return current;

      const previous = current[current.length - 2];
      const previousParams = paramsByScreen[previous] ?? {};
      setScreen(previous);
      setParams(previousParams);
      return current.slice(0, -1);
    });
  };

  return { screen, params, navigate, resetNonce, goBack, history };
}
