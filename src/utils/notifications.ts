import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

// Low-level notification helpers: permission checks, ID generation and cancellation.
//
// Scheduling lives in `@/utils/notificationScheduler`, which owns the Capacitor channels
// and the id-allocation scheme. Earlier versions of this file also contained copies of
// `schedulePrayerNotifications` / `scheduleDailyTaskNotifications`; those duplicated the
// scheduler (with the same `genNotificationId` prefixes) and were never called.

// Generate unique notification IDs based on date + type
export function genNotificationId(prefix: number, date: Date, extra = 0): number {
  const stamp = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  return (prefix * 100000 + (stamp % 100000) + extra) % 2147483647;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    if ('Notification' in window) {
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }
    return false;
  }
  const perm = await LocalNotifications.requestPermissions();
  return perm.display === 'granted';
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return 'Notification' in window && Notification.permission === 'granted';
  }
  const perm = await LocalNotifications.checkPermissions();
  return perm.display === 'granted';
}

export async function cancelAllNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  }
}

export async function cancelNotification(id: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.cancel({ notifications: [{ id }] });
}