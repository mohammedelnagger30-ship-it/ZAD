import { Capacitor, registerPlugin } from '@capacitor/core';

/**
 * The copy of a lecture that lives outside the app.
 *
 * Everything the app keeps for itself sits in its private directory, where the phone
 * cannot see it: a lecture «saved» only there is saved for the app, not for the listener.
 * What is asked for is a file on the phone — one a file manager lists, another player
 * opens, a car stereo or an SD card can take — and that has to be written into shared
 * storage, into `Download/قُرّة`.
 *
 * That write is native work and only native work: Android's MediaStore will not take a
 * new download from a WebView, so a small plugin does it ({@link PhoneStorage} on the
 * Android side), and everything here is the seam that lets the rest of the app pretend it
 * is just another function call. Where the plugin is missing — an install built before it
 * existed, or a platform that has no public folder to offer at all — the caller falls back
 * to the share sheet, and this module simply reports that it is unavailable.
 *
 * The app keeps its own copy of every lecture as well. That is the file the in-app player
 * opens (the WebView cannot play a MediaStore URI), so the two are not alternatives: the
 * private copy is what plays offline inside the app, the public one is what the phone gets
 * to keep.
 */

interface PhoneStoragePlugin {
  list(): Promise<{ folder: string; files: { name: string; size: number }[] }>;
  save(options: { dir: string; file: string; name: string }): Promise<{ name: string; path: string }>;
  remove(options: { name: string }): Promise<{ removed: boolean }>;
}

const PhoneStorage = registerPlugin<PhoneStoragePlugin>('PhoneStorage');

/** Sub-directory of the app's private files dir, where the kept lectures live. */
export const LECTURE_DIR = 'lecture_store';

/** The folder the listener meets in the file manager: `Download/قُرّة`. */
export const PHONE_FOLDER = 'قُرّة';

/** True when a lecture can be handed to the phone's storage silently, in one step. */
export function isPhoneStorageAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PhoneStorage');
}

/** Every file currently in `Download/قُرّة`, by name — one call, not one per lecture. */
export async function listPhoneFiles(): Promise<ReadonlySet<string>> {
  const { files } = await PhoneStorage.list();
  return new Set(files.map((file) => file.name));
}

/** Copies the app's own `fileName` (under `LECTURE_DIR`) into `Download/قُرّة` as `name`. */
export function saveToPhone(
  fileName: string,
  name: string,
): Promise<{ name: string; path: string }> {
  return PhoneStorage.save({ dir: LECTURE_DIR, file: fileName, name });
}

/** Removes one file from `Download/قُرّة`. False when it was already gone. */
export async function removeFromPhone(name: string): Promise<boolean> {
  try {
    const { removed } = await PhoneStorage.remove({ name });
    return removed;
  } catch {
    return false;
  }
}

/** Characters no file system wants in a name, and none a lecture title needs. */
const UNSAFE_NAME = /[\\/:*?"<>|]/g;

/**
 * The name the file manager will show: the lecture's title, never its archive id.
 *
 * A file called `al-alheweny-043.mp3` is useless in a file manager — the listener has to
 * open it to know which lecture it is — so the title does the naming, cleaned of the
 * characters that would split it or hide it, and capped well under the 255 bytes a file
 * name may take (an Arabic character costs two or three of them).
 */
export function phoneFileName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_NAME, ' ')
    // eslint-disable-next-line no-control-regex -- control characters cannot survive a file name.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  const stem = cleaned.slice(0, 100).trim();
  return `${stem || 'محاضرة'}.mp3`;
}

// ---------------------------------------------------------------------------
// Which file belongs to which lecture
// ---------------------------------------------------------------------------

const MANIFEST_KEY = 'huwaini-phone-files';

/**
 * The names the app gave the files it saved: lecture id → file name.
 *
 * The phone folder knows only file names, and two lectures — «الدرس ١» in one course and
 * «الدرس ١» in another — would answer to the same one. This map is how the app knows which
 * of the files it wrote belongs to which lecture, and it is only ever a claim about the
 * app's own files: {@link listPhoneFiles} is asked whether each of them is still there.
 */
export function readPhoneManifest(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(MANIFEST_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const manifest: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === 'string' && name) manifest[id] = name;
    }
    return manifest;
  } catch {
    // A store that refuses to answer (private browsing, a full quota) costs the mapping,
    // never the files: they stay in the phone's folder either way.
    return {};
  }
}

export function writePhoneManifest(manifest: Record<string, string>): void {
  try {
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  } catch {
    // See above — losing the map means the next save writes a fresh copy beside the old.
  }
}
