import { Fragment, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Monitor, Moon, Sun, Palette } from 'lucide-react';
import { Card } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { COLOR_PALETTES, FEATURED_COLOR_PALETTE_IDS, type ColorPalette } from '@/utils/colorThemes';

interface ThemeSectionProps {
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
}

export function ThemeSection({
  themeMode,
  onChangeTheme,
  colorPalette,
  onChangeColorPalette,
}: ThemeSectionProps) {
  const [showAllPalettes, setShowAllPalettes] = useState(false);

  const visiblePalettes = COLOR_PALETTES.filter(
    (palette) =>
      showAllPalettes ||
      palette.id === colorPalette ||
      FEATURED_COLOR_PALETTE_IDS.includes(palette.id),
  );

  return (
    <>
      <section className="space-y-3">
        <SectionTitle icon={<Sun size={20} />} title="المظهر والسمات البصرية" />

        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-5">
          {/* 1. Screen Mode (فاتح / داكن / النظام) */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">وضع الشاشة</p>
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {themeMode === 'light' ? 'فاتح' : themeMode === 'dark' ? 'داكن' : 'تلقائي مع النظام'}
              </span>
            </div>
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
                    type="button"
                    onClick={() => onChangeTheme(opt.mode)}
                    className="flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                    style={{
                      borderColor: active
                        ? 'var(--brand-from)'
                        : 'color-mix(in srgb, var(--brand-from) 22%, transparent)',
                      background: active ? 'var(--brand-gradient)' : 'var(--surface-panel)',
                      color: active ? '#ffffff' : 'rgb(var(--primary-800))',
                      boxShadow: active ? '0 8px 24px var(--brand-glow)' : 'none',
                    }}
                  >
                    <Icon size={20} />
                    <span className="text-xs md:text-sm font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Color Palettes Grid (سمات ألوان الواجهة - كل سمة بثلاثة ألوان متناسقة) */}
          <div className="border-t border-primary-200/80 pt-5 dark:border-primary-800/80">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-2">
                <Palette size={16} className="text-primary-600 dark:text-gold-300" />
                <div className="flex flex-col">
                  <p className="text-xs font-bold text-gray-800 dark:text-gray-200">
                    ألوان التطبيق والسمات
                  </p>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    كل سمة مبنية على 3 ألوان متناسقة (الأساسي · المكمّل · التمييز)
                  </span>
                </div>
              </div>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-100/70 text-primary-700 dark:bg-primary-900/60 dark:text-primary-300">
                {visiblePalettes.length} من {COLOR_PALETTES.length} سمة
              </span>
            </div>

            {/* Grid of themes */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6">
              {visiblePalettes.map((palette) => {
                const selected = colorPalette === palette.id;

                return (
                  <Fragment key={palette.id}>
                    {palette.id === 'obsidian' && (
                      <p className="col-span-full pt-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
                        تدرجات داكنة ليلية
                      </p>
                    )}
                    <button
                      type="button"
                      aria-label={`اختيار سمة ${palette.name}`}
                      aria-pressed={selected}
                      title={palette.vibe}
                      onClick={() => onChangeColorPalette(palette.id)}
                      className={`group relative flex flex-col items-center justify-between gap-2.5 rounded-2xl p-3 transition-all duration-300 hover:scale-[1.04] active:scale-[0.97] ${
                        selected
                          ? 'ring-2 ring-primary-500/80 shadow-md'
                          : 'hover:border-primary-300'
                      }`}
                      style={{
                        background: selected ? 'var(--brand-soft)' : 'var(--surface-panel)',
                        border: selected
                          ? `2px solid ${palette.color}`
                          : '1px solid rgb(var(--primary-200) / 0.7)',
                        boxShadow: selected
                          ? `0 10px 24px ${palette.glow}`
                          : '0 2px 6px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* Tri-color circular swatches */}
                      <div className="flex items-center -space-x-1.5 rtl:space-x-reverse pt-1">
                        <span
                          className="h-4.5 w-4.5 rounded-full ring-2 ring-white dark:ring-gray-900 shadow-sm z-30 transition-transform group-hover:scale-110"
                          style={{ backgroundColor: palette.color }}
                          title="اللون الأساسي"
                        />
                        <span
                          className="h-4 w-4 rounded-full ring-2 ring-white dark:ring-gray-900 shadow-sm z-20 transition-transform group-hover:scale-110"
                          style={{
                            backgroundColor: palette.tertiary,
                            border: palette.tertiary === '#ffffff' ? '1px solid #d1d5db' : undefined,
                          }}
                          title="اللون المكمل"
                        />
                        <span
                          className="h-4.5 w-4.5 rounded-full ring-2 ring-white dark:ring-gray-900 shadow-sm z-10 transition-transform group-hover:scale-110"
                          style={{ backgroundColor: palette.accent }}
                          title="لون التمييز"
                        />
                      </div>

                      {/* Theme Name and Latin Subtitle */}
                      <div className="flex flex-col items-center text-center w-full leading-tight">
                        <span
                          className="text-xs font-bold tracking-tight"
                          style={{ color: selected ? palette.color : 'inherit' }}
                        >
                          {palette.name}
                        </span>
                        <span
                          className="text-[9px] font-medium tracking-wide opacity-75 mt-0.5"
                          style={{ color: 'rgb(var(--primary-700))' }}
                        >
                          {palette.latin}
                        </span>
                      </div>

                      {/* Active indicator checkmark */}
                      {selected && (
                        <div
                          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold text-white shadow-xs mt-0.5"
                          style={{ background: palette.color }}
                        >
                          <Check size={10} strokeWidth={3} />
                          مفعّل
                        </div>
                      )}
                    </button>
                  </Fragment>
                );
              })}
            </div>

            {/* Expand / Collapse button */}
            <button
              type="button"
              onClick={() => setShowAllPalettes((expanded) => !expanded)}
              aria-expanded={showAllPalettes}
              className="mt-3.5 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-900/50"
            >
              {showAllPalettes ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {showAllPalettes
                ? 'عرض السمات الأساسية فقط'
                : `عرض بقية السمات (${COLOR_PALETTES.length - visiblePalettes.length} سمة إضافية)`}
            </button>

            {/* Selected palette detailed preview strip */}
            {(() => {
              const current = COLOR_PALETTES.find((p) => p.id === colorPalette);
              if (!current) return null;
              return (
                <div
                  className="mt-4 overflow-hidden rounded-2xl border transition-all duration-500"
                  style={{
                    background: current.gradient,
                    borderColor: 'color-mix(in srgb, white 25%, transparent)',
                    boxShadow: `0 14px 34px ${current.glow}, 0 0 0 1px ${current.color}33`,
                  }}
                >
                  <div className="p-3.5 flex items-center justify-between gap-3 text-white">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center -space-x-1.5 rtl:space-x-reverse shrink-0">
                        <span
                          className="h-8 w-8 rounded-full ring-2 ring-white shadow-md z-30"
                          style={{ backgroundColor: current.color }}
                          title="اللون الأساسي"
                        />
                        <span
                          className="h-7 w-7 rounded-full ring-2 ring-white shadow-md z-20"
                          style={{
                            backgroundColor: current.tertiary,
                            border: current.tertiary === '#ffffff' ? '1px solid #e5e7eb' : undefined,
                          }}
                          title="اللون المكمل"
                        />
                        <span
                          className="h-8 w-8 rounded-full ring-2 ring-white shadow-md z-10"
                          style={{ backgroundColor: current.accent }}
                          title="لون التمييز"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white drop-shadow-sm">
                          سمة {current.name} · {current.latin}
                        </p>
                        <p className="text-[11px] text-white/90 truncate mt-0.5">
                          {current.vibe}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/20 backdrop-blur-md border border-white/25 text-white font-bold text-xs shadow-sm shrink-0">
                      <Check size={14} strokeWidth={3} />
                      السمة المطبقة
                    </div>
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
