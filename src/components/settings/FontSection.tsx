import { Type } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { type Settings } from '@/db/database';

interface FontSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

export function FontSection({ settings, onSaveSettings }: FontSectionProps) {
  return (
    <>
      {/* Font Size Settings */}
      <section className="space-y-2">
        <SectionTitle icon={<Type size={20} />} title="حجم خط القرآن الكريم" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500">A-</span>
            <input
              type="range"
              min={18}
              max={48}
              value={settings.fontSize}
              onChange={(e) => onSaveSettings({ fontSize: parseInt(e.target.value) })}
              className="flex-1 accent-primary-600 cursor-pointer h-2 bg-primary-100 dark:bg-primary-800 rounded-lg"
            />
            <span className="text-sm font-semibold text-gray-500">A+</span>
          </div>

          {/* Live Quran Text Preview */}
          <div className="rounded-2xl border border-gold-400/30 bg-amber-50/40 p-4 text-center dark:bg-primary-950/60 shadow-inner">
            <p className="quran-text font-serif text-primary-900 dark:text-primary-50 transition-all duration-200" style={{ fontSize: settings.fontSize }}>
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </p>
            <p className="quran-text font-serif text-primary-800 dark:text-primary-200 mt-2 transition-all duration-200" style={{ fontSize: settings.fontSize * 0.95 }}>
              إِنَّاهَذَا الْقُرْآنَ يَهْدِي لِلَّتِي هِيَ أَقْوَمُ
            </p>
          </div>
        </Card>
      </section>
    </>
  );
}
