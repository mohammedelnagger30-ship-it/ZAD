import { Fragment, useMemo, useState } from 'react';
import { Check, Monitor, Moon, Sun, Palette } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { COLOR_PALETTES, FEATURED_COLOR_PALETTE_IDS, type ColorPalette } from '@/utils/colorThemes';

interface ThemeSectionProps {
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
}

export function ThemeSection({ themeMode, onChangeTheme, colorPalette, onChangeColorPalette }: ThemeSectionProps) {
  const [showAllPalettes, setShowAllPalettes] = useState(false);

  const visiblePalettes = useMemo(() => {
    if (showAllPalettes) return COLOR_PALETTES;
    return FEATURED_COLOR_PALETTE_IDS
      .map((id) => COLOR_PALETTES.find((palette) => palette.id === id))
      .filter((palette): palette is (typeof COLOR_PALETTES)[number] => Boolean(palette));
  }, [showAllPalettes]);

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
                      borderColor: active ? 'var(--brand-from, #09251a)' : 'var(--brand-from, #09251a)26',
                      background: active ? 'var(--brand-gradient, linear-gradient(135deg, #09251a 0%, #165b39 44%, #34764f 72%, #76560e 100%))' : 'var(--surface-panel, #f7f5ec)',
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

          <div className="border-t pt-5" style={{ borderColor: 'var(--brand-from, #09251a)26' }}>
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} style={{ color: 'var(--brand-from, #09251a)' }} />
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">نغمة ألوان الواجهة</p>
              <button
                type="button"
                onClick={() => setShowAllPalettes((value) => !value)}
                className="mr-auto text-[10px] font-bold text-primary-700 transition hover:text-primary-900 dark:text-gold-300 dark:hover:text-gold-200"
              >
                {showAllPalettes ? 'إظهار المختارة' : 'عرض المزيد'}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6">
              {visiblePalettes.map((palette) => {
                const selected = colorPalette === palette.id;
                const qurraSelected = selected && palette.id === 'qurra';
                return (
                  <Fragment key={palette.id}>
                    {showAllPalettes && palette.id === 'obsidian' && (
                      <p className="col-span-full pt-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        تدرجات داكنة مميزة
                      </p>
                    )}
                    <button
                      type="button"
                      aria-label={`اختيار اللون ${palette.name}`}
                      aria-pressed={selected}
                      title={palette.vibe}
                      onClick={() => onChangeColorPalette(palette.id)}
                      className="group relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-300 hover:scale-105 active:scale-95"
                      style={{
                        background: selected
                          ? `linear-gradient(180deg, rgba(4,18,12,0.18), rgba(4,18,12,0.76)), ${qurraSelected ? 'linear-gradient(120deg, rgba(255,255,255,0.16), transparent 42%, rgba(236,210,137,0.2)), ' : ''}${palette.gradient}`
                          : '#ffffff',
                        boxShadow: selected
                          ? `0 12px 32px ${palette.glow}, 0 0 0 3px ${qurraSelected ? '#d9bc68aa' : `${palette.color}66`}`
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
                          style={qurraSelected
                            ? {
                                backgroundImage: 'linear-gradient(90deg, #f0d784 0%, #fffdf4 48%, #e5bf5a 100%)',
                                backgroundClip: 'text',
                                color: 'transparent',
                                WebkitBackgroundClip: 'text',
                                WebkitTextFillColor: 'transparent',
                                filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
                              }
                            : { color: selected ? '#ffffff' : palette.color }}
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
                          <Check size={14} className="text-[var(--brand-from, #09251a)]" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  </Fragment>
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
                    background: `linear-gradient(115deg, rgba(3,18,12,0.82), rgba(3,18,12,0.56)), ${current.gradient}`,
                    borderColor: current.color,
                    boxShadow: `0 16px 40px ${current.glow}, inset 0 0 0 1px ${current.color}33`,
                    borderImage: `linear-gradient(135deg, ${current.color}, ${current.accent}) 1`,
                  }}
                >
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <span
                      className="h-7 w-7 rounded-full ring-3 ring-white/50 drop-shadow-lg"                      style={{ backgroundColor: current.color }}
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
