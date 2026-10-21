import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { HuwainiLecture } from '@/data/scholarHuwaini';
import {
  isPhoneStorageAvailable,
  listPhoneFiles,
  phoneFileName,
  readPhoneManifest,
  removeFromPhone,
  saveToPhone,
  writePhoneManifest,
} from '@/utils/phoneStorage';

/**
 * Lectures kept on the device, downloaded from archive.org on request.
 *
 * A lecture is long — twenty minutes to two hours, ten to sixty megabytes — so it is
 * never bundled with the app and never fetched "just in case": the library streams while
 * there is a connection, and only what the listener asks to keep is written to disk.
 * Once kept, it plays like anything else and needs no network at all.
 *
 * Downloads are written in chunks ({@link CHUNK_BYTES}) through Capacitor's filesystem,
 * not as one base64 blob: a single `writeFile` of a sixty-megabyte lecture would need the
 * whole file twice over in memory (the bytes and their base64 text) at once, which is
 * exactly the kind of allocation a phone punishes. Appending fixed-size chunks keeps the
 * peak at one chunk plus its encoding.
 *
 * The queue lives here rather than in the screen so a download the listener started in
 * the صفحة الشيخ keeps going when they walk away — and comes back with its progress
 * intact.
 */

/** Sub-directory of the app's private files dir, alongside `adhan_store`. */
const LECTURE_DIR = 'lecture_store';

/**
 * Bytes buffered before a chunk is encoded and appended. A multiple of three so each
 * chunk lands on a base64 boundary and needs no padding — the plugin decodes every
 * `appendFile` independently, and padded chunks are the one thing worth avoiding.
 */
const CHUNK_BYTES = 3 * 1024 * 1024;

/** How often progress is published, in milliseconds. Chunks arrive far faster than that. */
const PROGRESS_INTERVAL_MS = 250;

export interface LectureDownloadEntry {
  status: 'downloading' | 'error';
  received: number;
  total: number;
  error?: string;
}

/** One lecture and the archive.org item that holds it. */
export interface LectureSource {
  lecture: HuwainiLecture;
  item: string;
}

interface LectureStoreSnapshot {
  /** Ids whose file is on disk right now. */
  downloaded: ReadonlySet<string>;
  /** Ids being fetched, with how far each has got. */
  downloads: ReadonlyMap<string, LectureDownloadEntry>;
  /** Ids with a copy in the phone's own `Download/قُرّة`, outside the app. */
  phoneSaved: ReadonlySet<string>;
  /** Ids being handed to that folder right now. */
  phoneSaving: ReadonlySet<string>;
  /** Why the last «حفظ على الهاتف» failed, per lecture. */
  phoneErrors: ReadonlyMap<string, string>;
}

type Listener = () => void;

let downloadedIds: ReadonlySet<string> = new Set();
let activeDownloads: ReadonlyMap<string, LectureDownloadEntry> = new Map();
let phoneSavedIds: ReadonlySet<string> = new Set();
let phoneSavingIds: ReadonlySet<string> = new Set();
let phoneErrorEntries: ReadonlyMap<string, string> = new Map();
let snapshot: LectureStoreSnapshot = {
  downloaded: downloadedIds,
  downloads: activeDownloads,
  phoneSaved: phoneSavedIds,
  phoneSaving: phoneSavingIds,
  phoneErrors: phoneErrorEntries,
};
let loaded = false;

const listeners = new Set<Listener>();

function emit(): void {
  snapshot = {
    downloaded: downloadedIds,
    downloads: activeDownloads,
    phoneSaved: phoneSavedIds,
    phoneSaving: phoneSavingIds,
    phoneErrors: phoneErrorEntries,
  };
  for (const listener of listeners) listener();
}

export function subscribeToLectureStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLectureStoreSnapshot(): LectureStoreSnapshot {
  return snapshot;
}

export function downloadedLectureIds(): ReadonlySet<string> {
  return downloadedIds;
}

const PARTIAL_SUFFIX = '.part';

function fileNameOf(id: string): string {
  return `${id}.mp3`;
}

function pathOf(id: string): string {
  return `${LECTURE_DIR}/${fileNameOf(id)}`;
}

/**
 * Where a download is written until it is whole.
 *
 * The app can be killed mid-download — the phone is closed, the tab is swiped away — and a
 * half-written `.mp3` would be indistinguishable from a complete one: it would be listed
 * as downloaded and play as a truncated lecture. So the bytes land in `.part` and the file
 * only earns its `.mp3` name by being renamed once the last byte is in.
 */
function partialPathOf(id: string): string {
  return `${LECTURE_DIR}/${id}${PARTIAL_SUFFIX}`;
}

export class LectureDownloadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'LectureDownloadError';
  }
}

/**
 * Rebuilds the downloaded set from what is actually on disk — one directory listing, not
 * a `stat` per lecture: the library holds hundreds, and a listing is a single call.
 */
export async function refreshDownloadedLectures(): Promise<ReadonlySet<string>> {
  try {
    const { files } = await Filesystem.readdir({ path: LECTURE_DIR, directory: Directory.Data });
    const names = files.map((file) => file.name);
    downloadedIds = new Set(
      names
        .filter((name) => name.toLowerCase().endsWith('.mp3'))
        .map((name) => name.slice(0, -4)),
    );
    // Leftovers from a download that never finished. Nothing lists them, so they would
    // grow forever; the first listing after a restart is the natural place to sweep them.
    // A `.part` belonging to a download that is running right now is not a leftover.
    const inFlight = new Set(activeDownloads.keys());
    await Promise.all(
      names
        .filter(
          (name) =>
            name.endsWith(PARTIAL_SUFFIX) &&
            !inFlight.has(name.slice(0, -PARTIAL_SUFFIX.length)),
        )
        .map((name) =>
          Filesystem.deleteFile({ path: `${LECTURE_DIR}/${name}`, directory: Directory.Data }).catch(
            () => undefined,
          ),
        ),
    );
  } catch {
    // The directory does not exist until the first download — nothing is stored.
    downloadedIds = new Set();
  }
  await refreshPhoneFiles();
  loaded = true;
  emit();
  return downloadedIds;
}

/**
 * Rebuilds what the phone holds from the folder itself.
 *
 * The manifest says which file belongs to which lecture; the folder decides whether that
 * is still true — the listener may have deleted a lecture from the file manager, and the
 * app must not claim a file it can no longer find. Nothing happens on a platform with no
 * phone folder to list: there the hand-out is a share sheet, and there is nothing to
 * check it against.
 */
async function refreshPhoneFiles(): Promise<void> {
  if (!isPhoneStorageAvailable()) return;
  try {
    const names = await listPhoneFiles();
    const kept: Record<string, string> = {};
    let dropped = false;
    for (const [id, name] of Object.entries(readPhoneManifest())) {
      if (names.has(name)) kept[id] = name;
      else dropped = true;
    }
    if (dropped) writePhoneManifest(kept);
    phoneSavedIds = new Set(Object.keys(kept));
  } catch {
    // The plugin may be missing from a build that predates it; the button then simply
    // offers to save again rather than claiming a folder it cannot read.
    phoneSavedIds = new Set();
  }
}

export async function ensureLectureStoreLoaded(): Promise<void> {
  if (loaded) return;
  await refreshDownloadedLectures();
}

/**
 * The catalogue — 840 recordings — is loaded only when a lecture is actually resolved,
 * never with the app: it is not worth several tens of kilobytes of first-paint bundle for
 * a page most listeners open after the app has already started.
 */
type CatalogModule = typeof import('@/data/scholarHuwaini');
let catalogPromise: Promise<CatalogModule> | null = null;

function loadCatalog(): Promise<CatalogModule> {
  catalogPromise ??= import('@/data/scholarHuwaini');
  return catalogPromise;
}

/**
 * URL the WebView should play: the stored file when it has been kept, the archive.org
 * stream otherwise. Callers never have to know which case they are in.
 */
export async function resolveLecturePlayUrl(lecture: HuwainiLecture, item: string): Promise<string> {
  const { huwayniLectureUrl } = await loadCatalog();
  const remote = huwayniLectureUrl(item, lecture.file);
  // On the web the filesystem is an IndexedDB shim with no URL an <audio> can open, so a
  // kept lecture still has to be streamed there. On a device the stored file is the point.
  if (!downloadedIds.has(lecture.id) || !Capacitor.isNativePlatform()) return remote;
  try {
    const { uri } = await Filesystem.stat({ path: pathOf(lecture.id), directory: Directory.Data });
    if (uri) return Capacitor.convertFileSrc(uri);
  } catch {
    // Listed but unreadable — fall through to the stream rather than play silence.
  }
  return remote;
}

/** True when `id` is on disk and can therefore be played without a connection. */
export function isLectureDownloaded(id: string): boolean {
  return downloadedIds.has(id);
}

// ---------------------------------------------------------------------------
// Progress bookkeeping
// ---------------------------------------------------------------------------

function setDownloads(next: ReadonlyMap<string, LectureDownloadEntry>): void {
  activeDownloads = next;
  emit();
}

function patchDownload(id: string, entry: LectureDownloadEntry | null): void {
  const next = new Map(activeDownloads);
  if (entry) next.set(id, entry);
  else next.delete(id);
  setDownloads(next);
}

// ---------------------------------------------------------------------------
// The download itself
// ---------------------------------------------------------------------------

/**
 * Rejects a response that is not audio. archive.org answers a missing file with an HTML
 * error page under a 200, and saving that as a lecture would only be discovered later,
 * on a plane, with nothing to play.
 */
function looksLikeAudio(head: Uint8Array, contentType: string | null): boolean {
  if (head.length >= 3) {
    const id3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33;
    const mpeg = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
    const ogg = head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67;
    if (id3 || mpeg || ogg) return true;
  }
  return Boolean(contentType && contentType.startsWith('audio/'));
}

/** Base64 for one chunk, without spreading a multi-megabyte array onto the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

async function writeChunk(id: string, bytes: Uint8Array, first: boolean): Promise<void> {
  const data = toBase64(bytes);
  if (first) {
    await Filesystem.writeFile({
      path: partialPathOf(id),
      data,
      directory: Directory.Data,
      recursive: true,
    });
  } else {
    await Filesystem.appendFile({ path: partialPathOf(id), data, directory: Directory.Data });
  }
}

/** Gives a fully written download its final name — the only way it becomes "downloaded". */
async function finishLecture(id: string): Promise<void> {
  await Filesystem.rename({
    from: partialPathOf(id),
    to: pathOf(id),
    directory: Directory.Data,
  });
}

async function discardPartial(id: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path: partialPathOf(id), directory: Directory.Data });
  } catch {
    // Nothing was written, or it is already gone — either way there is nothing to undo.
  }
}

async function downloadLecture(source: LectureSource, signal: AbortSignal): Promise<void> {
  const { lecture, item } = source;
  const { huwayniLectureUrl } = await loadCatalog();
  const url = huwayniLectureUrl(item, lecture.file);

  let response: Response;
  try {
    response = await fetch(url, { signal, mode: 'cors', redirect: 'follow' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new LectureDownloadError('تعذّر الاتصال بمصدر المحاضرة', err);
  }
  if (!response.ok) {
    throw new LectureDownloadError(
      response.status === 404 ? 'هذه المحاضرة غير متاحة في المصدر' : `فشل التنزيل (${response.status})`,
    );
  }

  const contentType = response.headers.get('content-type');
  const declared = Number(response.headers.get('content-length') ?? 0) || lecture.bytes || 0;
  let received = 0;
  let lastReport = 0;
  const report = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastReport < PROGRESS_INTERVAL_MS) return;
    lastReport = now;
    patchDownload(lecture.id, { status: 'downloading', received, total: declared || received });
  };

  const reader = response.body?.getReader();
  if (!reader) {
    // No streaming body (older WebViews): the whole file has to be buffered anyway.
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!looksLikeAudio(bytes.subarray(0, 3), contentType)) {
      throw new LectureDownloadError('المصدر أعاد ملفاً صوتياً غير صالح');
    }
    received = bytes.length;
    report(true);
    await writeChunk(lecture.id, bytes, true);
    await finishLecture(lecture.id);
    return;
  }

  const buffer = new Uint8Array(CHUNK_BYTES);
  let offset = 0;
  let first = true;
  let checked = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      if (!checked) {
        if (!looksLikeAudio(value.subarray(0, 3), contentType)) {
          throw new LectureDownloadError('المصدر أعاد ملفاً صوتياً غير صالح');
        }
        checked = true;
      }

      let view = value;
      while (view.length > 0) {
        const take = Math.min(CHUNK_BYTES - offset, view.length);
        buffer.set(view.subarray(0, take), offset);
        offset += take;
        received += take;
        view = view.subarray(take);
        if (offset === CHUNK_BYTES) {
          await writeChunk(lecture.id, buffer, first);
          first = false;
          offset = 0;
        }
      }
      // Progress follows the network, not the buffer: with 3 MB chunks a twenty-megabyte
      // lecture would otherwise sit at 0% for half a minute and look stuck.
      report(false);
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    if (err instanceof LectureDownloadError) throw err;
    throw new LectureDownloadError('انقطع تنزيل المحاضرة', err);
  } finally {
    reader.releaseLock();
  }

  if (!checked) throw new LectureDownloadError('لم تصل أي بيانات من المصدر');
  if (offset > 0) await writeChunk(lecture.id, buffer.subarray(0, offset), first);
  report(true);
  await finishLecture(lecture.id);
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

let queue: LectureSource[] = [];
let running = false;
const controllers = new Map<string, AbortController>();

/** Lectures waiting for their download to land before they can be handed to the phone. */
const awaitingPhoneSave = new Map<string, string>();

function isPending(id: string): boolean {
  return controllers.has(id) || queue.some((entry) => entry.lecture.id === id);
}

/** Queue lectures for download. Already-kept or already-queued ones are ignored. */
export function enqueueLectureDownloads(sources: LectureSource[]): void {
  let added = false;
  for (const source of sources) {
    if (downloadedIds.has(source.lecture.id) || isPending(source.lecture.id)) continue;
    queue.push(source);
    added = true;
  }
  if (added) void runQueue();
}

async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const source = queue.shift() as LectureSource;
      const id = source.lecture.id;
      if (downloadedIds.has(id)) continue;

      const controller = new AbortController();
      controllers.set(id, controller);
      patchDownload(id, { status: 'downloading', received: 0, total: source.lecture.bytes });
      try {
        await downloadLecture(source, controller.signal);
        downloadedIds = new Set(downloadedIds).add(id);
        loaded = true;
        patchDownload(id, null);
        // A lecture asked to be saved to the phone is only half done while it sits in
        // the app's own store: the download was the means, the hand-out is the point —
        // and the hand-out includes the share sheet, since «تنزيل» is a single tap that
        // is meant to leave the app with the file in hand.
        const label = awaitingPhoneSave.get(id);
        if (label !== undefined) {
          awaitingPhoneSave.delete(id);
          void saveLectureToPhone(source, label, { share: true });
        }
      } catch (err) {
        await discardPartial(id);
        if ((err as Error).name === 'AbortError') {
          patchDownload(id, null);
        } else {
          patchDownload(id, {
            status: 'error',
            received: 0,
            total: source.lecture.bytes,
            error: (err as Error).message || 'فشل تنزيل المحاضرة',
          });
        }
      } finally {
        controllers.delete(id);
      }
    }
  } finally {
    running = false;
  }
}

/** Stop one queued or in-flight download and remove its half-written file. */
export function cancelLectureDownload(id: string): void {
  queue = queue.filter((entry) => entry.lecture.id !== id);
  controllers.get(id)?.abort();
  awaitingPhoneSave.delete(id);
  patchDownload(id, null);
}

export function cancelAllLectureDownloads(): void {
  queue = [];
  awaitingPhoneSave.clear();
  for (const controller of controllers.values()) controller.abort();
  if (activeDownloads.size > 0) setDownloads(new Map());
}

/** Forget a finished download error so the row goes back to offering the download. */
export function dismissLectureError(id: string): void {
  const entry = activeDownloads.get(id);
  if (entry?.status === 'error') patchDownload(id, null);
}

/** Remove a kept lecture from the device. */
export async function deleteLectureDownload(id: string): Promise<void> {
  cancelLectureDownload(id);
  try {
    await Filesystem.deleteFile({ path: pathOf(id), directory: Directory.Data });
  } catch {
    // Already gone — the state we are moving to anyway.
  }
  const next = new Set(downloadedIds);
  next.delete(id);
  downloadedIds = next;
  emit();
}

/**
 * Remove everything downloaded. The directory listing is the source of truth, so a file
 * left behind by a crashed write cannot survive this.
 */
export async function deleteAllLectureDownloads(): Promise<void> {
  cancelAllLectureDownloads();
  let names: string[] = [];
  try {
    const { files } = await Filesystem.readdir({ path: LECTURE_DIR, directory: Directory.Data });
    names = files.map((file) => file.name);
  } catch {
    names = [];
  }
  await Promise.all(
    names.map((name) =>
      Filesystem.deleteFile({ path: `${LECTURE_DIR}/${name}`, directory: Directory.Data }).catch(
        () => undefined,
      ),
    ),
  );
  downloadedIds = new Set();
  emit();
}

// ---------------------------------------------------------------------------
// Handing a lecture to the phone
// ---------------------------------------------------------------------------

/**
 * What became of a «حفظ على الهاتف».
 *
 * - `phone`: the file is in the phone's own `Download/قُرّة`, written silently — the only
 *   outcome the app can check on later.
 * - `shared`: the platform has no public folder the app may write into (iOS), so the file
 *   was handed to the system share sheet and the listener chose where it went.
 * - `downloaded`: on the web the browser's own download did it, and the file landed in the *   computer's downloads.
 * - `failed`: nothing left the app; the reason is in the snapshot's `phoneErrors`.
 */
export type PhoneSaveOutcome = 'phone' | 'shared' | 'downloaded' | 'failed';

/** True while a lecture has a copy waiting in `Download/قُرّة`. */
export function isLectureOnPhone(id: string): boolean {
  return phoneSavedIds.has(id);
}

function setPhoneSaving(id: string, saving: boolean): void {
  const next = new Set(phoneSavingIds);
  if (saving) next.add(id);
  else next.delete(id);
  phoneSavingIds = next;
  emit();
}

function setPhoneError(id: string, error?: string): void {
  const next = new Map(phoneErrorEntries);
  if (error) next.set(id, error);
  else next.delete(id);
  phoneErrorEntries = next;
}

function rememberPhoneFile(id: string, name: string): void {
  writePhoneManifest({ ...readPhoneManifest(), [id]: name });
  phoneSavedIds = new Set(phoneSavedIds).add(id);
}

/**
 * Put a lecture where the phone can see it, and offer to share it on the way.
 *
 * One button, two promises kept: the file lands in the phone's own `Download/قُرّة` — so a
 * file manager or a music player can find it — and, on a platform that has a share sheet,
 * the sheet opens on the same tap so the lecture can be sent to WhatsApp, Telegram or
 * anywhere else. The listener asked for «تنزيل», and what they meant was "get this out of
 * the app and into my hands", which is exactly these two things together.
 *
 * The bytes have to be here first: the copy is made from the file the app kept, never
 * fetched twice, and on the platforms with no folder to write into there is nothing to
 * hand over until the download has landed. A lecture that is not kept yet is therefore
 * queued, and goes out the moment it is.
 *
 * `label` is what the file will be called — the lecture's title, never its archive id.
 */
export async function requestLecturePhoneSave(
  source: LectureSource,
  label: string,
): Promise<PhoneSaveOutcome | 'queued'> {
  const { lecture } = source;
  if (phoneSavingIds.has(lecture.id)) return 'queued';
  if (downloadedIds.has(lecture.id)) return saveLectureToPhone(source, label, { share: true });
  awaitingPhoneSave.set(lecture.id, label);
  enqueueLectureDownloads([source]);
  return 'queued';
}

/**
 * Share a lecture that is already kept, with no second download.
 *
 * The row calls this once a lecture is on the phone: the file is copied into the cache
 * under its title and handed to the system share sheet. On the web there is no sheet, so
 * the browser's own download stands in for it.
 */
export async function shareLecture(source: LectureSource, label: string): Promise<PhoneSaveOutcome | 'queued'> {
  const id = source.lecture.id;
  if (!downloadedIds.has(id)) {
    // Nothing to share yet: queue the download and let the save step open the sheet.
    awaitingPhoneSave.set(id, label);
    enqueueLectureDownloads([source]);
    return 'queued';
  }
  return saveLectureToPhone(source, label, { share: true });
}

/**
 * Write the kept lecture where the platform can take it from.
 *
 * `share` is what makes «تنزيل» one button instead of two: the file goes into the phone's
 * own `Download/قُرّة` folder — where a file manager and a music player can find it — and
 * the share sheet opens on the same tap, so the lecture can be sent to WhatsApp, Telegram
 * or anywhere else without a second decision. When no such folder exists (iOS, the web)
 * the share sheet — or the browser's download — is the whole of it.
 */
async function saveLectureToPhone(
  source: LectureSource,
  label: string,
  { share = false }: { share?: boolean } = {},
): Promise<PhoneSaveOutcome> {
  const { lecture } = source;
  const id = lecture.id;
  setPhoneSaving(id, true);
  setPhoneError(id);
  try {
    const name = phoneFileName(label);
    if (isPhoneStorageAvailable()) {
      // The silent path: a real file in the phone's own folder, no dialog in sight.
      const saved = await saveToPhone(fileNameOf(id), name);
      rememberPhoneFile(id, saved.name);
      if (share && Capacitor.isNativePlatform()) await shareLectureFile(id, name);
      return 'phone';
    }
    if (Capacitor.isNativePlatform()) {
      await shareLectureFile(id, name);
    } else {
      await handFileToBrowser(id, name);
    }
    // Neither a share sheet nor a browser download can be looked up afterwards, so the
    // row claims «على الهاتف» for as long as this session runs, and offers the save
    // again after a restart rather than guess at a folder it cannot read.
    phoneSavedIds = new Set(phoneSavedIds).add(id);
    return Capacitor.isNativePlatform() ? 'shared' : 'downloaded';
  } catch (err) {
    setPhoneError(id, (err as Error).message || 'تعذّر حفظ المحاضرة على الهاتف');
    return 'failed';
  } finally {
    setPhoneSaving(id, false);
  }
}

/**
 * Hands the stored lecture to the system share sheet, under a name worth keeping.
 *
 * The sheet shows the file's own name, and the stored one is the lecture's archive id —
 * so the file is copied into the cache under its title first, the way the recitation
 * exports do it.
 */
async function shareLectureFile(id: string, name: string): Promise<void> {
  const { Share } = await import('@capacitor/share');
  const { uri } = await Filesystem.copy({
    from: pathOf(id),
    to: name,
    directory: Directory.Data,
    toDirectory: Directory.Cache,
  });
  await Share.share({ files: [uri], title: name, dialogTitle: 'مشاركة المحاضرة' });
}

/**
 * Hands the stored lecture to the browser, which saves it like any other download: the
 * web's answer to a public folder, and the one way a file leaves the app without native
 * code behind it.
 */
async function handFileToBrowser(id: string, name: string): Promise<void> {
  const { data } = await Filesystem.readFile({ path: pathOf(id), directory: Directory.Data });
  // The store holds the download as base64 — that is what the chunks were written as,
  // and what a read without an encoding hands back — so this is the file itself.
  if (typeof data !== 'string' || !data) throw new Error('تعذّر قراءة الملف المحفوظ');
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Take every lecture this app wrote out of `Download/قُرّة`.
 *
 * Only what the manifest names: a file the listener copied there themselves — or renamed * on the way — is theirs, and is left alone.
 */
export async function deleteAllPhoneLectures(): Promise<void> {
  await Promise.all(Object.values(readPhoneManifest()).map((name) => removeFromPhone(name)));
  writePhoneManifest({});
  phoneSavedIds = new Set();
  emit();
}
