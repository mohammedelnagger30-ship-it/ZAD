import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';

interface ThemeSectionProps {
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
}

export function ThemeSection({ themeMode, onChangeTheme, colorPalette, onChangeColorPalette }: ThemeSectionProps) {
  return (
    <>
      {/* Theme & Palette */}
      <section className="space-y-2">
        <SectionTitle icon={<Sun size={20} />} title="المظهر والسمات البصرية" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5">وضع الشاشة</p>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { mode: 'light' as const, label: 'فاتح', icon: Sun },
                { mode: 'dark' as const, label: 'داكن', icon: Moon },
                { mode: 'system' as const, label: 'النظام', icon: Monitor },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = themeMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    onClick={() => onChangeTheme(opt.mode)}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all duration-200 ${
                      active
                        ? 'border-primary-500 bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-md shadow-primary-900/20'
                        : 'border-primary-100/80 bg-gray-50/70 dark:border-primary-800/60 dark:bg-primary-900/30 text-gray-700 dark:text-gray-200 hover:bg-primary-50 dark:hover:bg-primary-800/50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-xs font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5">نغمة ألوان الواجهة</p>
            <div className="grid grid-cols-4 gap-2.5">
              {COLOR_PALETTES.map((palette) => {
                const selected = colorPalette === palette.id;
                return (
                  <button
                    key={palette.id}
                    type="button"
                    aria-label={`اختيار اللون ${palette.name}`}
                    aria-pressed={selected}
                    onClick={() => onChangeColorPalette(palette.id)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all duration-200 ${
                      selected
                        ? 'border-gold-400 bg-primary-50 dark:bg-primary-800/50 shadow-md ring-1 ring-gold-400/40'
                        : 'border-transparent bg-gray-50 dark:bg-primary-900/20 hover:bg-primary-50/50 dark:hover:bg-primary-800/30'
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-transform"
                      style={{ backgroundColor: palette.color }}
                    >
                      {selected && <Check size={18} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="text-xs font-bold text-primary-900 dark:text-primary-100">{palette.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}
