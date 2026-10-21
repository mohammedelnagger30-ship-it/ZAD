import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { cssEngineCompat } from './scripts/css-engine-compat.ts';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(env.VITE_APP_VERSION || pkg.version || '1.0.0'),
    },
    plugins: [
      react(),
      tailwindcss(),
      cssEngineCompat(),
      VitePWA({
      registerType: 'autoUpdate',
      // The plugin used to inject `navigator.serviceWorker.register` into the bundle,
      // which also ran inside the Capacitor WebView. There it did harm: each install
      // ships a new bundle, but a service worker from the previous one kept serving the
      // old assets until the app had been opened twice, so a fix appeared to do nothing
      // on the first launch. The app registers the worker itself — on the web only —
      // and clears any leftover one on native (see src/main.tsx).
      injectRegister: null,
      includeAssets: ['icon.svg', 'icons/*.png'],
      manifest: {
        name: 'قُرّة',
        short_name: 'قُرّة',
        description: 'قُرّة — القرآن والصلاة والعبادة اليومية',
        dir: 'rtl',
        lang: 'ar',
        theme_color: '#0369a1',
        background_color: '#0f1a14',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          // PNG entries are required: Android and iOS silently reject an SVG-only
          // manifest when offering the install prompt.
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json,mp3,ogg}'],
        // The Quran text and the bundled صحيح مسلم payload are the two large
        // data files, and neither belongs in the install: the first is 7MB of
        // ayahs read a page at a time, the second is 8.3MB copied into IndexedDB
        // on first use and never read from HTTP again. Both are matched below
        // and kept for a year instead, so a first install pulls roughly 18MB
        // less and an unchanged file is not re-fetched on the next release —
        // workbox carries an unchanged precached entry over, but only if it is
        // precached in the first place.
        globIgnores: ['**/quranText-*.js', '**/hadith/*.json'],
        // vite-plugin-pwa marks everything under assets/ as cache-bust-free, i.e. its URL
        // is taken as proof of its content — so a stylesheet rewritten under an unchanged
        // URL would never be re-fetched, and the old bytes would outlive the fix. A regex
        // that matches nothing makes every file carry a content revision instead, which
        // turns "the bytes changed" into "the cache key changed".
        dontCacheBustURLsMatching: /^$/,
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/quranText-[^/]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'quran-text',
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            // The bundled collection, kept the way the Quran text is: fetched
            // once, then offline from there. It is copied into IndexedDB on
            // first use (`hadithService.collectionDownloadUrls`), after which
            // the HTTP copy is never read again — so the precache was paying
            // 8.3MB of install for a file that exists to be seen once. The
            // CDN fallback is on cdn.jsdelivr.net under `/editions/`, not under
            // `/hadith/`, so this pattern cannot catch it by accident.
            urlPattern: /\/hadith\/[^/]+\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bundled-hadith',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            // The @import in index.css pulls the *stylesheet* from googleapis and the
            // actual .woff2 files from gstatic. Caching only googleapis left every
            // glyph uncached, so the app was not offline-capable as advertised.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    optimizeDeps: {
      exclude: ['lucide-react'],
    },
    build: {
      target: ['es2019', 'chrome70'],
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/@supabase/')) return 'supabase';
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/') || id.includes('/node_modules/scheduler/')) {
              return 'react-vendor';
            }
            if (id.includes('/node_modules/dexie/')) return 'dexie';
            if (id.includes('/node_modules/adhan/')) return 'adhan';
          },
        },
      },
    },
  };
});
