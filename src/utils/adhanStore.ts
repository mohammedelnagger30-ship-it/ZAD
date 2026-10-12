import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import {
  ADHAN_SOUNDS,
  adhanDownloadUrl,
  getAdhanSound,
  type AdhanSound,
} from '@/data/adhanSounds';

/**
 * On-demand adhan voices, downloaded from the project repo and kept on the device.
 *
 * The bundled voices stay inside the app so a fresh install rings at prayer time with
 * no network at all. The remaining voices are published outside `public/` — they never
 * reach the APK — and are fetched once, when the user asks for them, exactly like the
 * downloadable hadith/tafsir collections: after that they play offline like any other
 * voice, including as the prayer notification's sound.
 *
 * Two things must agree for a downloaded voice to be usable end to end:
 *  - the WebView plays it through {@link resolveAdhanPlayUrl} (preview + adhan page), and
 *  - the Android notification channel rings it through {@link resolveAdhanSoundPath},
 *    which the scheduler hands to the native side, because a channel sound has to be a
 *    resource or a FileProvider URI — a bare URL will not do.
 */

/**
 * Sub-directory of the app's private files dir; it is also what the FileProvider
 * publishes (res/xml/file_paths.xml) so a prayer channel can ring a stored voice.
 */
const ADHAN_DIR = 'adhan_store';

type Listener = () => void;

/** Snapshot handed to React; replaced (never mutated) so subscriptions see a new value. */
let downloadedIds: ReadonlySet<string> = new Set();
let loaded = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToAdhanVoices(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function downloadedAdhanVoiceIds(): ReadonlySet<string> {
  return downloadedIds;
}

function pathOf(sound: AdhanSound): string {
  return `${ADHAN_DIR}/${sound.file}`;
}

async function fileUriOf(sound: AdhanSound): Promise<string | null> {
  try {
    const { uri } = await Filesystem.stat({ path: pathOf(sound), directory: Directory.Data });
    return uri && (uri as { size?: number }).size !== 0 ? uri : null;
  } catch {
    // stat rejects when the file is absent — the normal state before a download.
    return null;
  }
}

/**
 * Re-reads what is actually on disk. Deliberately a stat per voice rather than a list:
 * clearing storage behind the app's back (or a partial write) must never leave a voice
 * marked downloaded when there is nothing to play.
 */
export async function refreshDownloadedAdhanVoices(): Promise<ReadonlySet<string>> {
  const sounds = ADHAN_SOUNDS.filter((sound) => !sound.bundled);
  const entries = await Promise.all(
    sounds.map(async (sound): Promise<[string, boolean]> => [sound.id, (await fileUriOf(sound)) !== null]),
  );
  downloadedIds = new Set(entries.filter(([, ok]) => ok).map(([id]) => id));
  loaded = true;
  emit();
  return downloadedIds;
}

export class AdhanDownloadError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AdhanDownloadError';
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}

/**
 * Rejects anything that is not really an audio file. A broken link that answers 200
 * with an HTML page must not be saved as an adhan — the user would only find out the
 * next time the prayer comes in, with silence.
 */
function looksLikeAudio(blob: Blob, head: Uint8Array): boolean {
  if (blob.size < 50_000) return false;
  if (blob.type && !blob.type.startsWith('audio/')) return false;
  // No bytes to peek at (the response had no stream): size and type are all we have.
  if (head.length < 3) return true;
  const isId3 = head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33; // "ID3"
  const isMpegSync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  const isOgg = head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67; // "Ogg"
  return isId3 || isMpegSync || isOgg;
}

export async function ensureAdhanVoicesLoaded(): Promise<void> {
  if (loaded) return;
  await refreshDownloadedAdhanVoices();
}

/**
 * Downloads one voice and stores it, reporting progress as bytes arrive.
 *
 * Only the file itself is fetched; nothing about the user's choice changes until the
 * write succeeds, so an interrupted download can never leave the adhan pointing at a
 * voice that is not there.
 */
export async function downloadAdhanVoice(
  sound: AdhanSound,
  onProgress?: (progress: { received: number; total: number }) => void,
  signal?: AbortSignal,
): Promise<void> {
  const url = adhanDownloadUrl(sound);
  if (!url) throw new AdhanDownloadError('هذا الصوت غير متاح للتنزيل');

  let response: Response;
  try {
    response = await fetch(url, { signal, mode: 'cors', redirect: 'follow' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AdhanDownloadError('تعذّر الاتصال بمصدر الصوت', err);
  }
  if (!response.ok) {
    throw new AdhanDownloadError(
      response.status === 404 ? 'هذا الصوت غير متاح في المصدر' : `فشل تنزيل الصوت (${response.status})`,
    );
  }

  const declared = Number(response.headers.get('content-length') ?? 0) || sound.remote?.sizeBytes || 0;
  let blob: Blob;
  let head = new Uint8Array(0);
  if (!response.body) {
    blob = await response.blob();
    onProgress?.({ received: blob.size, total: blob.size });
  } else {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          onProgress?.({ received, total: declared });
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new AdhanDownloadError('انقطع تنزيل الصوت', err);
    } finally {
      reader.releaseLock();
    }
    head = chunks.length > 0 ? chunks[0].subarray(0, 4) : new Uint8Array(0);
    blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'audio/mpeg' });
    onProgress?.({ received, total: declared || received });
  }

  if (!looksLikeAudio(blob, head)) throw new AdhanDownloadError('المصدر أعاد ملفاً صوتياً غير صالح');

  const base64 = await blobToBase64(blob);
  await Filesystem.writeFile({
    path: pathOf(sound),
    data: base64,
    directory: Directory.Data,
    recursive: true,
  });

  downloadedIds = new Set(downloadedIds).add(sound.id);
  loaded = true;
  emit();
}

/** Removes a downloaded voice. Deleting a voice never touches the bundled ones. */
export async function deleteAdhanVoice(sound: AdhanSound): Promise<void> {
  if (sound.bundled) return;
  try {
    await Filesystem.deleteFile({ path: pathOf(sound), directory: Directory.Data });
  } catch {
    // Already gone — the state we are moving to anyway.
  }
  const next = new Set(downloadedIds);
  next.delete(sound.id);
  downloadedIds = next;
  emit();
}

/**
 * URL the WebView can play: the bundled asset for shipped voices, the stored file
 * (through Capacitor's local server) for downloaded ones, and the remote file as a last
 * resort in the browser dev build, where nothing has been stored yet.
 */
export async function resolveAdhanPlayUrl(sound: AdhanSound): Promise<string> {
  if (sound.bundled) return `/audio/${sound.file}`;
  const uri = await fileUriOf(sound);
  if (uri) return Capacitor.convertFileSrc(uri);
  return adhanDownloadUrl(sound) ?? `/audio/${sound.file}`;
}

/**
 * Absolute filesystem path of a stored voice, for the native notification channel —
 * null when there is nothing to point a channel at (web build, or not downloaded).
 */
export async function resolveAdhanSoundPath(sound: AdhanSound): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const uri = await fileUriOf(sound);
  return uri ? uri.replace(/^file:\/\//, '') : null;
}

/**
 * The voice the notifications should ring: the chosen one when it is usable, otherwise
 * the bundled default. Used by the scheduler so a voice that vanished from disk cannot
 * silence the adhan.
 */
export function usableAdhanSound(
  requestedId: string,
  downloaded: ReadonlySet<string> = downloadedIds,
): AdhanSound {
  const sound = getAdhanSound(requestedId);
  return sound.bundled || downloaded.has(sound.id) ? sound : getAdhanSound('makkah_masjid');
}
