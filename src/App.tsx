import { lazy, Suspense, type ComponentType, useState, useEffect, useCallback } from 'react';
import { CloudOff, X } from 'lucide-react';
import { useSettings, useTheme, useNavigation } from '@/hooks/useApp';
import { BottomNav } from '@/components/BottomNav';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthScreen } from '@/components/AuthScreen';
import { generateDailyTasks, markMissedTasks } from '@/utils/taskManager';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import { clearLocalUserData, startCloudSync, synchronizeNow, type CloudSyncState } from '@/utils/cloudSync';
import { isSupabaseConfigured, supabase } from '@/utils/supabaseClient';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import type { Settings } from '@/db/database';
import { AzanOverlayModal } from '@/components/AzanOverlayModal';
import { useAzanTrigger } from '@/hooks/useAzanTrigger';

const ONBOARDED_KEY = 'hifzi-onboarded';
// Latch used by lazyWithRetry: after a chunk 404 we reload once; a reloaded page that
// fails again surfaces the real error instead of reloading in a loop.
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
      // A successfully loaded screen re-arms the latch so a later transient failure
      // (e.g. a future in-app update) can trigger recovery again.
      sessionStorage.removeItem(LAZY_RETRY_KEY);
      return module;
    } catch (error) {
      if (sessionStorage.getItem(LAZY_RETRY_KEY)) {
        throw error; // already reloaded once this boot: surface the real failure
      }
      sessionStorage.setItem(LAZY_RETRY_KEY, '1');
      window.location.reload();
      // The frame is torn down during navigation; keep the lazy promise pending so no error
      // boundary flashes in the dying frame. If the reload is blocked for some reason, surface
      // the original error after a grace period.
      return new Promise<M>((_, reject) => {
        window.setTimeout(() => reject(error), 15000);
      });
    }
  });
}

const HomeScreen = lazyWithRetry(() => import('@/screens/HomeScreen').then((module) => ({ default: module.HomeScreen })));
const Onboarding = lazyWithRetry(() => import('@/components/Onboarding').then((module) => ({ default: module.Onboarding })));
const QuranScreen = lazyWithRetry(() => import('@/screens/QuranScreen').then((module) => ({ default: module.QuranScreen })));
const PlannerScreen = lazyWithRetry(() => import('@/screens/PlannerScreen').then((module) => ({ default: module.PlannerScreen })));
const PrayerScreen = lazyWithRetry(() => import('@/screens/PrayerScreen').then((module) => ({ default: module.PrayerScreen })));
const HadithScreen = lazyWithRetry(() => import('@/screens/HadithScreen').then((module) => ({ default: module.HadithScreen })));
const ProgressScreen = lazyWithRetry(() => import('@/screens/ProgressScreen').then((module) => ({ default: module.ProgressScreen })));
const SettingsScreen = lazyWithRetry(() => import('@/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const MoreScreen = lazyWithRetry(() => import('@/screens/MoreScreen').then((module) => ({ default: module.MoreScreen })));
const ContentLibrary = lazyWithRetry(() => import('@/screens/ContentLibrary').then((module) => ({ default: module.ContentLibrary })));
const AdhkarScreen = lazyWithRetry(() => import('@/screens/AdhkarScreen').then((module) => ({ default: module.AdhkarScreen })));
const TasbihScreen = lazyWithRetry(() => import('@/screens/TasbihScreen').then((module) => ({ default: module.TasbihScreen })));

function App() {
  return (
    <>
      <AppUpdateNotice />
      <Application />
    </>
  );
}

function AppUpdateNotice() {
  const {
    update,
    error,
    checking,
    downloading,
    progress,
    pending,
    installHint,
    startDownload,
    cancelDownload,
    install,
    openInBrowser,
  } = useAppUpdate();
  const [dismissed, setDismissed] = useState(false);

  const available = update?.status === 'available' ? update : null;
  if (dismissed || (!error && !available && !pending && !downloading)) return null;

  const percent = progress && progress.percent >= 0 ? progress.percent : null;

  return (
    <aside className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100] mx-auto max-w-lg rounded-2xl border border-gold-300 bg-white p-4 shadow-xl dark:border-gold-600 dark:bg-primary-900" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-primary-900 dark:text-primary-50">
            {downloading
              ? 'جارٍ تنزيل التحديث…'
              : pending
                ? 'اكتمل تنزيل التحديث'
                : available
                  ? `يتوفر تحديث جديد — الإصدار ${available.version}`
                  : 'تعذّر التحقق من تحديث التطبيق'}
          </p>
          {checking && !downloading && !pending && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">جارٍ التحقق من وجود إصدار جديد...</p>
          )}
          {error && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{error}</p>}
          {!downloading && installHint && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{installHint}</p>
          )}
          {!error && !downloading && !pending && available && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
              يبدأ التنزيل داخل التطبيق مباشرة، ثم اضغط «تثبيت» لإتمام التحديث دون مغادرة التطبيق.
            </p>
          )}
        </div>
        <button type="button" onClick={() => setDismissed(true)} aria-label="إخفاء" className="text-gray-500">×</button>
      </div>

      {downloading ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-primary-100 dark:bg-primary-800">
            <div
              className={`h-full rounded-full bg-primary-600 transition-all ${percent === null ? 'animate-pulse' : ''}`}
              style={{ width: `${percent === null ? 35 : percent}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
            <span>{percent === null ? 'جارٍ التنزيل...' : `تم ${percent}%`}</span>
            <button type="button" onClick={() => void cancelDownload()} className="underline">إلغاء</button>
          </div>
        </div>
      ) : pending ? (
        <button
          type="button"
          onClick={() => void install()}
          className="mt-3 w-full rounded-xl bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white"
        >
          تثبيت التحديث {pending.version}
        </button>
      ) : available ? (
        <button
          type="button"
          onClick={() => void startDownload()}
          className="mt-3 w-full rounded-xl bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white"
        >
          تنزيل التحديث {available.version}
        </button>
      ) : null}

      {available && error && !downloading && !pending && (
        <button
          type="button"
          onClick={() => void openInBrowser()}
          className="mt-2 w-full text-xs text-gray-600 underline dark:text-gray-300"
        >
          تنزيل عبر المتصفح كبديل
        </button>
      )}
    </aside>
  );
}

function Application() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Could not restore Supabase session:', error.message);
      if (alive) {
        setSession(data.session);
        setAuthChecked(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthChecked(true);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (isSupabaseConfigured && !authChecked) {
    return <AppContent accountEmail={undefined} onSignOut={undefined} syncState={null} onSyncNow={undefined} />;
  }
  if (isSupabaseConfigured && !session) {
    return <AuthScreen onAuthenticated={() => {}} />;
  }
  if (isSupabaseConfigured && session) {
    return <AuthenticatedApp key={session.user.id} session={session} />;
  }
  return <AppContent accountEmail={undefined} onSignOut={undefined} syncState={null} onSyncNow={undefined} />;
}

function AuthenticatedApp({ session }: { session: Session }) {
  const [syncState, setSyncState] = useState<CloudSyncState>({
    status: 'syncing',
    lastSyncedAt: null,
    error: null,
  });

  useEffect(() => {
    let stopSync: (() => void) | undefined;
    void startCloudSync(session.user.id, setSyncState)
      .then((stop) => {
        stopSync = stop;
      })
      .catch((error: unknown) => {
        console.error('Cloud sync initial background error:', error);
      });
    return () => {
      stopSync?.();
    };
  }, [session.user.id]);

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    await synchronizeNow();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await clearLocalUserData();
  }, []);

  return (
    <AppContent
      accountEmail={session.user.email}
      onSignOut={handleSignOut}
      syncState={syncState}
      onSyncNow={() => synchronizeNow()}
    />
  );
}



/**
 * Shown when cloud sync is failing or the device is offline.
 *
 * Once the app stopped treating a failed first sync as fatal, a sync problem could
 * otherwise pass completely unnoticed — the only place sync status appeared was the
 * settings screen, so a user whose data had not reached the cloud would have no reason to
 * look. This says so plainly and says what is still true: everything works, and the
 * changes are waiting.
 */
function SyncNotice({
  syncState,
  onSyncNow,
}: {
  syncState: CloudSyncState | null;
  onSyncNow: (() => Promise<void>) | undefined;
}) {
  // Dismissal lasts for the session, the same as the update banner. Re-arming it on recovery
  // looked tidier but needed a 'synced' state to key off, and sync goes error → syncing →
  // error on every retry, so it re-armed mid-outage or not at all depending on whether a
  // given attempt finished. A notice the user has read once does not need to come back.
  const failing = syncState?.status === 'error' || syncState?.status === 'offline';
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (!failing || dismissed) return null;

  const offline = syncState?.status === 'offline';
  const retry = async () => {
    if (!onSyncNow) return;
    setRetrying(true);
    try {
      await onSyncNow();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-3 rounded-2xl border border-gold-300 bg-gold-50 p-3 text-sm dark:border-gold-700 dark:bg-primary-900"
      dir="rtl"
    >
      <CloudOff size={18} className="mt-0.5 shrink-0 text-gold-600 dark:text-gold-300" />
      <div className="flex-1">
        <p className="font-semibold text-primary-900 dark:text-primary-50">
          {offline ? 'لا يوجد اتصال بالإنترنت' : 'تعذّرت مزامنة بياناتك'}
        </p>
        <p className="mt-0.5 text-primary-800 dark:text-primary-100">
          {offline
            ? 'التطبيق يعمل ببياناته المحفوظة على الجهاز، وستُرفع تعديلاتك تلقائياً عند عودة الاتصال.'
            : 'التطبيق يعمل ببياناته المحفوظة على الجهاز، وتعديلاتك لم تُرفع بعد إلى حسابك.'}
        </p>
        {onSyncNow && (
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="mt-2 rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {retrying ? 'جارٍ المحاولة…' : 'حاول الآن'}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="إخفاء تنبيه المزامنة"
        className="shrink-0 rounded-lg p-1 text-primary-600 hover:bg-gold-100 dark:text-primary-200 dark:hover:bg-primary-800"
      >
        <X size={16} />
      </button>
    </div>
  );
}

function AppContent({
  accountEmail,
  onSignOut,
  syncState,
  onSyncNow,
}: {
  accountEmail: string | undefined;
  onSignOut: (() => Promise<void>) | undefined;
  syncState: CloudSyncState | null;
  onSyncNow: (() => Promise<void>) | undefined;
}) {
  const { settings, loading, error: settingsError, save, reload: reloadSettings } = useSettings();
  const { themeMode, changeTheme, colorPalette, changeColorPalette } = useTheme();
  const { screen, params, navigate, resetNonce, goBack } = useNavigation();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [syncRevision, setSyncRevision] = useState(0);
  const { azanState, closeAzan } = useAzanTrigger(settings);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || onboarded === null || !onboarded) return;

    let removeListener: (() => void) | undefined;
    const register = async () => {
      try {
        const handle = await CapApp.addListener('backButton', () => {
          if (screen === 'home') {
            void CapApp.exitApp();
            return;
          }
          goBack();
        });
        removeListener = () => { void handle.remove(); };
      } catch {
        // Native back-button support is optional on some devices/builds.
      }
    };

    void register();
    return () => removeListener?.();
  }, [goBack, onboarded, screen]);

  useEffect(() => {
    const onSyncComplete = () => {
      setSyncRevision((revision) => revision + 1);
      void reloadSettings();
    };
    window.addEventListener('zad:cloud-sync-complete', onSyncComplete);
    return () => window.removeEventListener('zad:cloud-sync-complete', onSyncComplete);
  }, [reloadSettings]);

  useEffect(() => {
    const flag = localStorage.getItem(ONBOARDED_KEY);
    setOnboarded(flag === 'true');
  }, []);

  // Generate daily tasks, mark missed ones, and reschedule notifications on app open
  useEffect(() => {
    if (settings) {
      generateDailyTasks();
      markMissedTasks();
      rescheduleAllNotifications();
    }
  }, [settings]);

  // Android drops pending alarms when the app is killed or the device reboots, and the
  // armed window is finite. Re-arming on every foreground keeps the schedule honest
  // instead of assuming it survived.
  useEffect(() => {
    let remove: (() => void) | undefined;

    if (Capacitor.isNativePlatform()) {
      CapApp.addListener('resume', () => {
        generateDailyTasks();
        markMissedTasks();
        rescheduleAllNotifications();
      }).then((handle) => {
        remove = () => { void handle.remove(); };
      }).catch(() => {
        // No plugin available (e.g. running the web build in a native shell) — the
        // open-time reschedule above still covers the common case.
      });
    }

    return () => remove?.();
  }, []);

  const handleOnboardComplete = useCallback(async (patch: Partial<Settings>) => {
    if (patch && Object.keys(patch).length > 0) {
      await save(patch);
    }
    localStorage.setItem(ONBOARDED_KEY, 'true');
    setOnboarded(true);
  }, [save]);

  if (loading || onboarded === null) {
    return (
      <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 overflow-hidden rounded-2xl shadow-lg animate-pulse-soft">
            <img src="/icon.svg" alt="Sakinah" className="h-full w-full" />
          </div>
          <p className="text-primary-600 dark:text-primary-300 text-sm">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center px-4" dir="rtl">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-error-200 bg-white p-6 text-center shadow-sm dark:border-error-800 dark:bg-primary-900">
          <h1 className="text-lg font-bold text-error-700 dark:text-error-300">تعذّر تحميل إعدادات التطبيق</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            تحقق من مساحة التخزين ثم أعد المحاولة. {settingsError}
          </p>
          <button
            type="button"
            onClick={() => { void reloadSettings(); }}
            className="mt-4 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (!onboarded && settings) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<ScreenLoading />}>
          <Onboarding settings={settings} onComplete={handleOnboardComplete} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!settings) return null;

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-surface-light dark:bg-surface-dark text-primary-900 dark:text-primary-50" dir="rtl">
        <main className="min-h-screen min-h-dvh px-4 pt-4 pb-24 md:pr-24 md:pl-8 md:pt-8 md:pb-8">
          <div className="w-full max-w-md mx-auto md:max-w-3xl xl:max-w-5xl 2xl:max-w-6xl">
            <SyncNotice syncState={syncState} onSyncNow={onSyncNow} />
            <Suspense fallback={<ScreenLoading />}>
              {/* Selecting the active tab again remounts its screen. */}
              {screen === 'home' && <HomeScreen key={`home-${resetNonce}`} settings={settings} navigate={navigate} />}
              {screen === 'quran' && <QuranScreen key={`quran-${resetNonce}`} settings={settings} />}
              {screen === 'planner' && <PlannerScreen key={`planner-${resetNonce}`} />}
              {screen === 'prayer' && <PrayerScreen key={`prayer-${resetNonce}`} settings={settings} onSaveSettings={save} />}
              {screen === 'hadith' && <HadithScreen key={`hadith-${resetNonce}`} params={params} />}
              {screen === 'progress' && <ProgressScreen key={`progress-${resetNonce}`} />}
              {screen === 'settings' && (
                <SettingsScreen
                  key={`settings-${resetNonce}-${syncRevision}`}
                  settings={settings}
                  onSaveSettings={save}
                  themeMode={themeMode}
                  onChangeTheme={changeTheme}
                  colorPalette={colorPalette}
                  onChangeColorPalette={changeColorPalette}
                  accountEmail={accountEmail}
                  syncState={syncState}
                  onSyncNow={onSyncNow}
                  onSignOut={onSignOut}
                />
              )}
              {screen === 'more' && <MoreScreen key={`more-${resetNonce}`} navigate={navigate} />}
              {screen === 'library' && <ContentLibrary key={`library-${resetNonce}`} />}
              {screen === 'adhkar' && <AdhkarScreen key={`adhkar-${resetNonce}`} />}
              {screen === 'tasbih' && <TasbihScreen key={`tasbih-${resetNonce}`} />}
            </Suspense>
          </div>
        </main>
        <BottomNav current={screen} onNavigate={navigate} />
        {settings && (
          <AzanOverlayModal
            isOpen={azanState.isOpen}
            prayerKey={azanState.prayerKey}
            prayerName={azanState.prayerName}
            prayerTime={azanState.prayerTime}
            settings={settings}
            isPreview={azanState.isPreview}
            fromNotification={azanState.fromNotification}
            onClose={closeAzan}
            onNavigateToAdhkar={() => navigate('adhkar')}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

function ScreenLoading() {
  return (
    <div className="flex min-h-48 items-center justify-center" role="status">
      <p className="text-sm text-primary-600 dark:text-primary-300">جارٍ تحميل الصفحة...</p>
    </div>
  );
}

export default App;
