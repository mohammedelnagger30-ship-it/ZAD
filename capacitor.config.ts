import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hifzi.app',
  appName: 'قُرّة',
  webDir: 'dist',
  android: {
    // Console output reaches logcat in release builds too, so a scheduling problem can
    // be read off the device instead of guessed at.
    loggingBehavior: 'production',
    // TEMPORARY: lets `chrome://inspect` open the WebView for on-device diagnosis of
    // the notification queue. Revert before shipping.
    webContentsDebuggingEnabled: true,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      // Default sound for notifications that do not pick one. Must be a file that
      // actually exists (public/audio + android res/raw): `adhan.mp3` never shipped,
      // so the default silently resolved to nothing.
      sound: 'adhan_makkah_masjid.mp3',
    },
  },
};

export default config;
