import { Palette, Layout, Sparkles, ToggleLeft, ToggleRight } from 'lucide-react';
import { Card, SectionHeader } from '@/components/ui';
import type { Settings } from '@/db/database';

interface UISettingsSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

export function UISettingsSection({ settings, onSaveSettings }: UISettingsSectionProps) {
  return (
    <Card>
      <SectionHeader title="تخصيص الواجهة" icon={<Layout size={20} />} />

      <div className="space-y-4">
        {/* Icon Style Selection */}
        <div>
          <label className="block text-sm font-semibold text-primary-700 dark:text-primary-200 mb-2">
            نمط الأيقونات
          </label>
          <div className="grid grid-cols-3 gap-2 md:max-w-lg">
            {[
              { value: 'lucide' as const, label: 'Lucide' },
              { value: 'feather' as const, label: 'Feather' },
              { value: 'heroicons' as const, label: 'Heroicons' },
            ].map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => onSaveSettings({ iconStyle: style.value })}
                className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all ${
                  settings.iconStyle === style.value
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800/50 dark:text-primary-200 dark:hover:bg-primary-800'
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Badges Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
              <Sparkles size={20} className="text-primary-600 dark:text-gold-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-200">
                أوسمة مخصصة
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                إظهار إيموجي مخصص للأوسمة
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSaveSettings({ customBadgesEnabled: !settings.customBadgesEnabled })}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all"
          >
            {settings.customBadgesEnabled ? (
              <ToggleRight size={20} className="text-primary-600 dark:text-gold-400" />
            ) : (
              <ToggleLeft size={20} className="text-gray-400" />
            )}
          </button>
        </div>

        {/* Onboarding Tips Toggle */}
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
              <Palette size={20} className="text-primary-600 dark:text-gold-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-200">
                نصائح إرشادية
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                إظهار نصائح للميزات المتقدمة
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onSaveSettings({ showOnboardingTips: !settings.showOnboardingTips })}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-all"
          >
            {settings.showOnboardingTips ? (
              <ToggleRight size={20} className="text-primary-600 dark:text-gold-400" />
            ) : (
              <ToggleLeft size={20} className="text-gray-400" />
            )}
          </button>
        </div>
      </div>
    </Card>
  );
}
