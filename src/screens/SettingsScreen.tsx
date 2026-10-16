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
import type { CloudSyncState } from '@/utils/cloudSync';

interface SettingsScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
  accountEmail?: string;
  syncState?: CloudSyncState | null;
  onSyncNow?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
  /** Supplied only to an allow-listed account: the way back to the dashboard. */
  onOpenAdmin?: () => void;
}

export function SettingsScreen({
  settings,
  onSaveSettings,
  themeMode,
  onChangeTheme,
  colorPalette,
  onChangeColorPalette,
  accountEmail,
  syncState,
  onSyncNow,
  onSignOut,
  onOpenAdmin,
}: SettingsScreenProps) {
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
      />
      <AppUpdatesSection />
      <ThemeSection
        themeMode={themeMode}
        onChangeTheme={onChangeTheme}
        colorPalette={colorPalette}
        onChangeColorPalette={onChangeColorPalette}
      />
      <UISettingsSection settings={settings} onSaveSettings={onSaveSettings} />
      <NotificationsSection settings={settings} onSaveSettings={onSaveSettings} />
      <PrayerTimesSection settings={settings} onSaveSettings={onSaveSettings} />
      <HijriSection settings={settings} onSaveSettings={onSaveSettings} />
      <FontSection settings={settings} onSaveSettings={onSaveSettings} />
      <AutoBackupSection />
      <BackupSection />
      <AboutSection />
    </div>
  );
}

