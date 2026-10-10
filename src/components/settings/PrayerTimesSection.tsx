import { MapPin } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { CALC_METHODS, CALC_METHOD_NAMES_AR } from '@/utils/prayerTimes';
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
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">طريقة الحساب المعتمدة</label>
            <select
              value={settings.calcMethod}
              onChange={(e) => onSaveSettings({ calcMethod: e.target.value })}
              className="w-full bg-gray-50 dark:bg-primary-900/50 border border-primary-200 dark:border-primary-700 rounded-xl py-2.5 px-3 text-sm text-primary-900 dark:text-primary-100 font-semibold focus:outline-hidden focus:ring-2 focus:ring-primary-500"
            >
              {CALC_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CALC_METHOD_NAMES_AR[m]}
                </option>
              ))}
            </select>
          </div>

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

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">الموقع الحالي المسجل</label>
            <div className="flex items-center justify-between rounded-xl bg-primary-50/70 p-3 border border-primary-100 dark:bg-primary-900/30 dark:border-primary-800/60">
              <span className="text-sm font-bold text-primary-900 dark:text-primary-100 flex items-center gap-1.5">
                <MapPin size={16} className="text-primary-600 dark:text-gold-400" />
                {settings.cityName || 'غير محدد'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ({settings.latitude?.toFixed(2)}, {settings.longitude?.toFixed(2)})
              </span>
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
