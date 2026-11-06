import { lazy, type ComponentType } from 'react';

const LAZY_RETRY_KEY = 'hifzi-lazy-reload-tried';

/**
 * Wrap a screen's dynamic import in a single-reload recovery.
 *
 * A route chunk can be served either by the service worker's precache or by the APK's own
 * assets, and for a brief window right after an in-app update those two disagree: the page asks
 * for the new hashed filename while the old worker is still in control, so the dynamic import
 * rejects once with "Failed to fetch dynamically imported module". A rejected import would
 * otherwise propagate up to the top-level ErrorBoundary and blank the whole app.
 *
 * A same-URL retry cannot succeed: Chromium (and the app's WebView) caches the failed import
 * in the module map for the document's lifetime, so re-importing the identical URL fails
 * instantly without even hitting the network. The only recovery is to reload: a fresh document
 * starts with a clean module map, and by then the newly activated service worker serves the
 * chunk. We reload at most once per boot (latch); a reloaded page that still cannot load the
 * chunk lets the true error reach the error boundary instead of reloading forever.
 */
// The constraint mirrors @types/react's own `lazy()` (T extends ComponentType<any>); a concrete
// props type cannot name it because function components are contravariant in their props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LazyScreenModule = { default: ComponentType<any> };

function lazyWithRetry<M extends LazyScreenModule>(loader: () => Promise<M>) {
  return lazy(async () => {
    try {
      const module = await loader();
      sessionStorage.removeItem(LAZY_RETRY_KEY);
      return module;
    } catch (error) {
      if (sessionStorage.getItem(LAZY_RETRY_KEY)) throw error;
      sessionStorage.setItem(LAZY_RETRY_KEY, '1');
      window.location.reload();
      return new Promise<M>((_, reject) => {
        window.setTimeout(() => reject(error), 15000);
      });
    }
  });
}

export const HomeScreen = lazyWithRetry(() => import('@/screens/HomeScreen').then((module) => ({ default: module.HomeScreen })));
export const Onboarding = lazyWithRetry(() => import('@/screens/Onboarding').then((module) => ({ default: module.Onboarding })));
export const QuranScreen = lazyWithRetry(() => import('@/screens/QuranScreen').then((module) => ({ default: module.QuranScreen })));
export const PlannerScreen = lazyWithRetry(() => import('@/screens/PlannerScreen').then((module) => ({ default: module.PlannerScreen })));
export const PrayerScreen = lazyWithRetry(() => import('@/screens/PrayerScreen').then((module) => ({ default: module.PrayerScreen })));
export const PrayerGuideScreen = lazyWithRetry(() => import('@/screens/PrayerGuideScreen').then((module) => ({ default: module.PrayerGuideScreen })));
export const HadithScreen = lazyWithRetry(() => import('@/screens/HadithScreen').then((module) => ({ default: module.HadithScreen })));
export const SunnahScreen = lazyWithRetry(() => import('@/screens/SunnahScreen').then((module) => ({ default: module.SunnahScreen })));
export const ProphetScreen = lazyWithRetry(() => import('@/screens/ProphetScreen').then((module) => ({ default: module.ProphetScreen })));
export const HuwainiScreen = lazyWithRetry(() => import('@/screens/HuwainiScreen').then((module) => ({ default: module.HuwainiScreen })));
export const NawafilScreen = lazyWithRetry(() => import('@/screens/NawafilScreen').then((module) => ({ default: module.NawafilScreen })));
export const ProgressScreen = lazyWithRetry(() => import('@/screens/ProgressScreen').then((module) => ({ default: module.ProgressScreen })));
export const SettingsScreen = lazyWithRetry(() => import('@/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
export const MoreScreen = lazyWithRetry(() => import('@/screens/MoreScreen').then((module) => ({ default: module.MoreScreen })));
export const ContentLibrary = lazyWithRetry(() => import('@/screens/ContentLibrary').then((module) => ({ default: module.ContentLibrary })));
export const AdhkarScreen = lazyWithRetry(() => import('@/screens/AdhkarScreen').then((module) => ({ default: module.AdhkarScreen })));
export const TasbihScreen = lazyWithRetry(() => import('@/screens/TasbihScreen').then((module) => ({ default: module.TasbihScreen })));
export const BookmarksScreen = lazyWithRetry(() => import('@/screens/BookmarksScreen').then((module) => ({ default: module.BookmarksScreen })));
export const SearchScreen = lazyWithRetry(() => import('@/screens/SearchScreen').then((module) => ({ default: module.SearchScreen })));
export const AdminScreen = lazyWithRetry(() => import('@/screens/AdminScreen').then((module) => ({ default: module.AdminScreen })));
