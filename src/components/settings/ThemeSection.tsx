import { Check, Monitor, Moon, Sun, Palette } from 'lucide-react';
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
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-5">
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
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 md:py-4 rounded-2xl border transition-all duration-200 ${
                      active
                        ? 'border-primary-500 bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-md shadow-primary-900/20'
                        : 'border-primary-100/80 bg-gray-50/70 dark:border-primary-800/60 dark:bg-primary-900/30 text-gray-700 dark:text-gray-200 hover:bg-primary-50 dark:hover:bg-primary-800/50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-xs md:text-sm font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} className="text-primary-600 dark:text-primary-300" />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">نغمة ألوان الواجهة</p>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-auto">{COLOR_PALETTES.length} سِمة</span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {COLOR_PALETTES.map((palette) => {
                const selected = colorPalette === palette.id;
                return (
                  <button
                    key={palette.id}
                    type="button"
                    aria-label={`اختيار اللون ${palette.name}`}
                    aria-pressed={selected}
                    title={palette.vibe}
                    onClick={() => onChangeColorPalette(palette.id)}
                    className={`group relative flex flex-col items-center gap-1.5 rounded-2xl border p-2.5 transition-all duration-200 ${
                      selected
                        ? 'border-primary-400 bg-primary-50/80 dark:bg-primary-800/50 shadow-lg ring-2 ring-primary-400/30 scale-[1.02]'
                        : 'border-transparent bg-gray-50 dark:bg-primary-900/20 hover:bg-primary-50/50 dark:hover:bg-primary-800/30 hover:scale-[1.02] active:scale-95'
                    }`}
                  >
                    {/* Gradient orb */}
                    <span
                      className="relative flex h-11 w-11 items-center justify-center rounded-full shadow-lg ring-1 ring-black/5 transition-all duration-200 group-hover:scale-110 group-hover:shadow-xl dark:ring-white/10"
                      style={{ background: palette.gradient }}
                    >
                      {selected && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/30 backdrop-blur-sm">
                          <Check size={14} className="text-white drop-shadow-sm" strokeWidth={3} />
                        </span>
                      )}
                    </span>
                    {/* Color dots preview */}
                    <span className="flex items-center gap-0.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.color }} />
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.accent }} />
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: palette.soft, border: '0.5px solid rgba(0,0,0,0.1)' }} />
                    </span>
                    {/* Labels */}
                    <span className="flex flex-col items-center text-center leading-tight">
                      <span className="text-[11px] font-bold text-primary-900 dark:text-primary-100">{palette.name}</span>
                      <span className="text-[8.5px] font-medium tracking-wide text-gray-400 dark:text-gray-500">{palette.latin}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Selected palette info strip */}
            {(() => {
              const current = COLOR_PALETTES.find(p => p.id === colorPalette);
              if (!current) return null;
              return (
                <div
                  className="mt-4 flex items-center gap-3 rounded-xl p-2.5 border transition-all duration-300"
                  style={{
                    background: `linear-gradient(90deg, ${current.soft}cc, transparent)`,
                    borderColor: `${current.color}30`,
                  }}
                >
                  <span
                    className="h-8 w-8 shrink-0 rounded-lg shadow-sm"
                    style={{ background: current.gradient }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-primary-800 dark:text-primary-100">
                      {current.name} · {current.latin}
                    </p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">
                      {current.vibe}
                    </p>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      </section>
    </>
  );
}
