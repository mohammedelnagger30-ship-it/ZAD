/**
 * A permission request on an OEM build can stay pending forever. The helper has to
 * stop waiting after one bounded budget, and read the real system state with what is
 * left of that budget instead of starting a second full timeout.
 */
import { jest } from '@jest/globals';

let settleRequest: (result: { display: string }) => void = () => undefined;
const stuckRequest = new Promise<{ display: string }>((resolve) => {
  settleRequest = resolve;
});
const requestPermissions = jest.fn(() => stuckRequest);
const checkPermissions = jest.fn(async () => ({ display: 'granted' }));

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));
jest.unstable_mockModule('@capacitor/local-notifications', () => ({
  LocalNotifications: { requestPermissions, checkPermissions },
}));

const { requestNotificationPermission, NOTIFICATION_PERMISSION_TIMEOUT_MS } = await import(
  '@/utils/notifications'
);

afterEach(() => {
  jest.useRealTimers();
  requestPermissions.mockClear();
  checkPermissions.mockClear();
});

test('answers from the system state within one budget when the request never settles', async () => {
  jest.useFakeTimers();
  const started = Date.now();
  const result = requestNotificationPermission();

  await jest.advanceTimersByTimeAsync(NOTIFICATION_PERMISSION_TIMEOUT_MS + 300);
  await expect(result).resolves.toBe(true);

  expect(checkPermissions).toHaveBeenCalledTimes(1);
  expect(Date.now() - started).toBeLessThanOrEqual(NOTIFICATION_PERMISSION_TIMEOUT_MS + 300);
  expect(jest.getTimerCount()).toBe(0);
  // A late reply from the plugin is harmless once the flow has moved on.
  settleRequest({ display: 'denied' });
  await Promise.resolve();
});

test('uses the plugin answer directly when it arrives', async () => {
  requestPermissions.mockImplementationOnce(async () => ({ display: 'denied' }));
  await expect(requestNotificationPermission()).resolves.toBe(false);
  expect(checkPermissions).not.toHaveBeenCalled();
});
