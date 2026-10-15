/**
 * Whether the update check reached the server decides two different things:
 * whether it is worth telling anyone, and in which language.
 *
 * Not reaching it — no network, a timeout, a blocked connection — is a state,
 * not a fault. This app promises to keep working without a network, so a
 * banner reading «تعذّر التحقق» over the whole screen every time someone opens
 * it on the bus is the app mistaking its own silence for a breakdown. That
 * case is *coded* (`unreachable`) so the caller can choose silence.
 *
 * Reaching it and getting a bad answer is a different matter, and there too
 * the wording has to be Arabic: what used to reach the screen was the
 * browser's own "Failed to fetch" and GitHub's English, on an Arabic
 * interface. Hence the blunt assertion below — no Latin letters in anything
 * a user can be shown.
 */
import { jest } from '@jest/globals';

// Registered before the import: in Jest's ESM mode a hoisted jest.mock never
// applies, so the factory has to exist before the module under test loads.
jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}));
jest.unstable_mockModule('@capacitor/app', () => ({
  App: { getInfo: jest.fn(async () => ({ version: '1.19.1' })) },
}));
jest.unstable_mockModule('@capacitor/browser', () => ({
  Browser: { open: jest.fn(async () => undefined) },
}));

const { checkForAppUpdate, getErrorCode } = await import('@/utils/appUpdates');

const fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();

/** A response the check can read — or, with no payload, a body that is not JSON. */
function http(status: number, payload?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json:
      payload === undefined
        ? () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0'))
        : () => Promise.resolve(payload),
  } as Response;
}

/** Nothing a user can see may arrive in another language. */
function expectArabic(message: string): void {
  expect(message).toMatch(/\p{Script=Arabic}/u);
  expect(message).not.toMatch(/[A-Za-z]/);
}

/** Rejects with whatever the check threw, without pretending to resolve. */
async function caught(): Promise<unknown> {
  try {
    return await checkForAppUpdate();
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('checkForAppUpdate', () => {
  it('calls "no answer at all" unreachable, and asks once more first', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await caught();

    // One retry, as the caller's comment promises: the network on a phone often
    // settles in the seconds after launch, and a single attempt would make that
    // look like a failure.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome).toBeInstanceOf(Error);
    expect(getErrorCode(outcome)).toBe('unreachable');

    const message = (outcome as Error).message;
    expect(message).toContain('تعذّر الوصول');
    expectArabic(message);
  });

  it('does not ask a second time when the server did answer', async () => {
    fetchMock.mockResolvedValue(http(500));

    const outcome = await caught();

    // An HTTP status is already an answer; asking again gets the same one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome).toBeInstanceOf(Error);
    expectArabic((outcome as Error).message);
  });

  it('explains a rate limit in Arabic', async () => {
    fetchMock.mockResolvedValue(http(403));

    const outcome = await caught();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((outcome as Error).message).toContain('تم تجاوز حد طلبات');
    expectArabic((outcome as Error).message);
  });

  it('reports a body that is not JSON as Arabic, not as the parser\'s English', async () => {
    fetchMock.mockResolvedValue(http(200));

    const outcome = await caught();

    // The payload arrived, so there is nothing to retry.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((outcome as Error).message).toContain('ردّ خادم التحديثات');
    expectArabic((outcome as Error).message);
  });

  it('still reads a newer release as an update waiting to be installed', async () => {
    fetchMock.mockResolvedValue(
      http(200, {
        tag_name: 'v9.9.9',
        draft: false,
        prerelease: false,
        assets: [
          {
            name: 'ZAD-v9.9.9.apk',
            browser_download_url: 'https://example.test/ZAD-v9.9.9.apk',
          },
        ],
      }),
    );

    await expect(checkForAppUpdate()).resolves.toEqual({
      status: 'available',
      version: '9.9.9',
      downloadUrl: 'https://example.test/ZAD-v9.9.9.apk',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
