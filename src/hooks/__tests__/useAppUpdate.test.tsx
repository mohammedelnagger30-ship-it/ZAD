/**
 * «تعذّر الوصول» و«تعذّر التحقق» يَعنيان شيئين مختلفين، ومن هذا الاختبار يظهر
 * أيّهما يقع في أيّ حقل.
 *
 * وعدُ التطبيق أنه يعمل بلا شبكة. وحين يفتح أحدهم التطبيق في مترو بدون
 * إنترنت، فالتحقّق التلقائي لا يصل إلى الخادم — وهذه حالةٌ عن الشبكة، لا
 * عطبٌ في التطبيق. أن تعلُن اللافتة فوق الشاشة كلّ مرّة «تعذّر التحقق من
 * تحديث التطبيق» مع رسالتك المتصفّح الخام، هو التطبيق يخطئ إشارة هاتفه في
 * عَرَضٍ على نفسه. لذلك حُمِّل الحالتان حقلَين منفصلين، وهذا يثبّت أيُّهما
 * يقع في أيّ حقل:
 *
 *   * لم يأتِ جواب إطلاقًا ← `error` يبقى فارغًا، ويأتي `unreachableNotice`.
 *   * جاء جوابٌ رديء ← `error`، وبرسالة عربية لا برسالة متصفّح إنجليزية.
 *
 * الاختبار ينادي `check()` لا أن ينتظر مؤقّت الإقلاع: التأخير ليس هو ما
 * تغيّر، وثلاث ثوانٍ لكل اختبار لا تشترِ شيئًا.
 */
import { jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';

// Registered before the import: in Jest's ESM mode a hoisted jest.mock never
// applies, so the factories have to exist before the hook loads.
jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}));
jest.unstable_mockModule('@capacitor/app', () => ({
  App: {
    getInfo: jest.fn(async () => ({ version: '1.19.1' })),
    addListener: jest.fn(async () => ({ remove: jest.fn() })),
  },
}));
jest.unstable_mockModule('@capacitor/browser', () => ({
  Browser: { open: jest.fn(async () => undefined) },
}));

const { useAppUpdate } = await import('@/hooks/useAppUpdate');

type Controller = ReturnType<typeof useAppUpdate>;

let controller: Controller | null = null;
const fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();

/** The smallest screen that can host the hook: it only has to render it. */
function Harness() {
  controller = useAppUpdate();
  return <div>{controller.error || controller.unreachableNotice}</div>;
}

function http(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(null) } as Response;
}

describe('useAppUpdate', () => {
  let container: HTMLDivElement;
  let root: Root;

  // The reachability check retries once after 1.5s, which the default 5s
  // timeout leaves uncomfortably little room for on a loaded machine.
  jest.setTimeout(20_000);

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    controller = null;
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness /> as ReactElement);
    });
  });

  afterEach(async () => {
    // Unmounting also cancels the mount timer, so no check from one test can
    // land in the next one.
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('says nothing about a failure when the server could not be reached at all', async () => {
    // What a phone with no signal hands to `fetch`.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await act(async () => {
      await controller!.check();
    });

    // The whole point: an absent network must never be reported as an error,
    // because the banner renders `error` and the banner covers the screen.
    expect(controller!.error).toBe('');
    expect(controller!.update).toBeNull();

    expect(controller!.unreachableNotice).toContain('تعذّر الوصول');
    expect(controller!.unreachableNotice).not.toMatch(/[A-Za-z]/);
  });

  it('reports a bad answer as an error, in Arabic', async () => {
    fetchMock.mockResolvedValue(http(500));

    await act(async () => {
      await controller!.check();
    });

    expect(controller!.unreachableNotice).toBe('');
    expect(controller!.error).toMatch(/\p{Script=Arabic}/u);
    expect(controller!.error).not.toMatch(/[A-Za-z]/);
  });
});
