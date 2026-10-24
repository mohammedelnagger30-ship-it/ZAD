import { supabase } from '@/utils/supabaseClient';

/**
 * The dashboard's whole read surface: one RPC (`admin_stats`), gated server-side
 * by the admin allow-list. Nothing here talks to a table directly — the tables
 * are closed to clients by design, so a copied request from anywhere else
 * returns nothing at all.
 */

export interface AdminDailyStat {
  day: string;
  users: number;
  guests: number;
}

export interface AdminStats {
  /** Every account that has ever existed (auth.users). */
  totalUsers: number;
  usersCreated7d: number;
  usersCreated30d: number;
  /** Accounts that reported an open in the window. */
  activeUsers7d: number;
  activeUsers30d: number;
  /** Distinct devices that opened the app without an account. */
  guestDevicesTotal: number;
  guestDevices7d: number;
  guestOpens7d: number;
  appOpens7d: number;
  firstTrackedAt: string | null;
  lastTrackedAt: string | null;
  daily: AdminDailyStat[];
}

export class AdminStatsError extends Error {
  /** The signed-in account is not on the allow-list (or the RPC refused it). */
  readonly notAuthorized: boolean;
  /** The migration has not been run on this project yet. */
  readonly missingRpc: boolean;

  constructor(message: string, options: { notAuthorized?: boolean; missingRpc?: boolean } = {}) {
    super(message);
    this.name = 'AdminStatsError';
    this.notAuthorized = options.notAuthorized ?? false;
    this.missingRpc = options.missingRpc ?? false;
  }
}

function asCount(value: unknown): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function asTimestamp(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asDaily(value: unknown): AdminDailyStat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.day !== 'string') return [];
    return [{ day: record.day, users: asCount(record.users), guests: asCount(record.guests) }];
  });
}

/**
 * The RPC answers in JSON built by Postgres, where counts arrive as jsonb
 * numbers but a caller may still meet a string or a null (a hand-edited view, a
 * future column type change). Coercing here keeps the UI from ever rendering
 * "undefined" in a stat card.
 */
export function normalizeAdminStats(value: unknown): AdminStats {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    totalUsers: asCount(record.total_users),
    usersCreated7d: asCount(record.users_created_7d),
    usersCreated30d: asCount(record.users_created_30d),
    activeUsers7d: asCount(record.active_users_7d),
    activeUsers30d: asCount(record.active_users_30d),
    guestDevicesTotal: asCount(record.guest_devices_total),
    guestDevices7d: asCount(record.guest_devices_7d),
    guestOpens7d: asCount(record.guest_opens_7d),
    appOpens7d: asCount(record.app_opens_7d),
    firstTrackedAt: asTimestamp(record.first_event_at),
    lastTrackedAt: asTimestamp(record.last_event_at),
    daily: asDaily(record.daily),
  };
}

/** How long the admin gate waits before it stops waiting.
 *
 * `isAdminAccount` is documented to fail *closed* — a missing migration or a
 * dead network returns false and the account gets the ordinary app. That held
 * for a rejected request but not for one that never settles: supabase-js sends
 * no timeout of its own, so a captive portal or a black-holed TCP connection
 * left the signed-in user parked on «جارٍ فتح الحساب...» forever, on a build
 * that rendered instantly before the gate existed. The abort turns the hang
 * into the failure the comment already promised. */
const ADMIN_CHECK_TIMEOUT_MS = 2_000;

/** Is the signed-in account on `admin_emails`? False on any failure, so a
 * missing migration or a dead network leaves the app in its normal state
 * instead of wedging at a gate nobody can open. */
export async function isAdminAccount(): Promise<boolean> {
  if (!supabase) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ADMIN_CHECK_TIMEOUT_MS);
  try {
    const { data, error } = await supabase.rpc('is_admin').abortSignal(controller.signal);
    if (error) {
      console.warn('Admin check unavailable:', error.message);
      return false;
    }
    return data === true;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    // An abort is the expected shape of a slow gate, not a fault worth a stack.
    console.warn(
      /abort/i.test(reason) ? 'Admin check timed out — opening the ordinary app.' : 'Admin check unavailable: ' + reason,
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAdminStats(): Promise<AdminStats> {
  if (!supabase) {
    throw new AdminStatsError('الاتصال السحابي غير مُهيّأ.');
  }

  const { data, error } = await supabase.rpc('admin_stats');
  if (error) {
    const message = error.message ?? '';
    const notAuthorized = error.code === '42501' || /not authorized/i.test(message);
    const missingRpc = error.code === 'PGRST202' || /function .*admin_stats/i.test(message);
    throw new AdminStatsError(
      notAuthorized
        ? 'هذا الحساب غير مصرح له بفتح لوحة الإدارة.'
        : missingRpc
          ? 'لم يتم تفعيل لوحة الإدارة بعد: شغّل ملف migration الخاصة بلوحة الإدارة في Supabase.'
          : message || 'تعذّر جلب الإحصائيات.',
      { notAuthorized, missingRpc },
    );
  }

  return normalizeAdminStats(data);
}
