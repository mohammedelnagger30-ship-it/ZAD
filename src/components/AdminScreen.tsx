import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  CalendarPlus,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Users,
} from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { fetchAdminStats, AdminStatsError, type AdminStats } from '@/utils/adminStats';

interface AdminScreenProps {
  /** The allow-listed account that opened this dashboard. */
  accountEmail?: string;
  onSignOut: () => Promise<void>;
  /** Leave the dashboard for the ordinary app; AccountSection comes back here. */
  onOpenApp: () => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; stats: AdminStats }
  | { status: 'error'; message: string; notAuthorized: boolean };

function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** "منذ ٣ دقائق" — a dashboard's timestamp nobody has to decode. */
function timeAgo(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  return `منذ ${days} يوم`;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Card className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-gold-400">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[0.6875rem] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
        <span className="mt-0.5 block text-2xl font-extrabold text-primary-900 dark:text-primary-50" dir="ltr">
          {formatCount(value)}
        </span>
        {hint && <span className="mt-0.5 block text-[0.6875rem] text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </Card>
  );
}

/** Fourteen days of two counts, drawn rather than tabulated. */
function DailyChart({ daily }: { daily: AdminStats['daily'] }) {
  if (daily.length === 0) return null;
  const peak = Math.max(1, ...daily.map((entry) => Math.max(entry.users, entry.guests)));

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-primary-900 dark:text-primary-50">آخر 14 يوم</h2>
        <div className="flex items-center gap-3 text-[0.6875rem] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-primary-600" /> حسابات
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-gold-400" /> بدون حساب
          </span>
        </div>
      </div>

      <div
        role="img"
        aria-label="عدد الحسابات النشطة والأجهزة بدون حساب يومياً خلال آخر 14 يوماً"
        className="mt-4 flex h-36 items-end gap-1"
        dir="ltr"
      >
        {daily.map((entry) => (
          <div key={entry.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div className="flex h-full w-full items-end justify-center gap-[2px]">
              <div
                className="w-1/2 rounded-t-sm bg-primary-600 transition-all"
                style={{ height: `${(entry.users / peak) * 100}%` }}
                title={`${entry.day} — حسابات: ${entry.users}`}
              />
              <div
                className="w-1/2 rounded-t-sm bg-gold-400 transition-all"
                style={{ height: `${(entry.guests / peak) * 100}%` }}
                title={`${entry.day} — بدون حساب: ${entry.guests}`}
              />
            </div>
            <span className="text-[0.5625rem] text-gray-400 dark:text-gray-500">{entry.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function AdminScreen({ accountEmail, onSignOut, onOpenApp }: AdminScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setState({ status: 'loading' });
    try {
      const stats = await fetchAdminStats();
      if (alive.current) setState({ status: 'ready', stats });
    } catch (cause) {
      if (!alive.current) return;
      setState({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'تعذّر جلب الإحصائيات.',
        notAuthorized: cause instanceof AdminStatsError && cause.notAuthorized,
      });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load(true);
    // A dashboard that is left open should not go stale: refetch quietly once a
    // minute, and immediately whenever the window comes back into view.
    const interval = window.setInterval(() => void load(false), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const handleSignOut = async () => {
    const proceed = await confirm({
      title: 'تسجيل الخروج',
      description: 'سيتم تسجيل الخروج من لوحة الإدارة على هذا الجهاز.',
      confirmLabel: 'تسجيل الخروج',
      destructive: true,
    });
    if (!proceed) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  const stats = state.status === 'ready' ? state.stats : null;

  return (
    <div className="min-h-screen min-h-dvh bg-surface-light dark:bg-surface-dark" dir="rtl">
      <main className="mx-auto w-full max-w-4xl px-4 py-6 pb-16 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary-200/70 bg-white p-4 shadow-sm dark:border-primary-800 dark:bg-primary-900/50">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-tr from-primary-700 to-primary-600 text-gold-300 shadow-md">
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-primary-900 dark:text-primary-50">لوحة الإدارة</h1>
              <p className="truncate text-xs text-primary-700/80 dark:text-primary-300" dir="ltr">
                {accountEmail ?? ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={state.status === 'loading'}
              onClick={() => void load(true)}
            >
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={14} className={state.status === 'loading' ? 'animate-spin' : ''} /> تحديث
              </span>
            </Button>
            <Button variant="secondary" size="sm" onClick={onOpenApp}>
              <span className="inline-flex items-center gap-1.5">
                <AppWindow size={14} /> فتح التطبيق
              </span>
            </Button>
            <Button variant="error" size="sm" disabled={signingOut} onClick={() => void handleSignOut()}>
              <span className="inline-flex items-center gap-1.5">
                <LogOut size={14} /> خروج
              </span>
            </Button>
          </div>
        </header>

        {state.status === 'error' && (
          <Card className="mt-4 border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/40">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300" role="alert">
              {state.message}
            </p>
            {!state.notAuthorized && (
              <Button className="mt-3" variant="secondary" size="sm" onClick={() => void load(true)}>
                إعادة المحاولة
              </Button>
            )}
          </Card>
        )}

        {state.status === 'loading' && !stats && (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-2xl border border-primary-100 bg-white dark:border-primary-800 dark:bg-primary-900/40"
              />
            ))}
          </div>
        )}

        {stats && (
          <>
            <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                icon={<Users size={18} />}
                label="إجمالي المستخدمين"
                value={stats.totalUsers}
                hint={`${formatCount(stats.usersCreated7d)} جديد هذا الأسبوع`}
              />
              <StatCard
                icon={<CalendarPlus size={18} />}
                label="حسابات جديدة — 7 أيام"
                value={stats.usersCreated7d}
                hint={`آخر 30 يوماً: ${formatCount(stats.usersCreated30d)}`}
              />
              <StatCard
                icon={<UserCheck size={18} />}
                label="نشطون — 7 أيام"
                value={stats.activeUsers7d}
                hint={`آخر 30 يوماً: ${formatCount(stats.activeUsers30d)}`}
              />
              <StatCard
                icon={<Smartphone size={18} />}
                label="دخول بدون حساب"
                value={stats.guestDevicesTotal}
                hint="أجهزة مجهولة الهوية"
              />
              <StatCard
                icon={<Smartphone size={18} />}
                label="بدون حساب — 7 أيام"
                value={stats.guestDevices7d}
                hint="أجهزة فتحت التطبيق"
              />
              <StatCard
                icon={<UserCheck size={18} />}
                label="نشطون — 30 يوماً"
                value={stats.activeUsers30d}
                hint="حسابات فتحت التطبيق"
              />
              <StatCard
                icon={<Activity size={18} />}
                label="فتحات بدون حساب — 7 أيام"
                value={stats.guestOpens7d}
              />
              <StatCard
                icon={<Activity size={18} />}
                label="فتحات التطبيق — 7 أيام"
                value={stats.appOpens7d}
                hint={`منها ${formatCount(stats.appOpens7d - stats.guestOpens7d)} بحسابات مسجّلة`}
              />
            </section>

            <section className="mt-4">
              <DailyChart daily={stats.daily} />
            </section>

            <p className="mt-4 text-center text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">
              {stats.lastTrackedAt
                ? `آخر تسجيل لفتح تطبيق ${timeAgo(stats.lastTrackedAt)} • `
                : ''}
              تُحتسب زيارات «بدون حساب» بمعرّف عشوائي محفوظ على الجهاز فقط، دون أي بيانات شخصية.
              {stats.firstTrackedAt ? ` بدأ التتبع ${timeAgo(stats.firstTrackedAt)}.` : ''}
            </p>
          </>
        )}
      </main>
      {dialog}
    </div>
  );
}
