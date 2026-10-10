import { Calendar } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { type Settings } from '@/db/database';

interface HijriSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

export function HijriSection({ settings, onSaveSettings }: HijriSectionProps) {
  return (
    <>
      {/* Hijri Date Correction */}
      <section className="space-y-2">
        <SectionTitle icon={<Calendar size={20} />} title="التاريخ الهجري" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md">
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">تصحيح عرض التاريخ</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                إن كان تاريخك الهجري يختلف بيوم، اضبطه هنا ليُطبَّق على تاريخ اليوم في كل الشاشات.
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              {[-1, 0, 1].map((delta) => (
                <button
                  key={delta}
                  onClick={() => onSaveSettings({ hijriAdjustment: delta })}
                  aria-pressed={(settings.hijriAdjustment ?? 0) === delta}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    (settings.hijriAdjustment ?? 0) === delta
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {delta === 0 ? 'الأصل' : delta > 0 ? '+١' : '−١'}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
