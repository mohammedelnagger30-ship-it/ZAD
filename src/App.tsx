import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
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

const ONBOARDED_KEY = 'hifzi-onboarded';

const HomeScreen = lazy(() => import('@/screens/HomeScreen').then((module) => ({ default: module.HomeScreen })));
const Onboarding = lazy(() => import('@/components/Onboarding').then((module) => ({ default: module.Onboarding })));
const QuranScreen = lazy(() => import('@/screens/QuranScreen').then((module) => ({ default: module.QuranScreen })));
const PlannerScreen = lazy(() => import('@/screens/PlannerScreen').then((module) => ({ default: module.PlannerScreen })));
const PrayerScreen = lazy(() => import('@/screens/PrayerScreen').then((module) => ({ default: module.PrayerScreen })));
const HadithScreen = lazy(() => import('@/screens/HadithScreen').then((module) => ({ default: module.HadithScreen })));
const ProgressScreen = lazy(() => import('@/screens/ProgressScreen').then((module) => ({ default: module.ProgressScreen })));
const SettingsScreen = lazy(() => import('@/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const MoreScreen = lazy(() => import('@/screens/MoreScreen').then((module) => ({ default: module.MoreScreen })));
const ContentLibrary = lazy(() => import('@/screens/ContentLibrary').then((module) => ({ default: module.ContentLibrary })));
const AdhkarScreen = lazy(() => import('@/screens/AdhkarScreen').then((module) => ({ default: module.AdhkarScreen })));
const TasbihScreen = lazy(() => import('@/screens/TasbihScreen').then((module) => ({ default: module.TasbihScreen })));

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
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Could not restore Supabase session:', error.message);
      if (alive) {
        setSession(data.session);
        setAuthLoading(false);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (isSupabaseConfigured && authLoading) {
    return <StartupMessage message="جارٍ التحقق من الحساب..." />;
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
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const [syncState, setSyncState] = useState<CloudSyncState>({
    status: 'syncing',
    lastSyncedAt: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let stopSync: (() => void) | undefined;
    setReady(false);
    setStartupError('');
    void startCloudSync(session.user.id, setSyncState)
      .then((stop) => {
        if (cancelled) stop();
        else {
          stopSync = stop;
          setReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStartupError(error instanceof Error ? error.message : 'تعذّرت مزامنة بيانات الحساب.');
        }
      });
    return () => {
      cancelled = true;
      stopSync?.();
    };
  }, [session.user.id, retryNonce]);

  const retrySync = useCallback(() => setRetryNonce((nonce) => nonce + 1), []);

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    await synchronizeNow();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await clearLocalUserData();
  }, []);

  if (startupError) {
    return (
      <StartupMessage
        message={`تعذّرت مزامنة الحساب: ${startupError}`}
        action={retrySync}
        actionLabel="إعادة المحاولة"
      />
    );
  }
  if (!ready) return <StartupMessage message="جارٍ تحميل بياناتك ومزامنتها..." />;
  return (
    <AppContent
      accountEmail={session.user.email}
      onSignOut={handleSignOut}
      syncState={syncState}
      onSyncNow={() => synchronizeNow()}
    />
  );
}

function StartupMessage({
  message,
  action,
  actionLabel,
}: {
  message: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center px-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-primary-100 bg-white p-6 text-center shadow-sm dark:border-primary-800 dark:bg-primary-900">
        <p role={action ? 'alert' : 'status'} className="text-sm text-primary-700 dark:text-primary-200">{message}</p>
        {action && (
          <button type="button" onClick={action} className="mt-4 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white">
            {actionLabel ?? 'إعادة المحاولة'}
          </button>
        )}
      </div>
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
  // notification window covers only today + tomorrow. Re-arming on every foreground
  // keeps the schedule honest instead of assuming it survived.
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
            <img src="/icon.svg" alt="Nour ZAD" className="h-full w-full" />
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
