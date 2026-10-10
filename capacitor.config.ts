import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hifzi.app',
  appName: 'قُرّة',
  webDir: 'dist',
  backgroundColor: '#0f1a14',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#1f734e',
      // Default sound for notifications that do not pick one. Must be a file that
      // actually exists (public/audio + android res/raw): `adhan.mp3` never shipped,
      // so the default silently resolved to nothing.
      sound: 'adhan_makkah_masjid.mp3',
    },
  },
};

export default config;
