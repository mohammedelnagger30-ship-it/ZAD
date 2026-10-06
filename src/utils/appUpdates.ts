import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

const GITHUB_RELEASE_API = 'https://api.github.com/repos/mohammedelnagger30-ship-it/ZAD/releases/latest';

export type AppUpdateCheck =
  | { status: 'available'; version: string; downloadUrl: string }
  | { status: 'current'; version: string }
  | { status: 'no-release' }
  | { status: 'unavailable' };

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

// GitHub allows only a handful of unauthenticated calls per hour, and the
// update banner plus the settings card both ask on mount and on resume.
const CHECK_CACHE_TTL_MS = 120_000;

let cachedCheck: { checkedAt: number; result: AppUpdateCheck } | null = null;
let checkInFlight: Promise<AppUpdateCheck> | null = null;

export async function checkForAppUpdate(): Promise<AppUpdateCheck> {
  if (!Capacitor.isNativePlatform()) return { status: 'unavailable' };
  if (cachedCheck && Date.now() - cachedCheck.checkedAt < CHECK_CACHE_TTL_MS) return cachedCheck.result;
  if (checkInFlight) return checkInFlight;

  checkInFlight = fetchUpdateCheck()
    .then((result) => {
      cachedCheck = { checkedAt: Date.now(), result };
      return result;
    })
    .finally(() => {
      checkInFlight = null;
    });
  return checkInFlight;
}

async function fetchUpdateCheck(): Promise<AppUpdateCheck> {
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (response.status === 404) return { status: 'no-release' };
  if (response.status === 403 || response.status === 429) {
    throw new Error('تم تجاوز حد طلبات التحقق مؤقتًا — أعد المحاولة بعد دقائق.');
  }
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}.`);

  const release: unknown = await response.json();
  if (!release || typeof release !== 'object') throw new Error('GitHub returned an invalid release record.');
  const data = release as {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  if (data.draft === true || data.prerelease === true || typeof data.tag_name !== 'string') {
    return { status: 'no-release' };
  }
  const releaseVersion = data.tag_name.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error('Release tag must use vMAJOR.MINOR.PATCH.');
  if (!Array.isArray(data.assets)) throw new Error('GitHub release has no asset list.');
  const asset = data.assets.find((item): item is { name: string; browser_download_url: string } =>
    !!item &&
    typeof item === 'object' &&
    'name' in item &&
    item.name === `ZAD-v${releaseVersion}.apk` &&
    'browser_download_url' in item &&
    typeof item.browser_download_url === 'string'
  );
  if (!asset) throw new Error(`Release ${releaseVersion} is missing its APK.`);

  const { version: installedVersion } = await App.getInfo();
  if (compareVersions(releaseVersion, installedVersion.replace(/^v/, '')) <= 0) {
    return { status: 'current', version: installedVersion };
  }
  // Use the raw download URL to ensure browser downloads the file instead of trying to open it
  const downloadUrl = asset.browser_download_url;
  return { status: 'available', version: releaseVersion, downloadUrl };
}

// ---------------------------------------------------------------------------
// In-app updater: the APK is downloaded by the native plugin and handed to the
// Android package installer. Opening the release URL in the device browser used
// to stall after the progress bar filled, leaving users with no file to open.
// ---------------------------------------------------------------------------

export interface UpdateProgress {
  /** Bytes written so far. */
  loaded: number;
  /** Expected size in bytes, or 0 when the server did not report it. */
  total: number;
  /** 0-99 while streaming, 100 when finished, -1 when the total is unknown. */
  percent: number;
}

export type InstallOutcome = 'launched' | 'permission-required';

interface AppUpdaterPlugin {
  download(options: { url: string; fileName: string }): Promise<{ path: string; size: number }>;
  cancel(): Promise<void>;
  canInstall(): Promise<{ granted: boolean }>;
  install(options: { path: string }): Promise<{ status: InstallOutcome }>;
  addListener(eventName: 'progress', listenerFunc: (event: UpdateProgress) => void): Promise<PluginListenerHandle>;
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export interface PendingUpdate {
  version: string;
  path: string;
}

const PENDING_UPDATE_KEY = 'hifzi-pending-update';

/** The in-app installer only exists in the native build. */
export function isUpdateInstallerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('AppUpdater');
}

/** Reads the APK that was downloaded but not installed yet (survives screen changes). */
export function readPendingUpdate(): PendingUpdate | null {
  try {
    const raw = localStorage.getItem(PENDING_UPDATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { version, path } = parsed as { version?: unknown; path?: unknown };
    if (typeof version !== 'string' || typeof path !== 'string') return null;
    return { version, path };
  } catch {
    return null;
  }
}

export function clearPendingUpdate(): void {
  try {
    localStorage.removeItem(PENDING_UPDATE_KEY);
  } catch {
    // Storage may be unavailable; the native file check still protects installs.
  }
}

/** Extracts the Capacitor error code, when the native side provided one. */
export function getErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const { code } = error as { code?: unknown };
    if (typeof code === 'string') return code;
  }
  return null;
}

/** Builds a JS error carrying a Capacitor-style code, so callers can branch on it. */
function codedError(message: string, code: string): Error {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

export async function downloadAppUpdate(
  url: string,
  version: string,
  onProgress: (progress: UpdateProgress) => void,
): Promise<void> {
  if (!isUpdateInstallerAvailable()) {
    throw codedError('تنزيل التحديث داخل التطبيق غير متاح على هذا الجهاز.', 'installer-unavailable');
  }
  const listener = await AppUpdater.addListener('progress', onProgress);
  try {
    const result = await AppUpdater.download({ url, fileName: `ZAD-v${version}.apk` });
    localStorage.setItem(PENDING_UPDATE_KEY, JSON.stringify({ version, path: result.path }));
  } finally {
    await listener.remove().catch(() => undefined);
  }
}

export async function cancelAppUpdateDownload(): Promise<void> {
  if (!isUpdateInstallerAvailable()) return;
  await AppUpdater.cancel();
}

let installInFlight = false;

/** Opens the system installer, or the unknown-sources screen when permission is missing. */
export async function installAppUpdate(path: string): Promise<InstallOutcome> {
  if (!isUpdateInstallerAvailable()) {
    throw codedError('تثبيت التحديث داخل التطبيق غير متاح على هذا الجهاز.', 'installer-unavailable');
  }
  if (installInFlight) {
    throw codedError('تم فتح شاشة التثبيت بالفعل.', 'already-launching');
  }
  installInFlight = true;
  try {
    const result = await AppUpdater.install({ path });
    return result.status;
  } finally {
    installInFlight = false;
  }
}

export async function isInstallPermissionGranted(): Promise<boolean> {
  if (!isUpdateInstallerAvailable()) return false;
  const result = await AppUpdater.canInstall();
  return result.granted === true;
}

/** Fallback for devices where the in-app installer is unavailable. */
export async function openUpdateInBrowser(url: string): Promise<void> {
  await Browser.open({ url });
}
