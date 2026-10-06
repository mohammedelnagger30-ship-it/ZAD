import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

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

export async function checkForAppUpdate(): Promise<AppUpdateCheck> {
  if (!Capacitor.isNativePlatform()) return { status: 'unavailable' };
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (response.status === 404) return { status: 'no-release' };
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
