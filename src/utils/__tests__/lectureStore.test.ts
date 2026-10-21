/**
 * Lectures kept on the device.
 *
 * Three things must hold, or a listener downloads an hour of audio and finds nothing to
 * play: only a real audio stream may be stored, a file longer than one chunk must be
 * appended rather than overwritten, and «is it downloaded?» must be answered by what is
 * on disk — never by what the app remembers.
 */
import { jest } from '@jest/globals';

const mockPhonePlugin = {
  list: jest.fn<() => Promise<{ folder: string; files: { name: string; size: number }[] }>>(),
  save: jest.fn<(options: { dir: string; file: string; name: string }) => Promise<{ name: string; path: string }>>(),
  remove: jest.fn<(options: { name: string }) => Promise<{ removed: boolean }>>(),
};

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (uri: string) => `capacitor://localhost/_capacitor_file_${uri}`,
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: () => mockPhonePlugin,
}));

jest.unstable_mockModule('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Cache: 'CACHE' },
  Filesystem: {
    readdir: jest.fn(),
    stat: jest.fn(),
    writeFile: jest.fn(),
    appendFile: jest.fn(),
    rename: jest.fn(),
    deleteFile: jest.fn(),
    copy: jest.fn(),
    readFile: jest.fn(),
  },
}));

const mockShare = { share: jest.fn<() => Promise<void>>() };
jest.unstable_mockModule('@capacitor/share', () => ({ Share: mockShare }));

const { Filesystem } = await import('@capacitor/filesystem');
const {
  cancelLectureDownload,
  deleteLectureDownload,
  downloadedLectureIds,
  enqueueLectureDownloads,
  getLectureStoreSnapshot,
  isLectureOnPhone,
  refreshDownloadedLectures,
  requestLecturePhoneSave,
  resolveLecturePlayUrl,
  shareLecture,
} = await import('@/utils/lectureStore');
const { huwayniLectureUrl } = await import('@/data/scholarHuwaini');
type HuwainiLecture = import('@/data/scholarHuwaini').HuwainiLecture;

const readdir = Filesystem.readdir as unknown as jest.Mock<() => Promise<unknown>>;
const stat = Filesystem.stat as unknown as jest.Mock<(opts: { path: string }) => Promise<unknown>>;
const writeFile = Filesystem.writeFile as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const appendFile = Filesystem.appendFile as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const rename = Filesystem.rename as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const deleteFile = Filesystem.deleteFile as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<unknown>>;
const copyFile = Filesystem.copy as unknown as jest.Mock<(opts: Record<string, unknown>) => Promise<{ uri: string }>>;
const fetchMock = jest.fn<(input: string, init?: RequestInit) => Promise<Response>>();

const ITEM = 'test-item';
const lecture: HuwainiLecture = { id: 'a-1', title: 'درس تجريبي', file: '1-a.mp3', seconds: 60, bytes: 96_000 };

/** The first bytes every mp3 opens with as far as this code cares. */
function audioHead(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes[0] = 0x49;
  bytes[1] = 0x44;
  bytes[2] = 0x33;
  return bytes;
}

/** What archive.org actually answers with for a file it no longer has: an HTML page. */
function htmlPage(): Uint8Array {
  const bytes = new Uint8Array(900);
  bytes.set([0x3c, 0x68, 0x74, 0x6d, 0x6c]); // `<html`
  return bytes;
}

/** A response whose body streams `chunks`, the way a real download arrives. */
function streamedResponse(chunks: Uint8Array[], contentType = 'audio/mpeg', total?: number): Response {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) => {
        const name = key.toLowerCase();
        if (name === 'content-type') return contentType;
        if (name === 'content-length') {
          return String(total ?? chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        }
        return null;
      },
    },
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false as const, value: chunks[index++] }
            : { done: true as const, value: undefined },
        releaseLock: () => {},
      }),
    },
  } as unknown as Response;
}

/** Waits for the background queue to reach a state, since a download returns immediately. */
function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('the download never finished'));
      setTimeout(tick, 5);
    };
    tick();
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  readdir.mockRejectedValue(new Error('no directory yet'));
  stat.mockResolvedValue({ uri: `file:///data/lecture_store/${lecture.id}.mp3`, size: 96_000 });
  writeFile.mockResolvedValue({ uri: `file:///data/lecture_store/${lecture.id}.mp3` });
  appendFile.mockResolvedValue({});
  rename.mockResolvedValue({});
  deleteFile.mockResolvedValue({});
  copyFile.mockResolvedValue({ uri: `capacitor://localhost/_capacitor_file_/cache/${lecture.title}.mp3` });
  mockShare.share.mockResolvedValue();
  mockPhonePlugin.list.mockResolvedValue({ folder: 'قُرّة', files: [] });
  mockPhonePlugin.save.mockImplementation(async ({ name }) => ({
    name,
    path: `/storage/emulated/0/Download/قُرّة/${name}`,
  }));
  mockPhonePlugin.remove.mockResolvedValue({ removed: true });
  window.localStorage.clear();
  // The store is module state: empty it so one test cannot answer for another.
  cancelLectureDownload(lecture.id);
  await refreshDownloadedLectures();
});

test('the downloaded set is the directory listing, and only finished .mp3 files count', async () => {
  readdir.mockResolvedValue({
    files: [
      { name: 'a-1.mp3', type: 'file' },
      { name: 'b-2.mp3', type: 'file' },
      { name: 'notes.txt', type: 'file' },
    ],
  });

  const ids = await refreshDownloadedLectures();

  expect([...ids].sort()).toEqual(['a-1', 'b-2']);
});

test('a half-written .part file is never counted, and is swept away', async () => {
  // What a killed download leaves behind: it must not be offered as a playable lecture,
  // and it must not sit on the device forever either.
  readdir.mockResolvedValue({
    files: [
      { name: 'a-1.mp3', type: 'file' },
      { name: 'c-3.part', type: 'file' },
    ],
  });

  const ids = await refreshDownloadedLectures();

  expect([...ids]).toEqual(['a-1']);
  expect(deleteFile).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'lecture_store/c-3.part', directory: 'DATA' }),
  );
});

test('a missing directory simply means nothing has been downloaded', async () => {
  readdir.mockRejectedValue(new Error('ENOENT'));

  await expect(refreshDownloadedLectures()).resolves.toEqual(new Set());
  expect(downloadedLectureIds().size).toBe(0);
});

test('a refresh during a download never sweeps the file being written', async () => {
  // The page can be reopened while a download runs; the sweep must tell a corpse from a
  // file that is still growing.
  let openGate = () => {};
  const gate = new Promise<void>((resolve) => {
    openGate = () => resolve();
  });
  fetchMock.mockImplementation(async () => {
    let sent = false;
    return {
      ok: true,
      status: 200,
      headers: {
        get: (key: string) => (key.toLowerCase() === 'content-type' ? 'audio/mpeg' : null),
      },
      body: {
        getReader: () => ({
          read: async () => {
            if (!sent) {
              sent = true;
              return { done: false as const, value: audioHead(500) };
            }
            await gate;
            return { done: true as const, value: undefined };
          },
          releaseLock: () => {},
        }),
      },
    } as unknown as Response;
  });

  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => getLectureStoreSnapshot().downloads.has(lecture.id));

  readdir.mockResolvedValue({ files: [{ name: 'a-1.part', type: 'file' }] });
  await refreshDownloadedLectures();

  expect(deleteFile).not.toHaveBeenCalled();

  openGate();
  await waitUntil(() => downloadedLectureIds().has(lecture.id));
  expect(rename).toHaveBeenCalledTimes(1);
});

test('a kept lecture is written under a temporary name, renamed, then offers its stored URL', async () => {
  fetchMock.mockResolvedValue(streamedResponse([audioHead(1_000)]));

  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => downloadedLectureIds().has(lecture.id));

  expect(writeFile).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'lecture_store/a-1.part',
      directory: 'DATA',
      data: expect.any(String),
    }),
  );
  expect(appendFile).not.toHaveBeenCalled();
  // The only thing that makes it «downloaded»: the rename onto the final name.
  expect(rename).toHaveBeenCalledWith({
    from: 'lecture_store/a-1.part',
    to: 'lecture_store/a-1.mp3',
    directory: 'DATA',
  });
  expect(getLectureStoreSnapshot().downloads.size).toBe(0);

  await expect(resolveLecturePlayUrl(lecture, ITEM)).resolves.toBe(
    'capacitor://localhost/_capacitor_file_file:///data/lecture_store/a-1.mp3',
  );
});

test('a lecture longer than one chunk is appended, not overwritten', async () => {
  // One full chunk plus a tail: the tail is what proves the second write appends.
  const chunk = audioHead(3 * 1024 * 1024);
  const tail = audioHead(1_000);
  fetchMock.mockResolvedValue(streamedResponse([chunk, tail]));

  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => downloadedLectureIds().has(lecture.id));

  expect(writeFile).toHaveBeenCalledTimes(1);
  expect(appendFile).toHaveBeenCalledTimes(1);
  expect(appendFile).toHaveBeenCalledWith(
    expect.objectContaining({
      path: 'lecture_store/a-1.part',
      directory: 'DATA',
      data: expect.any(String),
    }),
  );
});

test('an HTML error page under a 200 is rejected and its half-written file removed', async () => {
  fetchMock.mockResolvedValue(streamedResponse([htmlPage()], 'text/html'));

  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => getLectureStoreSnapshot().downloads.get(lecture.id)?.status === 'error');

  expect(writeFile).not.toHaveBeenCalled();
  expect(deleteFile).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'lecture_store/a-1.part', directory: 'DATA' }),
  );
  expect(downloadedLectureIds().has(lecture.id)).toBe(false);
});

test('a missing file is refused before anything is written', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 404 } as Response);

  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => getLectureStoreSnapshot().downloads.get(lecture.id)?.status === 'error');

  expect(writeFile).not.toHaveBeenCalled();
  expect(getLectureStoreSnapshot().downloads.get(lecture.id)?.error).toBeTruthy();
});

test('a lecture that is not on disk falls back to the archive.org stream', async () => {
  await refreshDownloadedLectures();

  await expect(resolveLecturePlayUrl(lecture, ITEM)).resolves.toBe(
    huwayniLectureUrl(ITEM, lecture.file),
  );
});

test('deleting removes the file and the id together', async () => {
  fetchMock.mockResolvedValue(streamedResponse([audioHead(1_000)]));
  enqueueLectureDownloads([{ lecture, item: ITEM }]);
  await waitUntil(() => downloadedLectureIds().has(lecture.id));

  await deleteLectureDownload(lecture.id);

  expect(deleteFile).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'lecture_store/a-1.mp3', directory: 'DATA' }),
  );
  expect(downloadedLectureIds().has(lecture.id)).toBe(false);
});

// ---------------------------------------------------------------------------
// «تنزيل» — download, save to the phone folder, and offer to share
// ---------------------------------------------------------------------------

test('saving to the phone fetches the lecture first, then copies it out under its title', async () => {
  fetchMock.mockResolvedValue(streamedResponse([audioHead(1_000)]));

  await expect(requestLecturePhoneSave({ lecture, item: ITEM }, 'درس تجريبي')).resolves.toBe('queued');

  await waitUntil(
    () => getLectureStoreSnapshot().phoneSaved.has(lecture.id) && !getLectureStoreSnapshot().phoneSaving.has(lecture.id),
  );

  // The copy comes out of the app's own store, under the name the file manager shows —
  // never the archive id the stored file carries.
  expect(mockPhonePlugin.save).toHaveBeenCalledWith({
    dir: 'lecture_store',
    file: 'a-1.mp3',
    name: 'درس تجريبي.mp3',
  });
  expect(downloadedLectureIds().has(lecture.id)).toBe(true);
});

test('a lecture already kept is copied to the phone without fetching it again', async () => {
  readdir.mockResolvedValue({ files: [{ name: 'a-1.mp3', type: 'file' }] });
  await refreshDownloadedLectures();

  await expect(requestLecturePhoneSave({ lecture, item: ITEM }, 'درس تجريبي')).resolves.toBe('phone');

  expect(mockPhonePlugin.save).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(isLectureOnPhone(lecture.id)).toBe(true);
});

test('one «تنزيل» tap also opens the share sheet, so the lecture can go anywhere', async () => {
  readdir.mockResolvedValue({ files: [{ name: 'a-1.mp3', type: 'file' }] });
  await refreshDownloadedLectures();

  await requestLecturePhoneSave({ lecture, item: ITEM }, 'درس تجريبي');

  // The file is copied into the cache under its title and handed to the system sheet —
  // the sheet is what WhatsApp, Telegram and the rest are reached through.
  expect(copyFile).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'درس تجريبي.mp3', directory: 'DATA', toDirectory: 'CACHE' }),
  );
  expect(mockShare.share).toHaveBeenCalledWith(
    expect.objectContaining({ files: [expect.any(String)], title: 'درس تجريبي.mp3' }),
  );
});

test('re-sharing a lecture that already left the app never downloads it again', async () => {
  readdir.mockResolvedValue({ files: [{ name: 'a-1.mp3', type: 'file' }] });
  await refreshDownloadedLectures();

  await expect(shareLecture({ lecture, item: ITEM }, 'درس تجريبي')).resolves.toBe('phone');

  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockPhonePlugin.save).toHaveBeenCalledTimes(1);
  expect(mockShare.share).toHaveBeenCalledTimes(1);
});

test('a phone copy deleted from its folder stops being claimed as saved', async () => {
  readdir.mockResolvedValue({ files: [{ name: 'a-1.mp3', type: 'file' }] });
  await refreshDownloadedLectures();
  await requestLecturePhoneSave({ lecture, item: ITEM }, 'درس تجريبي');
  expect(isLectureOnPhone(lecture.id)).toBe(true);

  // The listener cleared it out from the file manager; the app must not point at it.
  mockPhonePlugin.list.mockResolvedValue({ folder: 'قُرّة', files: [] });
  await refreshDownloadedLectures();

  expect(isLectureOnPhone(lecture.id)).toBe(false);
});

test('a refused copy says why, and claims nothing', async () => {
  readdir.mockResolvedValue({ files: [{ name: 'a-1.mp3', type: 'file' }] });
  await refreshDownloadedLectures();
  mockPhonePlugin.save.mockRejectedValue(new Error('المساحة ممتلئة'));

  await expect(requestLecturePhoneSave({ lecture, item: ITEM }, 'درس تجريبي')).resolves.toBe('failed');

  const snapshot = getLectureStoreSnapshot();
  expect(snapshot.phoneErrors.get(lecture.id)).toBe('المساحة ممتلئة');
  expect(snapshot.phoneSaved.has(lecture.id)).toBe(false);
  expect(snapshot.phoneSaving.has(lecture.id)).toBe(false);
});
