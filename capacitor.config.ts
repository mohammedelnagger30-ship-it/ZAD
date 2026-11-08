import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hifzi.app',
  appName: 'قُرّة',
  webDir: 'dist',
  android: {
    // Console output reaches logcat in release builds too, so a scheduling problem can
    // be read off the device instead of guessed at.
    loggingBehavior: 'production',
    // Disabled in release: on-device debugging of the WebView is a development aid,
    // not something to ship to end users.
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_qaf_notification',
      // Default sound for notifications that do not pick one. Must be a file that
      // actually exists (public/audio + android res/raw): `adhan.mp3` never shipped,
      // so the default silently resolved to nothing.
      sound: 'adhan_makkah_masjid.mp3',
    },
  },
};

export default config;
