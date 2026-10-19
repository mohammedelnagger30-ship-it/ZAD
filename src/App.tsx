import { lazy, Suspense, type ComponentType, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { CloudOff, X } from 'lucide-react';
import { useSettings, useTheme, useNavigation } from '@/hooks/useApp';
import { BottomNav } from '@/components/BottomNav';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AuthScreen } from '@/components/AuthScreen';
import { generateDailyTasks, markMissedTasks } from '@/utils/taskManager';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import { dismissTopOverlay } from '@/utils/overlayRegistry';
import { onClockChange, startClockService } from '@/utils/clock';
import {
  clearLocalUserData,
  startCloudSync,
  synchronizeNow,
  type CloudSyncState,
  type SignOutOptions,
  type SignOutResult,
} from '@/utils/cloudSync';
import { isSupabaseConfigured, supabase } from '@/utils/supabaseClient';
import { trackAppOpen } from '@/utils/analytics';
import { isAdminAccount } from '@/utils/adminStats';
import { applySystemFontScale } from '@/utils/displayScale';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Session } from '@supabase/supabase-js';
import type { Settings } from '@/db/database';
import { AzanOverlayModal } from '@/components/AzanOverlayModal';
import { RecitationPlayer } from '@/components/RecitationPlayer';
import { useRecitationVisible } from '@/hooks/useRecitation';
import { useAzanTrigger } from '@/hooks/useAzanTrigger';
import { useWirdWidget } from '@/hooks/useWirdWidget';
import {
  adoptDeviceTimeZone,
  currentDevicePosition,
  notifyTimeZoneAdoption,
  readDeviceTimeZone,
  readLastDeviceTimeZone,
  writeLastDeviceTimeZone,
  TIME_ZONE_ADOPTION_EVENT,
} from '@/utils/timeZoneTravel';
import { initAutoBackup } from '@/utils/autoBackup';
import { ensurePersistentStorage } from '@/utils/storagePersistence';
import { isEgyptianLocation } from '@/utils/prayerTimes';
import { getNotificationDestination } from '@/utils/notificationRouting';
import { DhikrReminderNotice } from '@/components/DhikrReminderNotice';

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
const PrayerGuideScreen = lazyWithRetry(() => import('@/screens/PrayerGuideScreen').then((module) => ({ default: module.PrayerGuideScreen })));
const HadithScreen = lazyWithRetry(() => import('@/screens/HadithScreen').then((module) => ({ default: module.HadithScreen })));
const SunnahScreen = lazyWithRetry(() => import('@/screens/SunnahScreen').then((module) => ({ default: module.default })));
const NawafilScreen = lazyWithRetry(() => import('@/screens/NawafilScreen').then((module) => ({ default: module.default })));
const ProgressScreen = lazyWithRetry(() => import('@/screens/ProgressScreen').then((module) => ({ default: module.ProgressScreen })));
const SettingsScreen = lazyWithRetry(() => import('@/screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })));
const MoreScreen = lazyWithRetry(() => import('@/screens/MoreScreen').then((module) => ({ default: module.MoreScreen })));
const ContentLibrary = lazyWithRetry(() => import('@/screens/ContentLibrary').then((module) => ({ default: module.ContentLibrary })));
const IqamahScreen = lazyWithRetry(() => import('@/screens/IqamahScreen').then((module) => ({ default: module.IqamahScreen })));
const AdhkarScreen = lazyWithRetry(() => import('@/screens/AdhkarScreen').then((module) => ({ default: module.AdhkarScreen })));
const TasbihScreen = lazyWithRetry(() => import('@/screens/TasbihScreen').then((module) => ({ default: module.TasbihScreen })));
const BookmarksScreen = lazyWithRetry(() => import('@/screens/BookmarksScreen').then((module) => ({ default: module.BookmarksScreen })));
const SearchScreen = lazyWithRetry(() => import('@/screens/SearchScreen').then((module) => ({ default: module.SearchScreen })));
// Only an allow-listed account ever mounts this, so it stays out of the first paint.
const AdminScreen = lazyWithRetry(() => import('@/components/AdminScreen').then((module) => ({ default: module.AdminScreen })));

function App() {
  return (
    <>
      <TimeZoneAdoptionNotice />
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
    <aside className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[100] mx-auto max-w-lg rounded-2xl border border-gold-300 bg-white p-4 shadow-xl dark:border-gold-600 dark:bg-primary-900 md:left-3 md:right-28 lg:right-36" dir="rtl">
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

/**
 * Said out loud when the app moves itself: a change the reader did not make by
 * hand must not pass unexplained — the times on screen just shifted because the
 * phone crossed into another zone. It informs and goes away on its own; there
 * is nothing here to approve.
 */
function TimeZoneAdoptionNotice() {
  const [cityName, setCityName] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAdopted = (event: Event) => {
      setCityName((event as CustomEvent<string>).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setCityName(null), 8000);
    };
    window.addEventListener(TIME_ZONE_ADOPTION_EVENT, onAdopted);
    return () => {
      window.removeEventListener(TIME_ZONE_ADOPTION_EVENT, onAdopted);
      clearTimeout(timer);
    };
  }, []);

  if (!cityName) return null;
  return (
    <aside
      className="fixed inset-x-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[90] mx-auto max-w-lg rounded-2xl border border-gold-300 bg-white p-4 shadow-xl dark:border-gold-600 dark:bg-primary-900 md:left-3 md:right-28 lg:right-36"
      dir="rtl"
    >
      <p className="text-sm text-primary-900 dark:text-primary-50">
        تغيّر توقيت الجهاز — المواقيت الآن في <span className="font-semibold">{cityName}</span>، وأُعيد جدولة التنبيهات على المواقيت الجديدة.
      </p>
    </aside>
  );
}

/**
 * The "use without an account" passage. Signing in is the only part of this app
 * that needs the network, so the gate may not be the only way in — otherwise a
 * first-time user offline would be locked out of an app that works entirely on
 * device. The choice is remembered across launches, yields the moment a real
 * session appears, and a deliberate sign-out clears it so the gate returns.
 */
const OFFLINE_USAGE_KEY = 'zad:offline-usage';

function readOfflineUsage(): boolean {
  try {
    return localStorage.getItem(OFFLINE_USAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function Application() {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(!isSupabaseConfigured);
  const [offlineUsage, setOfflineUsage] = useState(readOfflineUsage);
  // Opened from Settings → الحساب: the reader who walked in as a guest decides later
  // that they want their data on more than one device. Held here rather than in
  // Settings so a session appearing mid-sign-up swaps the whole view over, as at the gate.
  const [showAuthForGuest, setShowAuthForGuest] = useState(false);
  // 'unknown' until the allow-list has answered for this account — see below.
  const [adminState, setAdminState] = useState<'unknown' | 'admin' | 'user'>('unknown');
  // كل مستخدم — أدمن أو لا — يفتح التطبيق العادى، ولوحة الإدارة تُفتح بالطلب من
  // الإعدادات. الحالة هنا لا داخل `AdminApp`: زر «لوحة الإدارة» يصل إلى هذا المكوّن
  // من تحت، فلا بدّ أن يرفع الطلب إلى هذا المستوى ليُبدّل العرض.
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const sessionUserId = session?.user.id ?? null;

  // Report the open while the identity is settled: a guest counts under the
  // device's random id, an account under its own. Signing in mid-boot changes
  // the identity, so this effect re-runs and the account is counted too.
  useEffect(() => {
    void trackAppOpen(sessionUserId);
  }, [sessionUserId]);

  /**
   * Whether this account opens the dashboard or the ordinary app is decided
   * server-side by `public.admin_emails` — the client only ever learns a yes or
   * a no, and a project without the migration simply reports "no" and carries
   * on as the app it was.
   *
   * The answer is held as 'unknown' rather than guessed: an admin on a slow
   * link would otherwise flash the whole app before landing on the dashboard.
   */
  useEffect(() => {
    if (!sessionUserId) {
      setAdminState('unknown');
      return;
    }
    let alive = true;
    setAdminState('unknown');
    void isAdminAccount().then((isAdmin) => {
      if (alive) setAdminState(isAdmin ? 'admin' : 'user');
    });
    return () => {
      alive = false;
    };
  }, [sessionUserId]);

  useEffect(() => {
    if (session) {
      try {
        localStorage.removeItem(OFFLINE_USAGE_KEY);
      } catch {
        // Best-effort: a storage that refuses must not keep anything hidden.
      }
      setOfflineUsage(false);
    }
  }, [session]);

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
    // The session check reads local storage, so this is a beat, not a wait.
    // Mounting AppContent here — the whole shell, settings from IndexedDB and
    // navigation and the sync loop — and then mounting it again as
    // AuthenticatedApp ran every hook in it twice on every single launch, and
    // flashed the app under the gate while doing it. Holding here costs one
    // icon and one line of text.
    return <GateLoading message="جارٍ فحص الحساب..." />;
  }
  if (isSupabaseConfigured && session) {
    if (adminState === 'unknown') return <GateLoading message="جارٍ فتح الحساب..." />;
    // كل المستخدمين — כולל الأدمن — يفتحوا التطبيق العادى. صفحة الإدارة يمكن
    // فتحها من داخل التطبيق لو احتجنا لاحقًا، لكن مش تلقائياً عند تسجيل الدخول.
    // لوحة الإدارة لا تُفتح تلقائيًا عند تسجيل الدخول: كل الحسابات تدخل التطبيق
    // العادى. الرافع هنا هو هذا المستوى لأن زر «لوحة الإدارة» في الإعدادات يجلس
    // أسفل ثلاث طبقات من المكوّنات ولا يصل إلى هذا المكوّن مباشرة.
    if (adminState === 'admin' && showAdminDashboard) return <AdminApp session={session} />;
    return (
      <AuthenticatedApp
        key={session.user.id}
        session={session}
        onOpenAdmin={adminState === 'admin' ? () => setShowAdminDashboard(true) : undefined}
      />
    );
  }
  if (isSupabaseConfigured && !offlineUsage) {
    return (
      <AuthScreen
        onAuthenticated={() => {}}
        onContinueOffline={() => {
          try {
            localStorage.setItem(OFFLINE_USAGE_KEY, 'true');
          } catch {
            // Even without storage the passage still works for this session.
          }
          setOfflineUsage(true);
        }}
      />
    );
  }
  return (
    <>
      <AppContent
        accountEmail={undefined}
        onSignOut={undefined}
        syncState={null}
        onSyncNow={undefined}
        /* Without a backend there is nothing to sign up to, so the entry in Settings
           is simply not offered rather than failing when pressed. */
        onCreateAccount={isSupabaseConfigured ? () => setShowAuthForGuest(true) : undefined}
      />
      {/* An overlay, not a swap: Settings keeps its place underneath, so closing the
          form returns the reader to the screen they opened it from. */}
      {showAuthForGuest && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-surface-light dark:bg-surface-dark">
          <AuthScreen
            initialMode="sign-up"
            onAuthenticated={() => {
              // The listener above hands the session to `Application`, which re-renders
              // into the signed-in app; closing first keeps the form from lingering
              // over it for a beat. For an email-confirmation sign-up there is no
              // session yet, so this is what puts the reader back in the app until the
              // confirmation link arrives.
              setShowAuthForGuest(false);
            }}
            onClose={() => setShowAuthForGuest(false)}
            onContinueOffline={() => setShowAuthForGuest(false)}
          />
        </div>
      )}
    </>
  );
}

/** Full-screen holding state for the moment between a session and its view. */
function GateLoading({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto mb-4 overflow-hidden rounded-2xl shadow-lg animate-pulse-soft">
          <img src="/icon.svg" alt="قُرّة" className="h-full w-full" />
        </div>
        <p className="text-primary-600 dark:text-primary-300 text-sm">{message}</p>
      </div>
    </div>
  );
}

/**
 * Everything a signed-in session owes the device: the background sync loop and
 * a sign-out that uploads before it clears. Shared by the ordinary app and the
 * admin's "open the app" view — they are the same account either way.
 */
function useSessionSync(userId: string) {
  const [syncState, setSyncState] = useState<CloudSyncState>({
    status: 'syncing',
    lastSyncedAt: null,
    error: null,
  });

  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    void startCloudSync(userId, setSyncState)
      .then((stop) => {
        // `startCloudSync` holds the loop until its first round finishes, so this
        // can settle after the view is gone. Handing it back then would leave the
        // ref-count permanently one too high and the loop running for a session
        // nobody is watching.
        if (disposed) stop();
        else release = stop;
      })
      .catch((error: unknown) => {
        console.error('Cloud sync initial background error:', error);
      });
    return () => {
      disposed = true;
      release?.();
    };
  }, [userId]);

  const handleSignOut = useCallback(async (options?: SignOutOptions): Promise<SignOutResult> => {
    if (!supabase) return 'signed-out';
    // The dialog promises the data is uploaded before the local copy goes, so the
    // upload runs first — and a failure stops here rather than signing the reader out
    // behind their back. The rows are still on this device; the screen below decides
    // with them whether to continue without uploading.
    if (!options?.skipUpload) {
      try {
        await synchronizeNow();
      } catch (error) {
        console.error('Sign-out upload failed:', error);
        return 'upload-failed';
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    await clearLocalUserData();
    return 'signed-out';
  }, []);

  return { syncState, handleSignOut };
}

function AuthenticatedApp({ session, onOpenAdmin }: { session: Session; onOpenAdmin?: () => void }) {
  const { syncState, handleSignOut } = useSessionSync(session.user.id);

  return (
    <AppContent
      accountEmail={session.user.email}
      onSignOut={handleSignOut}
      syncState={syncState}
      onSyncNow={() => synchronizeNow()}
      onOpenAdmin={onOpenAdmin}
    />
  );
}

/**
 * The allow-listed account's two faces. It lands on the dashboard, and «فتح
 * التطبيق» puts it in the ordinary app — where Settings → الحساب offers a way
 * back, so no sign-out is needed to see the numbers again.
 */
function AdminApp({ session }: { session: Session }) {
  const [view, setView] = useState<'dashboard' | 'app'>('dashboard');
  // Sync starts here too, so «فتح التطبيق» opens onto an app already at work.
  const { handleSignOut } = useSessionSync(session.user.id);

  if (view === 'app') {
    return (
      <AuthenticatedApp
        key={`admin-app-${session.user.id}`}
        session={session}
        onOpenAdmin={() => setView('dashboard')}
      />
    );
  }

  return (
    <ErrorBoundary>
      <Suspense fallback={<GateLoading message="جارٍ فتح لوحة الإدارة..." />}>
        <AdminScreen
          accountEmail={session.user.email}
          onSignOut={handleSignOut}
          onOpenApp={() => setView('app')}
        />
      </Suspense>
    </ErrorBoundary>
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
  onOpenAdmin,
  onCreateAccount,
}: {
  accountEmail: string | undefined;
  onSignOut: ((options?: SignOutOptions) => Promise<SignOutResult>) | undefined;
  syncState: CloudSyncState | null;
  onSyncNow: (() => Promise<void>) | undefined;
  /** Only supplied for an allow-listed account — the way back to the dashboard. */
  onOpenAdmin?: (() => void) | undefined;
  /** Supplied only to a guest: the way from Settings to creating an account. */
  onCreateAccount?: (() => void) | undefined;
}) {
  const { settings, loading, error: settingsError, save, reload: reloadSettings } = useSettings();
  const { themeMode, changeTheme, colorPalette, changeColorPalette } = useTheme();
  const { screen, params, navigate, resetNonce, goBack } = useNavigation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const { azanState, closeAzan } = useAzanTrigger(settings);
  // A single boolean, so the engine's per-ayah patches while a surah sounds do not
  // re-render this component — only the bar appearing or going away does.
  const recitationVisible = useRecitationVisible();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let removeListener: (() => void) | undefined;
    void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
      const destination = getNotificationDestination(notification.extra);
      if (destination) navigateRef.current(destination.screen, destination.params);
    })
      .then((handle) => {
        if (disposed) void handle.remove();
        else removeListener = () => void handle.remove();
      })
      .catch((error: unknown) => {
        console.error('Could not register notification navigation listener:', error);
      });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || onboarded === null || !onboarded) return;

    let disposed = false;
    let removeListener: (() => void) | undefined;

    CapApp.addListener('backButton', () => {
      // An open overlay — the adhan page, a sheet, a dialog — takes the
      // press first; back during the adhan used to exit the app entirely,
      // silencing the call mid-flight.
      if (dismissTopOverlay()) return;
      if (screen === 'home') {
        void CapApp.exitApp();
        return;
      }
      goBack();
    })
      .then((handle) => {
        // The registration can settle after this effect was torn down — and this
        // effect re-runs on every navigation, so that is the common case, not a
        // rare one. A handle landing late still holds a live `goBack`; releasing
        // it at once keeps one leaked listener from jumping two screens per press.
        if (disposed) void handle.remove();
        else removeListener = () => void handle.remove();
      })
      .catch(() => {
        // Native back-button support is optional on some devices/builds.
      });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [goBack, onboarded, screen]);

  useEffect(() => {
    const onSyncComplete = () => {
      // Silent: a finished sync must refresh the settings in place, not bounce
      // the app back to its loading screen (scroll position, playing audio…).
      // The reload is what updates an open screen — the `settings` prop changes
      // and React re-renders it. It used to *also* bump a revision baked into
      // SettingsScreen's `key`, which remounted the screen on every finished
      // round: the scroll position went, and so did whatever the person was
      // midway through typing. Nothing in that screen is held in local state,
      // so the remount bought nothing but the loss.
      void reloadSettings({ silent: true });
    };
    window.addEventListener('zad:cloud-sync-complete', onSyncComplete);
    return () => window.removeEventListener('zad:cloud-sync-complete', onSyncComplete);
  }, [reloadSettings]);

  useEffect(() => {
    const flag = localStorage.getItem(ONBOARDED_KEY);
    setOnboarded(flag === 'true');
  }, []);

  // Keep time by the trusted clock — a phone whose clock the reader moved must
  // still show the city's prayer times and sound the adhan at the real instant.
  // The queue re-arms whenever the clock corrects itself: a jump the watchdog
  // catches against the monotonic anchor, or a network sync re-capturing it.
  useEffect(() => {
    startClockService();
    return onClockChange(() => {
      void rescheduleAllNotifications();
    });
  }, []);

  // Icon style rides on <html> exactly like the palette: index.css turns it into a
  // single stroke-width rule, so the choice repaints every Lucide glyph in the app —
  // no per-icon prop threading, and the default adds no rule at all.
  useEffect(() => {
    document.documentElement.dataset.iconStyle = settings?.iconStyle ?? 'lucide';
  }, [settings?.iconStyle]);

  // The text-scale hold, applied on every boot as well as on change: without the boot
  // application the app would open at the system's scale and only settle once Settings
  // was visited, which is the flash this switch exists to prevent.
  useEffect(() => {
    void applySystemFontScale(settings?.ignoreSystemFontScale === true);
  }, [settings?.ignoreSystemFontScale]);

  // Which settings actually change what is armed on the device. Everything else
  // (font size, palette, icon style, tips…) must not pay for a queue rebuild:
  // the effect below used to key on the whole settings object, so every slider
  // tick re-armed 7 days × 5 prayers and regenerated the day's tasks.
  const scheduleFingerprint = useMemo(() => {
    if (!settings) return '';
    return [
      settings.calcMethod,
      settings.asrMadhab,
      settings.locationMethod,
      settings.cityName,
      settings.latitude,
      settings.longitude,
      settings.prePrayerReminder,
      settings.snoozeMinutes,
      settings.adhanSound,
      settings.adhanVoiceId,
      // The iqamah's own sound rebuilds its channel (Android fixes a channel's sound
      // at creation), so the switch has to reach the scheduler as its own fingerprint
      // entry — the offsets above move *when* the alert rings, this one moves *what*.
      settings.iqamahSound,
      settings.notificationSound,
      settings.notificationVoiceId,
      settings.randomDhikrEnabled,
      settings.randomDhikrCategory,
      settings.randomDhikrIntervalMinutes,
      settings.randomDhikrStartTime,
      settings.randomDhikrEndTime,
      // The iqamah offsets move every iqamah alert; without them in the key,
      // editing a جماعة minute would not re-arm a single notification.
      JSON.stringify(settings.iqamahOffsets ?? null),
      // Mosque corrections move every prayer, iqamah and reminder alarm.
      JSON.stringify(settings.prayerTimeAdjustments ?? null),
    ].join('|');
  }, [settings]);

  // Generate daily tasks, mark missed ones, and reschedule notifications — but
  // only when the schedule-relevant settings change (including the first load:
  // the fingerprint goes from '' to its real value once settings arrive).
  useEffect(() => {
    if (!scheduleFingerprint) return;
    void (async () => {
      await generateDailyTasks();
      await markMissedTasks();
      await rescheduleAllNotifications();
    })();
    // Initialize auto-backup system (latched inside — runs once per session).
    initAutoBackup();
  }, [scheduleFingerprint]);

  // Egypt is the only prayer-time scope. A device-zone change can refresh an
  // automatically selected GPS position only if the fix remains inside Egypt;
  // otherwise the last saved Egyptian coordinates and Cairo timezone stay intact.
  useEffect(() => {
    if (!settings || !onboarded) return;

    let adopting = false;
    const adoptZone = () => {
      if (adopting) return;
      adopting = true;
      void adoptDeviceTimeZone(settings, readLastDeviceTimeZone(), readDeviceTimeZone(), {
        position: currentDevicePosition,
        save,
        writePreviousZone: writeLastDeviceTimeZone,
        notify: notifyTimeZoneAdoption,
      })
        .catch(() => {
          // A failed save keeps the old baseline, so the next check retries it
          // instead of the trip being lost.
        })
        .finally(() => {
          adopting = false;
        });
    };

    adoptZone();
    const onVisible = () => {
      if (document.visibilityState === 'visible') adoptZone();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(adoptZone, 10 * 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [settings, onboarded, save]);

  // Auto mode refreshes GPS while the app is in use, but only accepts fixes inside
  // Egypt. Settings are persisted locally, so a later offline launch continues from
  // the last accepted fix and never waits for a network location service.
  const autoLocationMethod = settings?.locationMethod;
  const savedLatitude = settings?.latitude;
  const savedLongitude = settings?.longitude;
  const savedCityName = settings?.cityName;
  const savedTimeZone = settings?.timeZone;

  useEffect(() => {
    if (autoLocationMethod !== 'auto') return;
    const geolocation = globalThis.navigator?.geolocation;
    if (!geolocation) return;

    let active = true;
    let requesting = false;
    const refreshEgyptLocation = () => {
      if (requesting || document.visibilityState === 'hidden') return;
      requesting = true;
      geolocation.getCurrentPosition(
        ({ coords }) => {
          requesting = false;
          if (!active || !isEgyptianLocation(coords.latitude, coords.longitude)) return;

          const latDelta = (coords.latitude - (savedLatitude ?? 0)) * 111_000;
          const lngDelta = (coords.longitude - (savedLongitude ?? 0)) *
            111_000 * Math.cos((coords.latitude * Math.PI) / 180);
          const movedMeters = Math.hypot(latDelta, lngDelta);
          if (
            movedMeters < 250 &&
            savedCityName === 'موقعي داخل مصر' &&
            savedTimeZone === 'Africa/Cairo'
          ) return;

          void save({
            latitude: coords.latitude,
            longitude: coords.longitude,
            cityName: 'موقعي داخل مصر',
            timeZone: 'Africa/Cairo',
            locationMethod: 'auto',
          }).catch((error: unknown) => {
            console.error('تعذّر حفظ آخر موقع مصري للمواقيت.', error);
          });
        },
        () => {
          requesting = false;
        },
        { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
      );
    };

    refreshEgyptLocation();
    document.addEventListener('visibilitychange', refreshEgyptLocation);
    const interval = setInterval(refreshEgyptLocation, 10 * 60_000);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', refreshEgyptLocation);
      clearInterval(interval);
    };
  }, [
    autoLocationMethod,
    savedLatitude,
    savedLongitude,
    savedCityName,
    savedTimeZone,
    save,
  ]);

  // The launcher's widget is drawn from the last snapshot the app left behind,
  // so it is refreshed here rather than on any task toggle: at the settings
  // change that moves the prayers, and whenever the person stops looking.
  useWirdWidget(settings);

  // Android drops pending alarms when the app is killed or the device reboots, and the
  // armed window is finite. Re-arming on every foreground keeps the schedule honest
  // instead of assuming it survived.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let remove: (() => void) | undefined;

    CapApp.addListener('resume', () => {
      void (async () => {
        await generateDailyTasks();
        await markMissedTasks();
        await rescheduleAllNotifications();
      })();
    })
      .then((handle) => {
        if (disposed) void handle.remove();
        else remove = () => void handle.remove();
      })
      .catch(() => {
        // No plugin available (e.g. running the web build in a native shell) — the
        // open-time reschedule above still covers the common case.
      });

    return () => {
      disposed = true;
      remove?.();
    };
  }, []);

  const handleOnboardComplete = useCallback(async (patch: Partial<Settings>) => {
    if (patch && Object.keys(patch).length > 0) {
      await save(patch);
    }
    localStorage.setItem(ONBOARDED_KEY, 'true');
    setOnboarded(true);
    // The second attempt at the persist mark, and the one that counts: a cold-start
    // request on a brand-new install is often declined for lack of engagement, while
    // finishing this setup is the first real interaction the browser has seen. Silent
    // either way — see storagePersistence.ts.
    void ensurePersistentStorage();
    // The first session's own arming moment. The open-time attempt above ran
    // *before* the permission existed (onboarding asks for it mid-flow), and the
    // settings fingerprint need not move at all — keeping the default city
    // changes nothing in it — so nothing would arm the adhan until the next
    // app open. The permission is granted by now; arm the queue here.
    void rescheduleAllNotifications();
  }, [save]);

  if (loading || onboarded === null) {
    return (
      <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 overflow-hidden rounded-2xl shadow-lg animate-pulse-soft">
            <img src="/icon.svg" alt="قُرّة" className="h-full w-full" />
          </div>
          <p className="text-primary-600 dark:text-primary-300 text-sm">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="min-h-screen bg-surface-light dark:bg-surface-dark flex items-center justify-center px-4" dir="rtl">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-error-200 bg-white p-6 text-center shadow-xs dark:border-error-800 dark:bg-primary-900">
          <h1 className="text-lg font-bold text-error-700 dark:text-error-300">تعذّر تحميل إعدادات التطبيق</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            تحقق من مساحة التخزين ثم أعد المحاولة. {settingsError}
          </p>
          <button
            type="button"
            onClick={() => { void reloadSettings(); }}
            className="mt-4 rounded-xl bg-primary-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-800 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
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
        <main className={`min-h-screen min-h-dvh px-4 pt-4 sm:px-6 md:pr-24 md:pl-8 md:pt-8 lg:pr-32 xl:pr-36 ${
          /* Room for the tab bar — plus, on mobile, the recitation's mini bar stacked
             on top of it; on desktop the mini bar floats near the bottom instead, so it
             gets its own clearance rather than the tab bar's. Without this the last row
             of a list sits under the player forever. */
          recitationVisible ? 'pb-[9.5rem] md:pb-28' : 'pb-24 md:pb-8'
        }`}>
          <div className="w-full max-w-md mx-auto sm:max-w-xl md:max-w-3xl lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
            <SyncNotice syncState={syncState} onSyncNow={onSyncNow} />
            {/* Hidden while the reader is on Settings: the very switch this points at is
                already on that screen, so repeating the pitch there would be noise. */}
            <DhikrReminderNotice
              settings={settings}
              onSaveSettings={save}
              navigate={navigate}
              hidden={screen === 'settings'}
            />
            <Suspense fallback={<ScreenLoading />}>
              {/* Selecting the active tab again remounts its screen. */}
              {screen === 'home' && <HomeScreen key={`home-${resetNonce}`} settings={settings} navigate={navigate} />}
              {screen === 'quran' && <QuranScreen key={`quran-${resetNonce}`} settings={settings} params={params} />}
              {screen === 'planner' && <PlannerScreen key={`planner-${resetNonce}`} navigate={navigate} />}
              {screen === 'prayer' && <PrayerScreen key={`prayer-${resetNonce}`} settings={settings} onSaveSettings={save} navigate={navigate} params={params} />}
              {screen === 'salah' && <PrayerGuideScreen key={`salah-${resetNonce}`} navigate={navigate} />}
              {screen === 'hadith' && <HadithScreen key={`hadith-${resetNonce}`} params={params} />}
              {screen === 'sunnah' && <SunnahScreen key={`sunnah-${resetNonce}`} navigate={navigate} />}
              {screen === 'nawafil' && <NawafilScreen key={`nawafil-${resetNonce}`} settings={settings} />}
              {screen === 'progress' && <ProgressScreen key={`progress-${resetNonce}`} settings={settings} />}
              {/* Selecting the active tab again remounts its screen. A cloud
                  sync does not: it reloads settings, which re-render — the
                  key stays put so the person keeps their scroll and their
                  half-typed input. */}
              {screen === 'settings' && (
                <SettingsScreen
                  key={`settings-${resetNonce}`}
                  settings={settings}
                  onSaveSettings={save}
                  params={params}
                  themeMode={themeMode}
                  onChangeTheme={changeTheme}
                  colorPalette={colorPalette}
                  onChangeColorPalette={changeColorPalette}
                  accountEmail={accountEmail}
                  syncState={syncState}
                  onSyncNow={onSyncNow}
                  onSignOut={onSignOut}
                  onOpenAdmin={onOpenAdmin}
                  onCreateAccount={onCreateAccount}
                  navigate={navigate}
                />
              )}
              {screen === 'more' && <MoreScreen key={`more-${resetNonce}`} navigate={navigate} />}
              {screen === 'library' && (
                <ContentLibrary
                  key={`library-${resetNonce}`}
                  initialSection={
                    params.section === 'tafsir' ||
                    params.section === 'hadith' ||
                    params.section === 'meanings' ||
                    params.section === 'audio'
                      ? params.section
                      : 'audio'
                  }
                />
              )}
              {screen === 'adhkar' && <AdhkarScreen key={`adhkar-${resetNonce}`} params={params} />}
              {screen === 'tasbih' && <TasbihScreen key={`tasbih-${resetNonce}`} params={params} />}
              {screen === 'bookmarks' && <BookmarksScreen key={`bookmarks-${resetNonce}`} navigate={navigate} />}
              {screen === 'search' && <SearchScreen key={`search-${resetNonce}`} navigate={navigate} />}
              {screen === 'iqamah' && (
                <IqamahScreen
                  key={`iqamah-${resetNonce}`}
                  settings={settings}
                  onSaveSettings={save}
                  onClose={() => navigate('settings')}
                />
              )}
            </Suspense>
          </div>
        </main>
        <BottomNav current={screen} onNavigate={navigate} />
        {/* The recitation, wherever the listener is in the app — dormant until one is
            actually playing. */}
        <RecitationPlayer />
        {settings && (
          <AzanOverlayModal
            isOpen={azanState.isOpen}
            mode={azanState.mode}
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
