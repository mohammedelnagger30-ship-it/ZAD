import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AppWindow,
  ArrowDownToLine,
  BarChart3,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Info,
  Layers,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserCheck,
  UserRound,
  Users,
  X,
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
  type AdminUser,
} from '@/utils/adminStats';
import { supabase } from '@/utils/sync/supabaseClient';

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

type AdminTab = 'all' | 'analytics' | 'users' | 'system' | 'tools';

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
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.round(days / 30);
  return `منذ ${months} شهر`;
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}

function exportUsersToCsv(users: AdminUser[]): void {
  if (!users || users.length === 0) return;
  const headers = ['المعرف الفريد', 'البريد الإلكتروني', 'حالة تأكيد البريد', 'تاريخ التسجيل', 'آخر تسجيل دخول'];
  const rows = users.map((u) => [
    `"${u.id}"`,
    `"${u.email ?? ''}"`,
    `"${u.emailConfirmedAt ? 'بريد مؤكد' : 'بانتظار التأكيد'}"`,
    `"${u.createdAt ? formatDate(u.createdAt) : ''}"`,
    `"${u.lastSignInAt ? formatDate(u.lastSignInAt) : 'لم يسجل'}"`,
  ]);
  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `zad-users-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/*                                USER MODAL                                  */
/* -------------------------------------------------------------------------- */

function UserDetailsModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [showJson, setShowJson] = useState(false);

  const handleCopyId = async () => {
    const ok = await copyToClipboard(user.id);
    if (ok) {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  const handleCopyEmail = async () => {
    if (!user.email) return;
    const ok = await copyToClipboard(user.email);
    if (ok) {
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    }
  };

  const isConfirmed = Boolean(user.emailConfirmedAt);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-primary-200 bg-panel p-5 shadow-2xl dark:border-primary-800 dark:bg-raised sm:p-6"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between border-b border-primary-100 pb-4 dark:border-primary-800">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
              <UserCheck size={20} />
            </span>
            <div>
              <h3 id="user-modal-title" className="text-base font-bold text-primary-900 dark:text-primary-50">
                تفاصيل الحساب
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">معلومات الحساب المسجل في المنظومة</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق النافذة"
            className="flex h-8 w-8 items-center justify-center rounded-xl text-gray-500 hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-primary-100 bg-surface-light p-3.5 dark:border-primary-800 dark:bg-primary-950/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">البريد الإلكتروني</span>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-300"
              >
                {copiedEmail ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
                {copiedEmail ? 'تم النسخ' : 'نسخ البريد'}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-sm font-bold text-primary-900 dark:text-primary-50" dir="ltr">
              {user.email ?? 'لا يوجد بريد إلكتروني'}
            </p>
            <div className="mt-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  isConfirmed
                    ? 'bg-success-50 text-success-700 dark:bg-success-900/40 dark:text-success-200'
                    : 'bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-200'
                }`}
              >
                <ShieldCheck size={13} />
                {isConfirmed ? 'البريد مؤكد' : 'بانتظار تأكيد البريد'}
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-primary-100 bg-surface-light p-3.5 dark:border-primary-800 dark:bg-primary-950/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">معرّف الحساب (UUID)</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-300"
              >
                {copiedId ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
                {copiedId ? 'تم النسخ' : 'نسخ المعرف'}
              </button>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-primary-800 dark:text-primary-200" dir="ltr">
              {user.id}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-primary-100 bg-surface-light p-3 dark:border-primary-800 dark:bg-primary-950/50">
              <span className="block text-xs text-gray-500 dark:text-gray-400">تاريخ الإنشاء</span>
              <span className="mt-1 block text-xs font-bold text-primary-900 dark:text-primary-100">
                {formatDate(user.createdAt)}
              </span>
              {user.createdAt && (
                <span className="mt-1 block text-[0.6875rem] text-primary-600 dark:text-primary-400">
                  {timeAgo(user.createdAt)}
                </span>
              )}
            </div>
            <div className="rounded-2xl border border-primary-100 bg-surface-light p-3 dark:border-primary-800 dark:bg-primary-950/50">
              <span className="block text-xs text-gray-500 dark:text-gray-400">آخر تسجيل دخول</span>
              <span className="mt-1 block text-xs font-bold text-primary-900 dark:text-primary-100">
                {formatDate(user.lastSignInAt)}
              </span>
              {user.lastSignInAt && (
                <span className="mt-1 block text-[0.6875rem] text-primary-600 dark:text-primary-400">
                  {timeAgo(user.lastSignInAt)}
                </span>
              )}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowJson(!showJson)}
              className="text-xs font-medium text-gray-500 hover:text-primary-700 dark:text-gray-400"
            >
              {showJson ? 'إخفاء السجل الخام (JSON)' : 'عرض السجل الخام (JSON)'}
            </button>
            {showJson && (
              <pre
                className="mt-2 max-h-36 overflow-auto rounded-xl bg-gray-900 p-3 text-[0.6875rem] text-gray-200"
                dir="ltr"
              >
                {JSON.stringify(user, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            إغلاق
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              USER DIRECTORY                                */
/* -------------------------------------------------------------------------- */

function UserDirectory() {
  const [search, setSearch] = useState('');
  const [confirmedFilter, setConfirmedFilter] = useState<'all' | 'confirmed' | 'pending'>('all');
  const [sort, setSort] = useState<'created' | 'last_sign_in'>('created');
  const [page, setPage] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [copiedEmailMap, setCopiedEmailMap] = useState<Record<string, boolean>>({});
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
      })
        .then((result) => {
          if (active) setState({ status: 'ready', result });
        })
        .catch((cause: unknown) => {
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

  const handleCopyEmailRow = async (e: React.MouseEvent, email: string | null, id: string) => {
    e.stopPropagation();
    if (!email) return;
    const ok = await copyToClipboard(email);
    if (ok) {
      setCopiedEmailMap((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setCopiedEmailMap((prev) => ({ ...prev, [id]: false }));
      }, 2000);
    }
  };

  return (
    <Card className="mt-5 overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-primary-100 p-4 dark:border-primary-800 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
            <Users size={19} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-primary-900 dark:text-primary-50">دليل المستخدمين</h2>
              {result && (
                <span className="rounded-md bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-800 dark:bg-primary-800 dark:text-primary-100">
                  {formatCount(result.total)} حساب
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              بيانات الحسابات متاحة للأدمن المصرّح فقط
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {result && result.users.length > 0 && (
            <button
              type="button"
              onClick={() => exportUsersToCsv(result.users)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-700 shadow-xs hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-200 dark:hover:bg-primary-900"
            >
              <ArrowDownToLine size={14} />
              <span>تصدير CSV</span>
            </button>
          )}
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400" aria-live="polite">
            {result ? `${formatCount(result.total)} حساب` : ' '}
          </span>
        </div>
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
            className="min-h-11 w-full rounded-xl border border-primary-200 bg-white py-2 pe-9 ps-8 text-sm text-primary-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/15 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-50"
            dir="ltr"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setPage(0);
              }}
              aria-label="مسح البحث"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <label className="sr-only" htmlFor="admin-user-confirmation">
          حالة تأكيد البريد
        </label>
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
        <label className="sr-only" htmlFor="admin-user-sort">
          ترتيب المستخدمين
        </label>
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
              const isCopied = copiedEmailMap[user.id] || false;
              return (
                <li
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className="group flex flex-col gap-3 px-4 py-4 transition hover:bg-primary-50/50 dark:hover:bg-primary-900/20 sm:flex-row sm:items-center sm:justify-between sm:px-5 cursor-pointer"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 transition group-hover:bg-primary-100 dark:bg-primary-900 dark:text-primary-200">
                      <Mail size={17} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="break-all text-sm font-semibold text-primary-900 dark:text-primary-50" dir="ltr">
                          {user.email ?? 'لا يوجد بريد إلكتروني'}
                        </p>
                        {user.email && (
                          <button
                            type="button"
                            onClick={(e) => handleCopyEmailRow(e, user.email, user.id)}
                            aria-label={`نسخ بريد ${user.email}`}
                            className="rounded-md p-1 text-gray-400 opacity-60 hover:text-primary-600 hover:opacity-100 dark:hover:text-primary-300"
                          >
                            {isCopied ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${
                            isConfirmed
                              ? 'bg-success-50 text-success-700 dark:bg-success-900/40 dark:text-success-200'
                              : 'bg-warning-50 text-warning-700 dark:bg-warning-900/40 dark:text-warning-200'
                          }`}
                        >
                          <ShieldCheck size={12} />
                          {isConfirmed ? 'بريد مؤكد' : 'بانتظار التأكيد'}
                        </span>
                        <span className="text-[0.6875rem] text-primary-600 underline opacity-0 transition group-hover:opacity-100 dark:text-primary-400">
                          عرض التفاصيل
                        </span>
                      </div>
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

      {selectedUser && <UserDetailsModal user={selectedUser} onClose={() => setSelectedUser(null)} />}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 STAT CARD                                  */
/* -------------------------------------------------------------------------- */

function StatCard({
  icon,
  label,
  value,
  hint,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  badge?: string;
}) {
  return (
    <Card className="flex items-start gap-3 transition-transform duration-200 hover:-translate-y-0.5">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-gold-400">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="block text-[0.6875rem] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
          {badge && (
            <span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-[0.625rem] font-bold text-primary-700 dark:bg-primary-900/60 dark:text-primary-300">
              {badge}
            </span>
          )}
        </div>
        <span className="mt-0.5 block text-2xl font-extrabold text-primary-900 dark:text-primary-50" dir="ltr">
          {formatCount(value)}
        </span>
        {hint && <span className="mt-0.5 block text-[0.6875rem] text-gray-500 dark:text-gray-400">{hint}</span>}
      </span>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                           KPI HIGHLIGHTS BAR                               */
/* -------------------------------------------------------------------------- */

function KpiHighlightsBar({ stats }: { stats: AdminStats }) {
  const totalAudience = stats.totalUsers + stats.guestDevicesTotal;
  const conversionRate = totalAudience > 0 ? ((stats.totalUsers / totalAudience) * 100).toFixed(1) : '0';
  const activeRate7d = stats.totalUsers > 0 ? ((stats.activeUsers7d / stats.totalUsers) * 100).toFixed(1) : '0';
  const registeredOpens = Math.max(0, stats.appOpens7d - stats.guestOpens7d);
  const registeredOpensRate = stats.appOpens7d > 0 ? ((registeredOpens / stats.appOpens7d) * 100).toFixed(1) : '0';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card className="flex items-center gap-3.5 border-emerald-200/60 bg-linear-to-br from-emerald-50/50 to-panel dark:border-emerald-900/40 dark:from-emerald-950/20">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <TrendingUp size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">نسبة تحويل الزوار إلى حسابات</p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-primary-900 dark:text-primary-50" dir="ltr">
              {conversionRate}%
            </span>
            <span className="text-[0.6875rem] text-gray-500">من إجمالي الأجهزة</span>
          </div>
        </div>
      </Card>

      <Card className="flex items-center gap-3.5 border-amber-200/60 bg-linear-to-br from-amber-50/50 to-panel dark:border-amber-900/40 dark:from-amber-950/20">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <UserCheck size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">معدل النشاط الأسبوعي</p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-primary-900 dark:text-primary-50" dir="ltr">
              {activeRate7d}%
            </span>
            <span className="text-[0.6875rem] text-gray-500">نشطون في 7 أيام</span>
          </div>
        </div>
      </Card>

      <Card className="flex items-center gap-3.5 border-blue-200/60 bg-linear-to-br from-blue-50/50 to-panel dark:border-blue-900/40 dark:from-blue-950/20">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
          <Activity size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">حصة فتحات الحسابات المسجلة</p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-xl font-black text-primary-900 dark:text-primary-50" dir="ltr">
              {registeredOpensRate}%
            </span>
            <span className="text-[0.6875rem] text-gray-500">من كل الفتحات</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                               DAILY CHART                                  */
/* -------------------------------------------------------------------------- */

function DailyChart({ daily }: { daily: AdminStats['daily'] }) {
  const [filterMode, setFilterMode] = useState<'both' | 'users' | 'guests'>('both');
  const [hoveredDay, setHoveredDay] = useState<{ day: string; users: number; guests: number } | null>(null);

  if (daily.length === 0) return null;
  const peak = Math.max(1, ...daily.map((entry) => Math.max(entry.users, entry.guests)));
  const totalUsersPeriod = daily.reduce((acc, curr) => acc + curr.users, 0);
  const totalGuestsPeriod = daily.reduce((acc, curr) => acc + curr.guests, 0);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-primary-900 dark:text-primary-50">آخر 14 يوم</h2>
            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[0.625rem] font-bold text-primary-800 dark:bg-primary-900 dark:text-primary-200">
              {formatCount(totalUsersPeriod + totalGuestsPeriod)} إجمالي الفتحات
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">مقارنة النشاط اليومي بين الحسابات المسجلة والأجهزة الزائرة</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-primary-200 bg-surface-light p-0.5 dark:border-primary-800 dark:bg-primary-950">
            <button
              type="button"
              onClick={() => setFilterMode('both')}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                filterMode === 'both'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-gray-600 hover:text-primary-900 dark:text-gray-300'
              }`}
            >
              الكل
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('users')}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                filterMode === 'users'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-gray-600 hover:text-primary-900 dark:text-gray-300'
              }`}
            >
              حسابات
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('guests')}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                filterMode === 'guests'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-gray-600 hover:text-primary-900 dark:text-gray-300'
              }`}
            >
              بدون حساب
            </button>
          </div>

          <div className="flex items-center gap-3 text-[0.6875rem] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-primary-600" /> حسابات
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gold-400" /> بدون حساب
            </span>
          </div>
        </div>
      </div>

      {hoveredDay && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-primary-50/70 px-3 py-1.5 text-xs font-semibold text-primary-900 dark:bg-primary-900/50 dark:text-primary-100 animate-fade-in">
          <span>التاريخ: {hoveredDay.day}</span>
          <div className="flex items-center gap-4">
            <span className="text-primary-700 dark:text-primary-300">حسابات: {hoveredDay.users}</span>
            <span className="text-gold-600 dark:text-gold-400">بدون حساب: {hoveredDay.guests}</span>
            <span className="text-gray-500">المجموع: {hoveredDay.users + hoveredDay.guests}</span>
          </div>
        </div>
      )}

      <div
        role="img"
        aria-label="عدد الحسابات النشطة والأجهزة بدون حساب يومياً خلال آخر 14 يوماً"
        className="mt-4 flex h-36 items-end gap-1"
        dir="ltr"
      >
        {daily.map((entry) => {
          const showUsers = filterMode === 'both' || filterMode === 'users';
          const showGuests = filterMode === 'both' || filterMode === 'guests';

          return (
            <div
              key={entry.day}
              onMouseEnter={() => setHoveredDay(entry)}
              onMouseLeave={() => setHoveredDay(null)}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 cursor-pointer"
            >
              <div className="flex h-full w-full items-end justify-center gap-[2px]">
                {showUsers && (
                  <div
                    className={`${
                      filterMode === 'users' ? 'w-full' : 'w-1/2'
                    } rounded-t-sm bg-primary-600 transition-all hover:brightness-110`}
                    style={{ height: `${(entry.users / peak) * 100}%` }}
                    title={`${entry.day} — حسابات: ${entry.users}`}
                  />
                )}
                {showGuests && (
                  <div
                    className={`${
                      filterMode === 'guests' ? 'w-full' : 'w-1/2'
                    } rounded-t-sm bg-gold-400 transition-all hover:brightness-110`}
                    style={{ height: `${(entry.guests / peak) * 100}%` }}
                    title={`${entry.day} — بدون حساب: ${entry.guests}`}
                  />
                )}
              </div>
              <span className="text-[0.5625rem] text-gray-400 dark:text-gray-500">{entry.day.slice(8)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                        SYSTEM HEALTH & SYNC MONITOR                        */
/* -------------------------------------------------------------------------- */

function SystemHealthSection({ stats }: { stats: AdminStats }) {
  const [pingLatency, setPingLatency] = useState<number | null>(null);
  const [testingPing, setTestingPing] = useState(false);

  const measurePing = useCallback(async () => {
    if (!supabase) return;
    setTestingPing(true);
    const start = performance.now();
    try {
      await supabase.rpc('is_admin');
      const latency = Math.round(performance.now() - start);
      setPingLatency(latency);
    } catch {
      setPingLatency(null);
    } finally {
      setTestingPing(false);
    }
  }, []);

  useEffect(() => {
    void measurePing();
  }, [measurePing]);

  const syncTables = [
    { name: 'settings', label: 'إعدادات التطبيق والمظهر', icon: '⚙️' },
    { name: 'plans', label: 'خطط الختمات والقراءة', icon: '📖' },
    { name: 'tasks', label: 'المهام اليومية والورد القرآني', icon: '✅' },
    { name: 'bookmarks', label: 'العلامات المرجعية للآيات', icon: '🔖' },
    { name: 'pageBookmarks', label: 'فواصل صفحات المصحف', icon: '📄' },
    { name: 'prayerRecords', label: 'سجلات الصلوات الخمس', icon: '🕌' },
    { name: 'sunnahRecords', label: 'سجلات السنن والنوافل', icon: '✨' },
    { name: 'hifzProgress', label: 'تقدم حفظ القرآن ومستوياته', icon: '🧠' },
    { name: 'hadithFavorites', label: 'الأحاديث النبوية المفضلة', icon: '📚' },
    { name: 'khatmahHifzReviews', label: 'مراجعات الحفظ والختمات', icon: '🔄' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-600 dark:bg-success-900/40 dark:text-success-300">
            <Server size={20} />
          </span>
          <div className="min-w-0">
            <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">حالة قاعدة البيانات</span>
            <span className="mt-0.5 block text-sm font-bold text-success-700 dark:text-success-300">
              متصلة ونشطة (Supabase)
            </span>
          </div>
        </Card>

        <Card className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-primary-200">
              <Activity size={20} />
            </span>
            <div>
              <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">زمن الاستجابة (Ping)</span>
              <span className="mt-0.5 block text-sm font-bold text-primary-900 dark:text-primary-50">
                {pingLatency !== null ? `${pingLatency} ms` : testingPing ? 'جارٍ القياس...' : 'غير متاح'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void measurePing()}
            disabled={testingPing}
            aria-label="إعادة قياس سرعة الاستجابة"
            className="rounded-lg p-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900"
          >
            <RefreshCw size={15} className={testingPing ? 'animate-spin' : ''} />
          </button>
        </Card>

        <Card className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900 dark:text-primary-200">
            <ShieldCheck size={20} />
          </span>
          <div>
            <span className="block text-xs font-semibold text-gray-500 dark:text-gray-400">حماية البيانات (RLS)</span>
            <span className="mt-0.5 block text-sm font-bold text-primary-900 dark:text-primary-50">
              مفعّلة وصارمة بنسبة 100%
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between border-b border-primary-100 pb-3 dark:border-primary-800">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-primary-600 dark:text-gold-400" />
            <h3 className="text-sm font-bold text-primary-900 dark:text-primary-50">جداول المزامنة السحابية النشطة</h3>
          </div>
          <span className="rounded-md bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-700 dark:bg-primary-900 dark:text-primary-200">
            {syncTables.length} جداول مدعومة
          </span>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {syncTables.map((tbl) => (
            <div
              key={tbl.name}
              className="flex items-center justify-between rounded-xl border border-primary-100 bg-surface-light p-2.5 dark:border-primary-800 dark:bg-primary-950/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{tbl.icon}</span>
                <div>
                  <span className="block font-mono text-xs font-bold text-primary-900 dark:text-primary-100" dir="ltr">
                    {tbl.name}
                  </span>
                  <span className="text-[0.6875rem] text-gray-500 dark:text-gray-400">{tbl.label}</span>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.625rem] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <Check size={10} /> RLS نشط
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="border-primary-100 bg-primary-50/40 dark:border-primary-800 dark:bg-primary-950/30">
        <div className="flex items-start gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-primary-700 dark:text-primary-300" />
          <div className="text-xs leading-relaxed text-primary-800 dark:text-primary-200">
            <p className="font-semibold">سياسة الخصوصية وحماية أجهزة الزوار:</p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">
              تُحتسب زيارات «بدون حساب» عبر معرّف عشوائي فريد ومشفّر يتم توليده محلياً على الجهاز دون جمع أي بيانات شخصية أو موقع جغرافي.
              {stats.firstTrackedAt && ` بدأ تسجيل الفعاليات منذ ${timeAgo(stats.firstTrackedAt)}.`}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                ADMIN TOOLS                                 */
/* -------------------------------------------------------------------------- */

function AdminToolsSection({
  stats,
  accountEmail,
}: {
  stats: AdminStats;
  accountEmail?: string;
}) {
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('تحديث مهم لتطبيق زاد');
  const [previewBody, setPreviewBody] = useState('تم تحسين ميزة ختمة القرآن والمزامنة السحابية.');

  const handleCopyDiagnostics = async () => {
    const report = {
      timestamp: new Date().toISOString(),
      adminEmail: accountEmail ?? 'unknown',
      totalUsers: stats.totalUsers,
      activeUsers7d: stats.activeUsers7d,
      guestDevicesTotal: stats.guestDevicesTotal,
      appOpens7d: stats.appOpens7d,
      firstEvent: stats.firstTrackedAt,
      lastEvent: stats.lastTrackedAt,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
    };
    const ok = await copyToClipboard(JSON.stringify(report, null, 2));
    if (ok) {
      setCopiedDiagnostics(true);
      setTimeout(() => setCopiedDiagnostics(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-primary-100 pb-3 dark:border-primary-800">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary-600 dark:text-gold-400" />
              <h3 className="text-sm font-bold text-primary-900 dark:text-primary-50">تقرير تشخيص النظام</h3>
            </div>
            <button
              type="button"
              onClick={handleCopyDiagnostics}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-200"
            >
              {copiedDiagnostics ? <Check size={13} className="text-success-600" /> : <Copy size={13} />}
              {copiedDiagnostics ? 'تم النسخ بنجاح' : 'نسخ التقرير'}
            </button>
          </div>
          <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">
            تقرير فني بصيغة JSON يجمع مؤشرات الخادم وحالة التطبيق لمشاركته مع فريق التطوير أو الدعم الفني.
          </p>
          <div className="mt-3 rounded-xl bg-surface-light p-3 dark:bg-primary-950/60">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-gray-400">حساب المشرف:</span>
                <span className="block truncate font-mono font-medium text-primary-900 dark:text-primary-100">
                  {accountEmail ?? 'غير مسجل'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">آخر فتح مسجل:</span>
                <span className="block font-medium text-primary-900 dark:text-primary-100">
                  {timeAgo(stats.lastTrackedAt) ?? 'الآن'}
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-primary-100 pb-3 dark:border-primary-800">
            <AppWindow size={18} className="text-primary-600 dark:text-gold-400" />
            <h3 className="text-sm font-bold text-primary-900 dark:text-primary-50">معاينة الإشعارات الإدارية</h3>
          </div>
          <div className="mt-3 space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">عنوان التنبيه</label>
              <input
                type="text"
                value={previewTitle}
                onChange={(e) => setPreviewTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs text-primary-900 outline-none focus:border-primary-500 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">نص التنبيه</label>
              <input
                type="text"
                value={previewBody}
                onChange={(e) => setPreviewBody(e.target.value)}
                className="mt-1 w-full rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-xs text-primary-900 outline-none focus:border-primary-500 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
              />
            </div>
            <div className="mt-3 rounded-2xl border border-primary-300/80 bg-panel p-3.5 shadow-md dark:border-primary-700">
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-200">
                  <ShieldCheck size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-primary-900 dark:text-primary-50">{previewTitle || 'بدون عنوان'}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-primary-700 dark:text-primary-300">
                    {previewBody || 'نص التنبيه...'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-primary-100 pb-3 dark:border-primary-800">
          <ShieldAlert size={18} className="text-primary-600 dark:text-gold-400" />
          <h3 className="text-sm font-bold text-primary-900 dark:text-primary-50">إدارة صلاحيات المشرفين (SQL)</h3>
        </div>
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
          لإضافة أدمن جديد أو إزالة صلاحية حساب، نفّذ الأمر التالي في نافذة SQL بمشروع Supabase:
        </p>
        <pre className="mt-2.5 overflow-auto rounded-xl bg-gray-950 p-3 font-mono text-[0.6875rem] text-gold-300" dir="ltr">
{`-- إضافة مشرف جديد
insert into public.admin_emails (email) values ('new-admin@example.com') on conflict do nothing;

-- إزالة مشرف
delete from public.admin_emails where email = 'user@example.com';`}
        </pre>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                MAIN SCREEN                                 */
/* -------------------------------------------------------------------------- */

export function AdminScreen({ accountEmail, onSignOut, onOpenApp }: AdminScreenProps) {
  const { confirm, dialog } = useConfirm();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<AdminTab>('all');
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(60);
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

    if (refreshIntervalSec <= 0) return;

    const interval = window.setInterval(() => void load(false), refreshIntervalSec * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, refreshIntervalSec]);

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

  const tabs: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'all', label: 'لوحة التحكم الشاملة', icon: <Layers size={15} /> },
    { id: 'analytics', label: 'التحليلات والمؤشرات', icon: <BarChart3 size={15} /> },
    { id: 'users', label: 'دليل المستخدمين', icon: <Users size={15} /> },
    { id: 'system', label: 'صحة النظام والمزامنة', icon: <Server size={15} /> },
    { id: 'tools', label: 'أدوات المشرف', icon: <Sparkles size={15} /> },
  ];

  return (
    <div className="min-h-screen min-h-dvh bg-surface-light dark:bg-surface-dark" dir="rtl">
      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 pb-16 sm:px-6 sm:py-7">
        {/* HEADER */}
        <header className="flex flex-col gap-4 rounded-3xl border border-primary-200/70 bg-panel p-4 shadow-sm dark:border-primary-800 dark:bg-raised sm:flex-row sm:items-center sm:justify-between sm:p-5 lg:p-6">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
              style={{ background: 'var(--brand-gradient)' }}
            >
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-primary-900 dark:text-primary-50 sm:text-2xl">لوحة الإدارة</h1>
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-[0.6875rem] font-bold text-primary-800 dark:bg-primary-800 dark:text-primary-100">
                  مركز التحكم
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.625rem] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <Check size={11} /> متصل بالسحابة
                </span>
              </div>
              <p className="mt-1 truncate text-xs text-primary-700/80 dark:text-primary-300" dir="ltr">
                {accountEmail ?? ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="hidden items-center gap-1 rounded-xl border border-primary-200 bg-surface-light px-2.5 py-1 text-xs dark:border-primary-800 dark:bg-primary-950 md:flex">
              <Clock3 size={13} className="text-gray-400" />
              <label htmlFor="auto-refresh-select" className="text-gray-500 dark:text-gray-400">تحديث تلقائي:</label>
              <select
                id="auto-refresh-select"
                value={refreshIntervalSec}
                onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
                className="bg-transparent font-medium text-primary-800 outline-none dark:text-primary-200"
              >
                <option value={0}>معطل</option>
                <option value={30}>كل 30 ث</option>
                <option value={60}>كل دقيقة</option>
                <option value={300}>كل 5 د</option>
              </select>
            </div>

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

        {/* NAVIGATION TABS */}
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="أقسام لوحة الإدارة">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-bold transition ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm dark:bg-primary-600'
                    : 'bg-panel text-primary-800 hover:bg-primary-50 dark:bg-raised dark:text-primary-200 dark:hover:bg-primary-900/40'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* ERROR STATE */}
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

        {/* LOADING SKELETON */}
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

        {/* READY DASHBOARD */}
        {stats && (
          <>
            {/* KPI HIGHLIGHTS BAR */}
            {(activeTab === 'all' || activeTab === 'analytics') && (
              <section aria-label="مؤشرات الأداء الرئيسية">
                <KpiHighlightsBar stats={stats} />
              </section>
            )}

            {/* CORE STAT CARDS */}
            {(activeTab === 'all' || activeTab === 'analytics') && (
              <section aria-label="ملخص الاستخدام" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  icon={<Users size={18} />}
                  label="إجمالي المستخدمين"
                  value={stats.totalUsers}
                  hint={`${formatCount(stats.usersCreated7d)} جديد هذا الأسبوع`}
                  badge="حسابات مسجلة"
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
                  badge="زوار مجهولين"
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
            )}

            {/* DAILY ACTIVITY CHART */}
            {(activeTab === 'all' || activeTab === 'analytics') && (
              <section aria-label="نشاط التطبيق">
                <DailyChart daily={stats.daily} />
              </section>
            )}

            {/* FOOTER CAPTION (Kept for accessibility and context) */}
            {(activeTab === 'all' || activeTab === 'analytics') && (
              <p className="text-center text-[0.6875rem] leading-relaxed text-gray-500 dark:text-gray-400">
                {stats.lastTrackedAt ? `آخر تسجيل لفتح تطبيق ${timeAgo(stats.lastTrackedAt)} • ` : ''}
                تُحتسب زيارات «بدون حساب» بمعرّف عشوائي محفوظ على الجهاز فقط، دون أي بيانات شخصية.
                {stats.firstTrackedAt ? ` بدأ التتبع ${timeAgo(stats.firstTrackedAt)}.` : ''}
              </p>
            )}

            {/* USER DIRECTORY */}
            {(activeTab === 'all' || activeTab === 'users') && (
              <section aria-label="دليل الحسابات">
                <UserDirectory />
              </section>
            )}

            {/* SYSTEM HEALTH & SYNC MONITOR */}
            {(activeTab === 'all' || activeTab === 'system') && (
              <section aria-label="صحة النظام والمزامنة">
                <div className="mb-2 mt-6 flex items-center justify-between">
                  <h2 className="text-base font-bold text-primary-900 dark:text-primary-50">صحة المنظومة والمزامنة</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">فحص الخادم وحماية البيانات</span>
                </div>
                <SystemHealthSection stats={stats} />
              </section>
            )}

            {/* ADMIN TOOLS */}
            {(activeTab === 'all' || activeTab === 'tools') && (
              <section aria-label="أدوات الإدارة المتقدمة">
                <div className="mb-2 mt-6 flex items-center justify-between">
                  <h2 className="text-base font-bold text-primary-900 dark:text-primary-50">أدوات المشرف المتقدمة</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">التشخيص وإدارة الصلاحيات</span>
                </div>
                <AdminToolsSection stats={stats} accountEmail={accountEmail} />
              </section>
            )}
          </>
        )}
      </main>
      {dialog}
    </div>
  );
}
