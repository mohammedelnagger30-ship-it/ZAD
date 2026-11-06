/**
 * On-demand adhan voices.
 *
 * What is on disk decides which voices the settings picker offers, and a download that
 * isn't really an audio file must never be stored as an adhan — a broken voice is only
 * discovered at prayer time, in silence.
 */
import { jest } from '@jest/globals';

// The suite runs in Jest's ESM mode, where hoisted `jest.mock` never applies: the
// factory must be registered before anything imports the module under test.
jest.unstable_mockModule('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Filesystem: {
    stat: jest.fn(),
    writeFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

const { Directory, Filesystem } = await import('@capacitor/filesystem');
const { ADHAN_SOUNDS, DEFAULT_ADHAN_SOUND_ID } = await import('@/data/adhanSounds');
const {
  AdhanDownloadError,
  downloadedAdhanVoiceIds,
  deleteAdhanVoice,
  downloadAdhanVoice,
  refreshDownloadedAdhanVoices,
  resolveAdhanSoundPath,
  usableAdhanSound,
} = await import('@/utils/adhanStore');

const stat = Filesystem.stat as unknown as jest.Mock<(opts: { path: string }) => Promise<unknown>>;
const writeFile = Filesystem.writeFile as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const deleteFile = Filesystem.deleteFile as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();

const stored = ADHAN_SOUNDS.find((sound) => sound.id === 'alafasy_general')!;
const bundled = ADHAN_SOUNDS.find((sound) => sound.id === 'makkah_masjid')!;
const outOfTheBox = ADHAN_SOUNDS.find((sound) => sound.id === DEFAULT_ADHAN_SOUND_ID)!;

/** An "audio" payload big enough to pass the size floor. */
function audioBytes(): Uint8Array {
  const bytes = new Uint8Array(60_000);
  bytes[0] = 0x49; // "ID3"
  bytes[1] = 0x44;
  bytes[2] = 0x33;
  return bytes;
}

function fakeResponse(blob: Blob): Response {
  return {
    ok: true,
    headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? blob.type : null) },
    body: null,
    blob: () => Promise.resolve(blob),
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  stat.mockRejectedValue(new Error('not found'));
  writeFile.mockResolvedValue({ uri: 'file:///data/adhan_store/x.mp3' });
  deleteFile.mockResolvedValue({});
});

test('only files actually on disk count as downloaded', async () => {
  stat.mockImplementation(({ path }: { path: string }) =>
    path.endsWith(stored.file)
      ? Promise.resolve({ uri: `file:///data/${path}`, size: 100 })
      : Promise.reject(new Error('gone')),
  );

  const ids = await refreshDownloadedAdhanVoices();

  expect([...ids]).toEqual([stored.id]);
  expect(downloadedAdhanVoiceIds().has(bundled.id)).toBe(false);
});

test('a successful download is stored and becomes usable', async () => {
  fetchMock.mockResolvedValue(fakeResponse(new Blob([audioBytes()], { type: 'audio/mpeg' })));

  await downloadAdhanVoice(stored);

  expect(writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      path: `adhan_store/${stored.file}`,
      directory: Directory.Data,
      data: expect.any(String),
    }),
  );
  expect(downloadedAdhanVoiceIds().has(stored.id)).toBe(true);
  expect(usableAdhanSound(stored.id)).toBe(stored);
});

test('a non-audio answer (an HTML error page) is rejected and never stored', async () => {
  // Start from a clean slate: an earlier test may have stored this voice.
  await refreshDownloadedAdhanVoices();
  const page = new Blob([new Uint8Array(8_000)], { type: 'text/html' });
  fetchMock.mockResolvedValue(fakeResponse(page));

  await expect(downloadAdhanVoice(stored)).rejects.toBeInstanceOf(AdhanDownloadError);
  expect(writeFile).not.toHaveBeenCalled();
  expect(downloadedAdhanVoiceIds().has(stored.id)).toBe(false);
});

test('the streamed path reports progress and validates the first bytes', async () => {
  const payload = audioBytes();
  // jsdom has no ReadableStream; a reader-shaped stub exercises the same code path.
  let index = 0;
  const chunks = [payload.subarray(0, 1_000), payload.subarray(1_000)];
  const stream = {
    getReader: () => ({
      read: async () =>
        index < chunks.length
          ? { done: false as const, value: chunks[index++] }
          : { done: true as const, value: undefined },
      releaseLock: () => {},
    }),
  };
  const progress: Array<{ received: number; total: number }> = [];
  fetchMock.mockResolvedValue({
    ok: true,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === 'content-length' ? String(payload.length) : 'audio/mpeg',
    },
    body: stream,
  } as unknown as Response);

  await downloadAdhanVoice(stored, (value) => progress.push(value));

  expect(progress[progress.length - 1]).toEqual({ received: payload.length, total: payload.length });
  expect(writeFile).toHaveBeenCalled();
});

test('a missing voice falls back to the out-of-the-box adhan', () => {
  expect(outOfTheBox.bundled).toBe(true);
  expect(usableAdhanSound(stored.id, new Set())).toBe(outOfTheBox);
  expect(usableAdhanSound('unknown-voice', new Set())).toBe(outOfTheBox);
  expect(usableAdhanSound(bundled.id, new Set())).toBe(bundled);
});

test('deleting a stored voice removes it; bundled voices are never touched', async () => {
  await refreshDownloadedAdhanVoices();
  await deleteAdhanVoice(stored);
  expect(deleteFile).toHaveBeenCalledTimes(1);
  expect(downloadedAdhanVoiceIds().has(stored.id)).toBe(false);

  await deleteAdhanVoice(bundled);
  expect(deleteFile).toHaveBeenCalledTimes(1);
});

test('a stored voice has no native sound path outside the app (web build)', async () => {
  await expect(resolveAdhanSoundPath(stored)).resolves.toBeNull();
});
