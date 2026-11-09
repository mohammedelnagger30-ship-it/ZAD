import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { jest } from '@jest/globals';

/**
 * The dashboard itself: the numbers an admin opened the page to read must reach
 * the screen, and a refusal must say so instead of showing an empty panel.
 * The Supabase client is stubbed (it reads Vite's `import.meta.env`, absent
 * under Jest) and answers with the payload `public.admin_stats` builds.
 */

interface RpcAnswer {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let answer: RpcAnswer = { data: null, error: null };
let usersAnswer: RpcAnswer = { data: null, error: null };

jest.unstable_mockModule('@/utils/sync/supabaseClient', () => ({
  supabase: {
    rpc: (name: string) => Promise.resolve(name === 'admin_user_directory' ? usersAnswer : answer),
  },
  isSupabaseConfigured: true,
}));

const { AdminScreen } = await import('@/screens/AdminScreen');

const STATS_PAYLOAD = {
  total_users: 1234,
  users_created_7d: 7,
  users_created_30d: 25,
  active_users_7d: 40,
  active_users_30d: 70,
  guest_devices_total: 300,
  guest_devices_7d: 60,
  guest_opens_7d: 150,
  app_opens_7d: 260,
  first_event_at: '2026-10-01T00:00:00+00:00',
  last_event_at: '2026-10-15T09:00:00+00:00',
  daily: [
    { day: '2026-10-14', users: 12, guests: 30 },
    { day: '2026-10-15', users: 9, guests: 21 },
  ],
};

const USERS_PAYLOAD = {
  total: 2,
  users: [
    {
      id: 'user-1',
      email: 'reader@example.com',
      created_at: '2026-11-01T10:00:00Z',
      last_sign_in_at: '2026-11-05T12:30:00Z',
      email_confirmed_at: '2026-11-01T10:05:00Z',
    },
    {
      id: 'user-2',
      email: 'new-reader@example.com',
      created_at: '2026-11-06T09:00:00Z',
      last_sign_in_at: null,
      email_confirmed_at: null,
    },
  ],
};

describe('AdminScreen', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function render() {
    const element = (
      <AdminScreen accountEmail="admin@example.com" onSignOut={async () => {}} onOpenApp={() => {}} />
    ) as ReactElement;
    await act(async () => {
      root.render(element);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    return container;
  }

  const text = () => container.textContent ?? '';

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    answer = { data: STATS_PAYLOAD, error: null };
    usersAnswer = { data: USERS_PAYLOAD, error: null };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows the account it opened for and the headline counts', async () => {
    await render();

    expect(container.querySelector('h1')?.textContent).toBe('لوحة الإدارة');
    expect(text()).toContain('admin@example.com');
    // Total users reach the screen as a formatted number, not raw jsonb.
    expect(text()).toContain('1,234');
    expect(text()).toContain('إجمالي المستخدمين');
  });

  it('shows the guest counts the dashboard exists for', async () => {
    await render();

    expect(text()).toContain('دخول بدون حساب');
    expect(text()).toContain('300');
    expect(text()).toContain('بدون حساب — 7 أيام');
    expect(text()).toContain('فتحات بدون حساب — 7 أيام');
  });

  it('shows searchable account emails, confirmation state, and account activity', async () => {
    await render();

    expect(text()).toContain('دليل المستخدمين');
    expect(text()).toContain('reader@example.com');
    expect(text()).toContain('new-reader@example.com');
    expect(text()).toContain('بريد مؤكد');
    expect(text()).toContain('بانتظار التأكيد');
    expect(text()).toContain('تاريخ التسجيل');
    expect(text()).toContain('آخر دخول');
    expect(container.querySelector('input[aria-label="ابحث بالبريد الإلكتروني"]')).not.toBeNull();
    expect(container.querySelector('#admin-user-confirmation')).not.toBeNull();
  });

  it('draws one pair of bars per reported day', async () => {
    await render();

    const chart = container.querySelector('[role="img"]');
    expect(chart).not.toBeNull();
    expect(chart?.getAttribute('aria-label')).toContain('بدون حساب');
    const bars = container.querySelectorAll('[role="img"] [title]');
    expect(bars).toHaveLength(4);
    expect(bars[0].getAttribute('title')).toBe('2026-10-14 — حسابات: 12');
  });

  it('says plainly when the account is not on the allow-list', async () => {
    answer = { data: null, error: { code: '42501', message: 'Not authorized' } };

    await render();

    expect(text()).toContain('هذا الحساب غير مصرح له بفتح لوحة الإدارة.');
    // A refusal is not a hiccup: offering "try again" would loop on the same wall.
    expect(text()).not.toContain('إعادة المحاولة');
  });

  it('offers a way back to the app from the dashboard', async () => {
    const openApp = jest.fn();
    const element = (
      <AdminScreen accountEmail="admin@example.com" onSignOut={async () => {}} onOpenApp={openApp} />
    ) as ReactElement;
    await act(async () => {
      root.render(element);
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('فتح التطبيق'),
    );
    expect(button).toBeDefined();
    button?.click();
    expect(openApp).toHaveBeenCalledTimes(1);
  });

  it('renders navigation tabs and switches views', async () => {
    await render();

    expect(text()).toContain('لوحة التحكم الشاملة');
    expect(text()).toContain('التحليلات والمؤشرات');
    expect(text()).toContain('دليل المستخدمين');
    expect(text()).toContain('صحة النظام والمزامنة');
    expect(text()).toContain('أدوات المشرف');

    // Switch to system health tab
    const systemTab = Array.from(container.querySelectorAll('button[role="tab"]')).find((b) =>
      b.textContent?.includes('صحة النظام والمزامنة'),
    );
    expect(systemTab).toBeDefined();
    await act(async () => {
      (systemTab as HTMLElement)?.click();
    });

    expect(text()).toContain('صحة المنظومة والمزامنة');
    expect(text()).toContain('جداول المزامنة السحابية النشطة');
    expect(text()).toContain('settings');
    expect(text()).toContain('hifzProgress');
  });

  it('opens user details modal when a user row is clicked and closes it', async () => {
    await render();

    const userRow = Array.from(container.querySelectorAll('li')).find((row) =>
      row.textContent?.includes('reader@example.com'),
    );
    expect(userRow).toBeDefined();

    await act(async () => {
      (userRow as HTMLElement)?.click();
    });

    expect(text()).toContain('تفاصيل الحساب');
    expect(text()).toContain('معلومات الحساب المسجل في المنظومة');
    expect(text()).toContain('user-1');

    // Close modal
    const closeBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === 'إغلاق',
    );
    expect(closeBtn).toBeDefined();
    await act(async () => {
      closeBtn?.click();
    });

    expect(text()).not.toContain('معلومات الحساب المسجل في المنظومة');
  });

  it('provides CSV export button and auto-refresh selector', async () => {
    await render();

    const exportBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('تصدير CSV'),
    );
    expect(exportBtn).toBeDefined();

    const autoRefreshSelect = container.querySelector('#auto-refresh-select');
    expect(autoRefreshSelect).not.toBeNull();
  });
});
