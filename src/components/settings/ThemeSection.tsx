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
                    className="flex flex-col items-center justify-center gap-1.5 py-3 md:py-4 rounded-2xl border transition-all duration-300"
                    style={{
                      borderColor: active ? 'var(--brand-from, #15803d)' : 'var(--brand-from, #15803d)26',
                      background: active ? 'var(--brand-gradient, linear-gradient(135deg, #15803d 0%, #2dd4bf 40%, #6ee7b7 65%, #b45309 100%))' : '#f9fafb',
                      color: active ? 'white' : '#374151',
                      boxShadow: active ? '0 8px 24px var(--brand-glow, rgba(21,128,61,0.30))' : 'none',
                    }}
                  >
                    <Icon size={20} />
                    <span className="text-xs md:text-sm font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t pt-5" style={{ borderColor: 'var(--brand-from, #15803d)26' }}>
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} style={{ color: 'var(--brand-from, #15803d)' }} />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">نغمة ألوان الواجهة</p>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-auto">{COLOR_PALETTES.length} سمة</span>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6">
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
                    className="group relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-300 hover:scale-105 active:scale-95"
                    style={{
                      background: selected ? palette.gradient : '#ffffff',
                      boxShadow: selected
                        ? `0 12px 32px ${palette.glow}, 0 0 0 3px ${palette.color}66`
                        : '0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
                    }}
                  >
                    {/* Color preview circles with glow */}
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-3.5 w-3.5 rounded-full ring-2 ring-white/40 drop-shadow-sm"
                        style={{ backgroundColor: palette.color, boxShadow: `0 0 8px ${palette.color}44` }}
                      />
                      <span
                        className="h-3.5 w-3.5 rounded-full ring-2 ring-white/40 drop-shadow-sm"
                        style={{ backgroundColor: palette.accent, boxShadow: `0 0 8px ${palette.accent}44` }}
                      />
                    </div>

                    {/* Labels */}
                    <div className="flex flex-col items-center text-center leading-tight">
                      <span
                        className="text-[11px] font-bold tracking-tight"
                        style={{ color: selected ? '#ffffff' : palette.color }}
                      >
                        {palette.name}
                      </span>
                      <span
                        className="text-[8px] font-medium tracking-wider opacity-80"
                        style={{ color: selected ? 'rgba(255,255,255,0.85)' : '#9ca3af' }}
                      >
                        {palette.latin}
                      </span>
                    </div>

                    {/* Checkmark for selected */}
                    {selected && (
                      <div className="absolute -top-1.5 -right-1.5 h-6 w-6 flex items-center justify-center rounded-full bg-white shadow-lg border border-white/60">
                        <Check size={14} className="text-[var(--brand-from, #15803d)]" strokeWidth={3} />
                      </div>
                    )}
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
                  className="mt-4 flex items-center gap-3 rounded-2xl p-4 border transition-all duration-500"
                  style={{
                    background: current.gradient,
                    borderColor: current.color,
                    boxShadow: `0 16px 40px ${current.glow}, inset 0 0 0 1px ${current.color}33`,
                    borderImage: `linear-gradient(135deg, ${current.color}, ${current.accent}) 1`,
                  }}
                >
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <span
                      className="h-7 w-7 rounded-full ring-3 ring-white/50 drop-shadow-lg"
                      style={{ backgroundColor: current.color }}
                    />
                    <span
                      className="h-7 w-7 rounded-full ring-3 ring-white/50 drop-shadow-lg"
                      style={{ backgroundColor: current.accent }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white drop-shadow-md">
                      {current.name} · {current.latin}
                    </p>
                    <p className="text-[11px] text-white/90 drop-shadow-md truncate leading-snug">
                      {current.vibe}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <div className="w-1 h-12 bg-gradient-to-b from-white/40 to-transparent mx-auto"></div>
                    <Check size={20} className="text-white drop-shadow-lg" strokeWidth={3} />
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
