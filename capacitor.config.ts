import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hifzi.app',
  appName: 'ZAD',
  webDir: 'dist',
  backgroundColor: '#0f1a14',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_notification',
      iconColor: '#1f734e',
      sound: 'adhan.mp3',
    },
  },
};

export default config;
