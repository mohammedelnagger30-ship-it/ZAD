import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ensurePersistentStorage } from '@/utils/sync/storagePersistence';
import App from './App.tsx';
import './index.css';

/**
 * Keep the service worker in the environment that needs it.
 *
 * The PWA build is offline-capable, so the web app registers Workbox's worker on load.
 * The native shell must not: it is installed and updated as an APK, and a service worker
 * left behind by an earlier launch would answer with the *previous* bundle — the fix the
 * user just installed would not appear until the app had been opened a second time.
 * Registering is therefore web-only, and the native side actively unregisters anything
 * an older build left on disk. `injectRegister: null` in vite.config.ts stops the plugin
 * from doing its own registration, which is what the native branch here corrects.
 */
function syncServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  if (Capacitor.isNativePlatform()) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .catch((err) => console.warn('Could not clear the service worker:', err));
    return;
  }

  if (!import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

syncServiceWorker();

// The one thing nothing else can rebuild: this storage. Databases hold the memorization
// progress, the records and the downloads, and every one of them is evictable until the
// persist mark is granted. Asked here at start and again when onboarding finishes, never
// prompted, never fatal — see storagePersistence.ts.
void ensurePersistentStorage();

// Keep a root-level error boundary around startup and the app: if anything
// fails before a screen mounts, the user still gets an in-app recovery action.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
