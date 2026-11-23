import { Layout, Sparkles, Bell, Type } from 'lucide-react';
import { Card, SectionHeader, ToggleRow } from '@/components/ui';
import type { Settings } from '@/db/database';

interface UISettingsSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

/**
 * The icon styles, named for what they do rather than for the icon sets they borrow
 * their weights from — a reader who wants lighter or heavier line work should not have
 * to know what "Heroicons" is. `value` is what gets stored; `stroke` is both the CSS
 * weight (see index.css) and the weight of the preview glyph, so the button shows the
 * exact look it applies.
 */
const ICON_STYLES = [
  { value: 'lucide' as const, label: 'افتراضي', stroke: 2 },
  { value: 'feather' as const, label: 'رقيق', stroke: 1.5 },
  { value: 'heroicons' as const, label: 'عريض', stroke: 2.6 },
];

export function UISettingsSection({ settings, onSaveSettings }: UISettingsSectionProps) {
  const iconStyle = settings.iconStyle ?? 'lucide';

  return (
    <Card>
      <SectionHeader title="تخصيص الواجهة" icon={<Layout size={20} />} />

      <div className="space-y-5">
        {/* Icon style: three live previews, so the choice is visible before it is made. */}
        <div>
          <p id="icon-style-label" className="block text-sm font-semibold text-primary-700 dark:text-primary-200 mb-2">
            سماكة الأيقونات
          </p>
          <div
            role="radiogroup"
            aria-labelledby="icon-style-label"
            className="grid grid-cols-3 gap-2 md:max-w-lg"
          >
            {ICON_STYLES.map((style) => {
              const selected = iconStyle === style.value;
              return (
                <button
                  key={style.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onSaveSettings({ iconStyle: style.value })}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-xs font-bold transition-smooth focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    selected
                      ? 'border-primary-600 bg-primary-600 text-white shadow-md'
                      : 'border-primary-100 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-800/50 dark:text-primary-200 dark:hover:bg-primary-800'
                  }`}
                >
                  <Bell size={22} strokeWidth={style.stroke} aria-hidden="true" />
                  <span>{style.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
            تُطبَّق على أيقونات التطبيق كلها فورًا.
          </p>
        </div>

        {/* Custom badges: the emoji shown on a shareable achievement. */}
        <ToggleRow
          label="أوسمة مخصصة"
          description="إظهار إيموجي مخصص للأوسمة"
          icon={
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
              <Sparkles size={20} className="text-primary-600 dark:text-gold-400" />
            </span>
          }
          value={settings.customBadgesEnabled !== false}
          onChange={(value) => onSaveSettings({ customBadgesEnabled: value })}
        />

        {/* The text-scale hold. Placed here rather than under a font section because it
            is not a size the reader picks — it is a refusal of a size the *device* picks,
            and its whole symptom is visual: «الوضع البسيط» reflows the layout. */}
        <ToggleRow
          label="ثبات حجم الواجهة"
          description="يمنع «الوضع البسيط» وتكبير خط النظام من تغيير شكل التطبيق"
          icon={
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-800">
              <Type size={20} className="text-primary-600 dark:text-gold-400" />
            </span>
          }
          value={settings.ignoreSystemFontScale === true}
          onChange={(value) => onSaveSettings({ ignoreSystemFontScale: value })}
        />
        <p className="-mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          فعّل هذا إذا كنت قد كبّبت خطوط الهاتف أو فعّلت «الوضع البسيط»، فتبدو واجهة التطبيق مشوّهة أو متداخلة.
          التفعيل يُعيد الواجهة إلى حجمها الأصلي مهما كانت إعدادات النظام. أما حجم نص المصحف فيُضبط من قسم «حجم خط المصحف» في الأعلى.
        </p>
      </div>
    </Card>
  );
}
