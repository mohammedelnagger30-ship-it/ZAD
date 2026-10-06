import { useState, useEffect, useCallback, useRef } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { Settings } from '@/db/database';
import { calculatePrayerTimes, getPrayerTimeZone } from '@/utils/prayerTimes';
import { todayKey } from '@/utils/dateUtils';
import type { PrayerKey } from '@/utils/prayerTracker';

import type { PluginListenerHandle } from '@capacitor/core';

export interface AzanTriggerState {
  isOpen: boolean;
  prayerKey: PrayerKey;
  prayerName?: string;
  prayerTime?: Date;
  isPreview?: boolean;
}

export function useAzanTrigger(settings: Settings | null) {
  const [azanState, setAzanState] = useState<AzanTriggerState>({
    isOpen: false,
    prayerKey: 'fajr',
    isPreview: false,
  });

  const lastTriggeredRef = useRef<Record<string, boolean>>({});

  const triggerAzan = useCallback(
    (prayerKey: PrayerKey, prayerName?: string, prayerTime?: Date, isPreview = false) => {
      setAzanState({
        isOpen: true,
        prayerKey,
        prayerName,
        prayerTime,
        isPreview,
      });
    },
    []
  );

  const closeAzan = useCallback(() => {
    setAzanState((prev) => ({ ...prev, isOpen: false, isPreview: false }));
  }, []);

  // 1. Listen for Capacitor Local Notifications (Received & Clicked)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let recSub: PluginListenerHandle | undefined;
    let actSub: PluginListenerHandle | undefined;

    const setupListeners = async () => {
      try {
        recSub = await LocalNotifications.addListener(
          'localNotificationReceived',
          (notification) => {
            const extra = notification.extra;
            if (extra && extra.type === 'prayer' && extra.prayerKey) {
              triggerAzan(
                extra.prayerKey as PrayerKey,
                extra.prayerName,
                extra.time ? new Date(extra.time) : undefined,
                false
              );
            }
          }
        );

        actSub = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action) => {
            const extra = action.notification?.extra;
            if (extra && extra.type === 'prayer' && extra.prayerKey) {
              triggerAzan(
                extra.prayerKey as PrayerKey,
                extra.prayerName,
                extra.time ? new Date(extra.time) : undefined,
                false
              );
            }
          }
        );
      } catch (err) {
        console.warn('LocalNotification listener setup failed:', err);
      }
    };

    void setupListeners();

    return () => {
      recSub?.remove?.();
      actSub?.remove?.();
    };
  }, [triggerAzan]);

  // 2. Foreground check loop: Check every 15 seconds if prayer time reached now
  useEffect(() => {
    if (!settings || settings.latitude == null || settings.longitude == null) return;

    const interval = setInterval(() => {
      const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
      const now = new Date();
      const today = todayKey();
      const prayerResult = calculatePrayerTimes(
        settings.latitude!,
        settings.longitude!,
        now,
        settings.calcMethod,
        settings.asrMadhab,
        timeZone
      );

      for (const prayer of prayerResult.prayers) {
        if (prayer.name === 'sunrise') continue;

        const diffMs = Math.abs(now.getTime() - prayer.time.getTime());
        const triggerId = `${today}_${prayer.name}`;

        // If time is within 45 seconds of prayer time and hasn't been triggered yet
        if (diffMs <= 45000 && !lastTriggeredRef.current[triggerId]) {
          lastTriggeredRef.current[triggerId] = true;
          triggerAzan(prayer.name as PrayerKey, prayer.arabicName, prayer.time, false);
          break;
        }
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [settings, triggerAzan]);

  // 3. Listen for custom window event (e.g. from PrayerScreen or Settings test buttons)
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        triggerAzan(
          detail.prayerKey || 'fajr',
          detail.prayerName,
          detail.prayerTime,
          detail.isPreview ?? true
        );
      }
    };
    window.addEventListener('zad:trigger-azan', handleCustomEvent);
    return () => window.removeEventListener('zad:trigger-azan', handleCustomEvent);
  }, [triggerAzan]);

  return {
    azanState,
    triggerAzan,
    closeAzan,
  };
}
