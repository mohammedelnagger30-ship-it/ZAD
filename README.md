# نور زاد (Nour ZAD) — Quran & Daily Worship App

An offline-first Islamic app for Quran memorization, daily worship tracking, prayer times, and hadith library. The entire UI is in Arabic with full RTL support.

## Features

### Quran Reader (Offline)
- Browse by surah, juz, or page
- Adjustable font size for Quran text (Amiri font)
- Bookmark individual ayahs
- Listen to complete surahs or select and repeat a specific ayah with multiple reciters
- Download selected reciter/surah combinations for offline audio playback
- **Hifz Mode**: Select an ayah range, hide text to test yourself, or hide word-by-word

### Hifz Planner & Schedule
- Create multiple plans for new memorization (حفظ) and review (مراجعة)
- Choose days of the week and time for each plan
- Auto-suggest a plan from a goal (e.g., "finish Juz 30 in 2 months")
- Home screen shows today's tasks

### Daily Confirmation
- Confirmation cards: "هل حفظت؟ / هل راجعت؟" with ✅ Done, ❌ Couldn't, ⏰ Snooze (15/30 min)
- Rate memorization strength: ضعيف / متوسط / قوي for spaced repetition
- Missed tasks are marked at end of day

### Prayer Tracking
- Offline prayer times calculated using the [adhan](https://github.com/batoulapps/adhan-js) library
- 12 calculation methods (Egyptian General Authority default)
- Asr madhab selection (Shafi/Hanafi)
- Qibla direction
- Track 5 daily prayers: in time / late (qada) / missed
- Track Sunnah prayers: Witr, Duha, Rawatib
- Weekly/monthly prayer commitment stats
- Pre-prayer reminders (configurable)

### Hadith Library (Offline)
- Nine downloadable Arabic collections (about 36,064 hadiths in the upstream catalog), including Sahih al-Bukhari, Sahih Muslim, the four Sunan, Muwatta Malik, and two Forty-Hadith collections
- Browse by collection and section, with clear source, numbering, and source-provided grading
- Full-text Arabic search across downloaded books (diacritics-insensitive), with filters and paged results
- Favorites and offline reading
- Hadith of the day

The catalog is limited to collections published by the configured data source; it is not a claim to include every narration or hadith book. Grading and section titles are shown as supplied by the source and are not inferred by the app.

### Progress & Motivation
- Streak counter
- 30-day calendar heatmap
- % of Quran memorized
- Weekly prayer stats
- Achievement badges

### Settings
- Theme: light / dark / system
- Four coordinated color palettes: emerald, ocean, lilac, and sand
- Notification sounds toggle
- Adhan sound toggle
- Snooze duration
- Pre-prayer reminder minutes
- Prayer calculation method & madhab
- Location selection (city presets or auto)
- Quran font size
- Export/import backup as JSON

## Tech Stack

- **React 18** + **Vite** + **TypeScript**
- **Tailwind CSS** for styling with green/gold Islamic theme
- **Dexie** (IndexedDB) for offline-first local data storage
- **Supabase Auth + Postgres** for optional email/password accounts and per-record sync
- **adhan** library for offline prayer time calculations
- **@capacitor/local-notifications** for scheduled reminders
- **vite-plugin-pwa** for PWA support (service worker, offline caching)
- **Capacitor** for wrapping as a native Android/iOS app
- **Lucide React** for icons
- Arabic fonts: Amiri (Quran), Cairo/Tajawal (UI)

## Project Structure

```
src/
├── components/         # Shared UI components
│   ├── BottomNav.tsx   # Bottom navigation bar
│   ├── Onboarding.tsx  # First-run onboarding flow
│   └── ui.tsx          # Card, Button, Badge, etc.
├── data/               # Static data (bundled offline)
│   ├── hadiths.ts      # Hadith collections
│   ├── quranText.ts    # Quran ayah text (Uthmani)
│   └── surahs.ts       # 114 surah metadata + juz/page mapping
├── db/
│   └── database.ts     # Dexie schema & settings
├── hooks/
│   └── useApp.ts       # Settings, theme, navigation hooks
├── screens/            # App screens
│   ├── HomeScreen.tsx
│   ├── QuranScreen.tsx
│   ├── PlannerScreen.tsx
│   ├── PrayerScreen.tsx
│   ├── HadithScreen.tsx
│   ├── ProgressScreen.tsx
│   └── SettingsScreen.tsx
└── utils/              # Business logic
    ├── dateUtils.ts
    ├── notifications.ts
    ├── prayerTimes.ts
    ├── prayerTracker.ts
    └── taskManager.ts
```

## Development

```bash
npm install
npm run dev        # Start dev server
npm run build      # Build for production
npm run typecheck  # Type checking
```

## Building the Android APK with Capacitor

### Prerequisites
- [Node.js](https://nodejs.org/) 22+
- [Android Studio](https://developer.android.com/studio) with Android SDK
- Java JDK 17+

### Steps

1. **Build the web app:**
   ```bash
   npm run build
   ```

2. **Add the Android platform:**
   ```bash
   npx cap add android
   ```

3. **Sync web assets to the native project:**
   ```bash
   npx cap sync android
   ```

4. **Open in Android Studio:**
   ```bash
   npx cap open android
   ```

5. **Build the APK in Android Studio:**
   - Go to **Build → Build Bundle(s) / APK(s) → Build APK(s)**
   - The debug APK will be generated at `android/app/build/outputs/apk/debug/app-debug.apk`

6. **For a release APK:**
   - Generate a signing key:
     ```bash
     keytool -genkey -v -keystore hifzi.keystore -alias hifzi -keyalg RSA -keysize 2048 -validity 10000
     ```
   - Configure `android/app/build.gradle` with the keystore
   - Go to **Build → Generate Signed Bundle / APK**

### Notification Permissions on Android

The app requests notification permissions during onboarding. For reliable scheduled reminders:

- **Exact alarm permission**: Android 12+ requires `SCHEDULE_EXACT_ALARM` permission (already in Capacitor Local Notifications plugin)
- **Battery optimization**: Users should disable battery optimization for the app in Settings → Apps → نور زاد → Battery → Unrestricted

### Building for iOS

1. ```bash
   npx cap add ios
   npx cap sync ios
   npx cap open ios
   ```
2. Configure signing in Xcode
3. Build and run on device or simulator

## Offline Data and Account Sync

App data is stored locally using IndexedDB (via Dexie), so the app remains usable offline:
- Plans, daily tasks, bookmarks
- Prayer records, sunnah tracking
- Hifz progress, hadith favorites
- Downloaded recitation audio and verse timings
- App settings

The Quran text and hadith collections are bundled as static data in the app — no network access needed after installation.

When Supabase is configured and a user signs in, account data is synchronized record by record between that user's devices. Local rows are retained offline and queued changes upload when connectivity returns. On first account use, existing local records are uploaded; records with the same stable ID use the latest modification timestamp, and deletions are synchronized as tombstones.

### Supabase setup

1. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and the project's **anon/publishable** key. These are client-side values; never put a Supabase `service_role` key in a `VITE_` variable or APK.
2. Run `supabase/migrations/20261005000000_user_record_sync.sql` in the Supabase SQL Editor before signing in.
3. Keep Row Level Security enabled. The migration restricts reads to the authenticated owner and permits writes only through an authenticated, owner-scoped RPC.
4. Configure email confirmation and redirect URLs in Supabase Auth for the deployed web app if email confirmation is enabled.

The app includes no Supabase credentials in source control. Builds without the two Vite environment variables continue to use local-only mode.

### GitHub releases and APK updates

Every push to `main` runs the `Android APK release` workflow, which builds a signed APK and publishes it as a new public GitHub release (`v1.0.RUN_NUMBER`). The workflow also supports releases from a `vMAJOR.MINOR.PATCH` tag or a manual run from the GitHub Actions tab. In-app update checking reads the latest public GitHub release and offers its APK; the user must confirm installation in Android.

1. Create the stable release key once with `powershell -ExecutionPolicy Bypass -File scripts\create-release-key.ps1`. Back up both ignored files `android\app\zad-release.jks` and `android\app\keystore.properties` securely. Never replace or lose this key.
2. Authenticate `gh` with `gh auth login`, then run `powershell -ExecutionPolicy Bypass -File scripts\configure-github-release-secrets.ps1`. It uploads signing secrets and the Supabase build configuration without printing their values.
3. Push completed changes to `main`; each push creates a new APK release. Use tags or the manual workflow only when you need to choose a specific version.

The existing distributed APKs are debug-signed and cannot be upgraded in place with the new release key. Users must back up their app data, uninstall the old build once, and install the first release APK. Every later release signed with this preserved key can be installed as an update without removing app data.

## Backup & Restore

Use Settings → Backup to export all data as a JSON file. Import to restore on a new device.

## Testing

This project uses [Jest](https://jestjs.io/) with `ts-jest` for unit testing.

```bash
# Run all tests
npm test

# Run tests with coverage report
npx jest --coverage

# Run a specific test file
npx jest src/utils/__tests__/dateUtils.test.ts
```

Tests are located alongside their source files in `__tests__/` directories:
- `src/utils/__tests__/` — utility function tests
- `src/components/__tests__/` — component tests

## Contributing

1. **Fork** the repository
2. **Clone** your fork locally
3. **Install** dependencies: `npm install`
4. **Create** a feature branch: `git checkout -b feature/my-feature`
5. **Make** your changes
6. **Run** linting: `npm run lint`
7. **Run** tests: `npm test`
8. **Build** to verify: `npm run build`
9. **Commit** your changes with a descriptive message
10. **Push** to your fork and **open a Pull Request**

### Code Style

- The project uses **ESLint** for linting and **Prettier** for formatting.
- Run `npx prettier --write .` to format all files.
- Arabic text is used for UI labels; keep all user-facing strings in `src/i18n.ts`.

## CI / CD

This project uses **GitHub Actions** for continuous integration. On every push and pull request to `main`/`master`:

1. Dependencies are installed (`npm ci`)
2. Linting runs (`npm run lint`)
3. Tests run (`npm test`)
4. The app is built (`npm run build`)

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for details.
