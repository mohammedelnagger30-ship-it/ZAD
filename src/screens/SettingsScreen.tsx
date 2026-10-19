import { useEffect } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { BackupSection } from '@/components/settings/BackupSection';
import { AutoBackupSection } from '@/components/settings/AutoBackupSection';
import { AccountSection } from '@/components/settings/AccountSection';
import { AppUpdatesSection } from '@/components/settings/AppUpdatesSection';
import { ThemeSection } from '@/components/settings/ThemeSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { PrayerTimesSection } from '@/components/settings/PrayerTimesSection';
import { HijriSection } from '@/components/settings/HijriSection';
import { FontSection } from '@/components/settings/FontSection';
import { AboutSection } from '@/components/settings/AboutSection';
import { UISettingsSection } from '@/components/settings/UISettingsSection';
import { type Settings } from '@/db/database';
import { type ColorPalette } from '@/utils/colorThemes';
import { type NavParams } from '@/hooks/useApp';
import type { CloudSyncState, SignOutOptions, SignOutResult } from '@/utils/cloudSync';

/** Section ids a caller may ask to be scrolled into view. */
const SCROLLABLE_SECTIONS = new Set(['notifications']);

interface SettingsScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  /**
   * Nav params the screen was opened with. `section` names a section to scroll to once the
   * screen mounts — Settings is a single page, not a set of routes, so the deep link is a
   * smooth scroll rather than a URL.
   */
  params?: NavParams;
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
  accountEmail?: string;
  syncState?: CloudSyncState | null;
  onSyncNow?: () => Promise<void>;
  onSignOut?: (options?: SignOutOptions) => Promise<SignOutResult>;
  /** Supplied only to an allow-listed account: the way back to the dashboard. */
  onOpenAdmin?: () => void;
  /** Supplied only to a guest — the way from here to the sign-up form. */
  onCreateAccount?: () => void;
  /** Navigation function to push other screens. */
  navigate: (screen: string) => void;
}

export function SettingsScreen({
  settings,
  onSaveSettings,
  params,
  themeMode,
  onChangeTheme,
  colorPalette,
  onChangeColorPalette,
  accountEmail,
  syncState,
  onSyncNow,
  onSignOut,
  onOpenAdmin,
  onCreateAccount,
  navigate,
}: SettingsScreenProps) {
  // Reached from the dhikr reminder notice on the home screen. Settings is a single page, so
  // the deep link is a smooth scroll to the section rather than a URL.
  //
  // Timers, not `requestAnimationFrame`: rAF does not run in a tab that is not being painted
  // (an unfocused window, a backgrounded WebView), and the scroll would silently never
  // happen. Retries cover the window between this effect committing and the lazy section
  // finishing its first layout.
  const requestedSection = params?.section;
  useEffect(() => {
    if (typeof requestedSection !== 'string' || !SCROLLABLE_SECTIONS.has(requestedSection)) return;
    const id = `settings-${requestedSection}`;
    let attempts = 0;
    let timer: number | undefined;
    const tryScroll = () => {
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Smooth scrolling is an animation, and an animation never runs in a document that
        // is not being painted (a hidden WebView, an unfocused tab). Confirm it actually
        // moved and fall back to jumping, so the reader always lands on the section.
        timer = window.setTimeout(() => {
          const rect = target.getBoundingClientRect();
          const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
          if (!inView) target.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, 400);
        return;
      }
      // ~1s of patience is far past any legitimate load; stop rather than spin forever.
      if (++attempts < 12) timer = window.setTimeout(tryScroll, 80);
    };
    timer = window.setTimeout(tryScroll, 80);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [requestedSection]);

  return (
    <div className="space-y-6 md:space-y-0 md:grid md:grid-cols-2 md:items-start md:gap-x-6 md:gap-y-8 pb-8" dir="rtl">
      {/* Top Main Header */}
      <div className="flex items-center justify-between border-b border-primary-100 pb-4 dark:border-primary-800">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-primary-900 dark:text-primary-50 flex items-center gap-2">
            <SettingsIcon size={26} className="text-primary-600 dark:text-gold-400" />
            إعدادات التطبيق
          </h1>
          <p className="mt-1 text-xs text-primary-700/80 dark:text-primary-300">
            تخصيص المظهر، التنبيهات، مواقيت الصلاة والنسخ الاحتياطي
          </p>
        </div>
      </div>

      <AccountSection
        accountEmail={accountEmail}
        syncState={syncState}
        onSyncNow={onSyncNow}
        onSignOut={onSignOut}
        onOpenAdmin={onOpenAdmin}
        onCreateAccount={onCreateAccount}
      />
      <AppUpdatesSection />
      <ThemeSection
        themeMode={themeMode}
        onChangeTheme={onChangeTheme}
        colorPalette={colorPalette}
        onChangeColorPalette={onChangeColorPalette}
      />
      <UISettingsSection settings={settings} onSaveSettings={onSaveSettings} />
      <NotificationsSection settings={settings} onSaveSettings={onSaveSettings} navigate={navigate} />
      <PrayerTimesSection settings={settings} onSaveSettings={onSaveSettings} />
      <HijriSection settings={settings} onSaveSettings={onSaveSettings} />
      <FontSection settings={settings} onSaveSettings={onSaveSettings} />
      <AutoBackupSection />
      <BackupSection />
      <AboutSection />
    </div>
  );
}

