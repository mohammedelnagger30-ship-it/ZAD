import { MapPin } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { type Settings } from '@/db/database';

interface PrayerTimesSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

export function PrayerTimesSection({ settings, onSaveSettings }: PrayerTimesSectionProps) {
  return (
    <>
      {/* Prayer Calculation Settings */}
      <section className="space-y-2">
        <SectionTitle icon={<MapPin size={20} />} title="حساب مواقيت الصلاة" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">حساب وقت صلاة العصر (المذهب)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'standard' })}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  settings.asrMadhab === 'standard'
                    ? 'border-primary-500 bg-primary-600 text-white shadow-sm'
                    : 'border-primary-100 bg-gray-50 dark:border-primary-800 dark:bg-primary-900/30 text-gray-700 dark:text-gray-300'
                }`}
              >
                الشافعي / المالكي / الحنبلي
              </button>
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'hanafi' })}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  settings.asrMadhab === 'hanafi'
                    ? 'border-primary-500 bg-primary-600 text-white shadow-sm'
                    : 'border-primary-100 bg-gray-50 dark:border-primary-800 dark:bg-primary-900/30 text-gray-700 dark:text-gray-300'
                }`}
              >
                الحنفي
              </button>
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
