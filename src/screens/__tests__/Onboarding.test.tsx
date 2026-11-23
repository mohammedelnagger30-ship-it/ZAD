/**
 * First-run notification step must never hold the reader hostage to the system
 * permission dialog. Some OEM skins call the plugin back late — or not at all —
 * and the old flow waited for that promise (then opened the battery settings page)
 * while the button read «جارٍ الطلب...». The tap itself has to move the wizard on;
 * the answer is folded in later, if it ever arrives.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { jest } from '@jest/globals';
import type { Settings } from '@/db/database';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let resolvePermission: (granted: boolean) => void = () => undefined;
const permission = new Promise<boolean>((resolve) => {
  resolvePermission = resolve;
});
const requestNotificationPermission = jest.fn(() => permission);
const getProtectionStatus = jest.fn(async () => ({ ignoringBatteryOptimizations: false }));
const openProtectionSettings = jest.fn(async () => undefined);

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
jest.unstable_mockModule('@capacitor/app', () => ({
  App: { addListener: async () => ({ remove: () => undefined }) },
}));
jest.unstable_mockModule('@/utils/notifications', () => ({ requestNotificationPermission }));
jest.unstable_mockModule('@/utils/adhanOverlay', () => ({ getProtectionStatus, openProtectionSettings }));
jest.unstable_mockModule('@/hooks/useApp', () => ({
  useTheme: () => ({
    colorPalette: 'emerald',
    changeColorPalette: () => undefined,
    themeMode: 'light',
    changeTheme: () => undefined,
  }),
}));
jest.unstable_mockModule('@/utils/prayer/prayerTimes', () => ({
  CITY_PRESETS: [{ name: 'القاهرة', latitude: 30, longitude: 31, timeZone: 'Africa/Cairo' }],
}));
jest.unstable_mockModule('@/utils/colorThemes', () => ({
  COLOR_PALETTES: [
    { id: 'emerald', latin: 'emerald', color: '#10b981', accent: '#034', glow: '#10b98140' },
  ],
  FEATURED_COLOR_PALETTE_IDS: ['emerald'],
}));

const { Onboarding } = await import('@/screens/Onboarding');

let container: HTMLDivElement;
let root: Root;

function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => button!.click());
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  requestNotificationPermission.mockClear();
  getProtectionStatus.mockClear();
  openProtectionSettings.mockClear();
});

test('advances on tap without waiting for the permission dialog', async () => {
  await act(async () => {
    root.render(<Onboarding settings={{} as Settings} onComplete={() => undefined} />);
  });
  expect(container.textContent).toContain('مرحباً بك في قُرّة');

  click('ابدأ');
  expect(container.textContent).toContain('تفعيل التنبيهات');

  click('السماح بالتنبيهات');
  expect(requestNotificationPermission).toHaveBeenCalledTimes(1);
  // The promise is deliberately still pending — the wizard must already have moved.
  expect(container.textContent).toContain('اختر لونك المفضل');
  expect(container.textContent).not.toContain('جارٍ الطلب');
  expect(openProtectionSettings).not.toHaveBeenCalled();

  await act(async () => {
    resolvePermission(true);
    await permission;
  });
  await act(async () => {
    await Promise.resolve();
  });

  // The late answer is picked up without yanking the reader back a step or opening
  // a system settings page on their behalf.
  expect(container.textContent).toContain('اختر لونك المفضل');
  expect(getProtectionStatus).toHaveBeenCalledTimes(1);
  expect(openProtectionSettings).not.toHaveBeenCalled();
  expect(container.textContent).toContain('استثناء البطارية مطلوب');
});
