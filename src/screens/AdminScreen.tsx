import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  Mail,
  Search,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserCheck,
  UserRound,
  Users,
} from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import {
  fetchAdminStats,
  fetchAdminUsers,
  AdminStatsError,
  AdminUsersError,
  type AdminStats,
  type AdminUserPage,
} from '@/utils/adminStats';

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

function formatDate(iso: string | null): string {
  if (!iso) return 'لم يسجّل دخولاً بعد';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function UserDirectory() {
  const [search, setSearch] = useState('');
  const [confirmedFilter, setConfirmedFilter] = useState<'all' | 'confirmed' | 'pending'>('all');
  const [sort, setSort] = useState<'created' | 'last_sign_in'>('created');
  const [page, setPage] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; result: AdminUserPage }
    | { status: 'error'; message: string; notAuthorized: boolean }
  >({ status: 'loading' });
  const pageSize = 25;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setState({ status: 'loading' });
      void fetchAdminUsers({
        search,
        confirmed: confirmedFilter === 'all' ? null : confirmedFilter === 'confirmed',
        sort,
        offset: page * pageSize,
        limit: pageSize,
      }).then((result) => {
        if (active) setState({ status: 'ready', result });
      }).catch((cause: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'تعذّر جلب قائمة المستخدمين.',
          notAuthorized: cause instanceof AdminUsersError && cause.notAuthorized,
        });
      });
    }, search ? 250 : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [confirmedFilter, page, reloadToken, search, sort]);

  const result = state.status === 'ready' ? state.result : null;
  const totalPages = result ? Math.ceil(result.total / pageSize) : 0;
  const firstUser = result && result.total > 0 ? page * pageSize + 1 : 0;
  const lastUser = result ? Math.min((page + 1) * pageSize, result.total) : 0;

  return (
    <Card className="mt-5 overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-primary-100 p-4 dark:border-primary-800 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
            <Users size={19} />
          </span>
          <div>
            <h2 className="text-base font-bold text-primary-900 dark:text-primary-50">دليل المستخدمين</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              بيانات الحسابات متاحة للأدمن المصرّح فقط
            </p>
          </div>
        </div>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400" aria-live="polite">
          {result ? `${formatCount(result.total)} حساب` : ' '}
        </span>
      </div>

      <div className="grid gap-2.5 border-b border-primary-100 p-4 dark:border-primary-800 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_12rem_13rem]">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="ابحث بالبريد الإلكتروني"
            aria-label="ابحث بالبريد الإلكتروني"
            className="min-h-11 w-full rounded-xl border border-primary-200 bg-white py-2 pe-9 ps-3 text-sm text-primary-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-50"
            dir="ltr"
          />
        </label>
        <label className="sr-only" htmlFor="admin-user-confirmation">حالة تأكيد البريد</label>
        <select
          id="admin-user-confirmation"
          value={confirmedFilter}
          onChange={(event) => {
            setConfirmedFilter(event.target.value as typeof confirmedFilter);
            setPage(0);
          }}
          className="min-h-11 rounded-xl border border-primary-200 bg-white px-3 text-sm text-primary-800 outline-none focus:border-primary-500 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        >
          <option value="all">كل الحسابات</option>
          <option value="confirmed">بريد مؤكد</option>
          <option value="pending">بانتظار التأكيد</option>
        </select>
        <label className="sr-only" htmlFor="admin-user-sort">ترتيب المستخدمين</label>
        <select
          id="admin-user-sort"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as typeof sort);
            setPage(0);
          }}
          className="min-h-11 rounded-xl border border-primary-200 bg-white px-3 text-sm text-primary-800 outline-none focus:border-primary-500 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        >
          <option value="created">الأحدث إنشاءً</option>
          <option value="last_sign_in">آخر دخول</option>
        </select>
      </div>

      {state.status === 'error' && (
        <div className="p-5 text-center" role="alert">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300">{state.message}</p>
          {!state.notAuthorized && (
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
              إعادة المحاولة
            </Button>
          )}
        </div>
      )}

      {state.status === 'loading' && (
        <div className="space-y-3 p-4" role="status" aria-label="جارٍ تحميل المستخدمين">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-xl bg-primary-50 dark:bg-primary-900/50" />
          ))}
        </div>
      )}

      {result && result.users.length === 0 && (
        <div className="px-4 py-12 text-center">
          <UserRound size={28} className="mx-auto text-gray-400" />
          <p className="mt-2 text-sm font-semibold text-primary-800 dark:text-primary-100">
            {search ? 'لا توجد حسابات تطابق البحث.' : 'لا توجد حسابات ضمن هذا الاختيار.'}
          </p>
        </div>
      )}

      {result && result.users.length > 0 && (
        <>
          <ul className="divide-y divide-primary-100 dark:divide-primary-800" aria-label="قائمة المستخدمين">
            {result.users.map((user) => {
              const isConfirmed = Boolean(user.emailConfirmedAt);
              return (
                <li key={user.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-primary-200">
                      <Mail size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="break-all text-sm font-semibold text-primary-900 dark:text-primary-50" dir="ltr">
                        {user.email ?? 'لا يوجد بريد إلكتروني'}
                      </p>
                      <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${
                        isConfirmed
                          ? 'bg-success-50 text-success-700 dark:bg-success-900/40 dark:text-success-200'
                          : 'bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-200'
                      }`}>
                        <ShieldCheck size={12} />
                        {isConfirmed ? 'بريد مؤكد' : 'بانتظار التأكيد'}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 ps-12 text-xs sm:min-w-64 sm:ps-0">
                    <div>
                      <span className="block text-gray-500 dark:text-gray-400">تاريخ التسجيل</span>
                      <span className="mt-1 block font-medium text-primary-800 dark:text-primary-100">
                        {formatDate(user.createdAt)}
                      </span>
                    </div>
                    <div>
                      <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                        <Clock3 size={12} /> آخر دخول
                      </span>
                      <span className="mt-1 block font-medium text-primary-800 dark:text-primary-100">
                        {formatDate(user.lastSignInAt)}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-primary-100 px-4 py-3 dark:border-primary-800">
            <p className="text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
              عرض {formatCount(firstUser)}–{formatCount(lastUser)} من {formatCount(result.total)}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="المستخدمون السابقون"
                disabled={page === 0 || state.status === 'loading'}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 disabled:opacity-40 dark:border-primary-800 dark:text-primary-200"
              >
                <ChevronRight size={17} />
              </button>
              <span className="min-w-16 text-center text-xs font-semibold text-primary-800 dark:text-primary-100">
                {formatCount(page + 1)} / {formatCount(Math.max(1, totalPages))}
              </span>
              <button
                type="button"
                aria-label="المستخدمون التاليون"
                disabled={!result || page + 1 >= totalPages || state.status === 'loading'}
                onClick={() => setPage((current) => current + 1)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary-200 text-primary-700 disabled:opacity-40 dark:border-primary-800 dark:text-primary-200"
              >
                <ChevronLeft size={17} />
              </button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
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
      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 pb-16 sm:px-6 sm:py-7">
        <header className="flex flex-col gap-4 rounded-3xl border border-primary-200/70 bg-panel p-4 shadow-sm dark:border-primary-800 dark:bg-raised sm:flex-row sm:items-center sm:justify-between sm:p-5 lg:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: 'var(--brand-gradient)' }}>
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-primary-900 dark:text-primary-50 sm:text-2xl">لوحة الإدارة</h1>
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[0.6875rem] font-bold text-primary-800 dark:bg-primary-800 dark:text-primary-100">
                  مركز التحكم
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-primary-700/80 dark:text-primary-300" dir="ltr">
                {accountEmail ?? ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
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
            <section aria-label="ملخص الاستخدام" className="grid grid-cols-2 gap-3 md:grid-cols-4">
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

            <section aria-label="نشاط التطبيق">
              <DailyChart daily={stats.daily} />
            </section>

            <p className="text-center text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">
              {stats.lastTrackedAt
                ? `آخر تسجيل لفتح تطبيق ${timeAgo(stats.lastTrackedAt)} • `
                : ''}
              تُحتسب زيارات «بدون حساب» بمعرّف عشوائي محفوظ على الجهاز فقط، دون أي بيانات شخصية.
              {stats.firstTrackedAt ? ` بدأ التتبع ${timeAgo(stats.firstTrackedAt)}.` : ''}
            </p>
            <UserDirectory />
          </>
        )}
      </main>
      {dialog}
    </div>
  );
}
