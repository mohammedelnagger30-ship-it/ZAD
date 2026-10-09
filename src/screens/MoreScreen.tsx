import { Calendar, BarChart3, Settings as SettingsIcon, ChevronLeft, Info, Shield, Heart, Repeat, Library, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface MoreScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

export function MoreScreen({ navigate }: MoreScreenProps) {
  const items = [
    {
      screen: 'adhkar' as ScreenName,
      label: 'الأذكار اليومية',
      description: 'أذكار الصباح والمساء والنوم وبعد الصلاة، مع أذكار الوضوء والمسجد والطعام والسفر والميت',
      icon: Heart,
      badge: 'مستحسنة',
      color: 'from-emerald-600 to-emerald-700',
    },
    {
      screen: 'tasbih' as ScreenName,
      label: 'المسبحة الإلكترونية',
      description: 'عداد الذكر التفاعلي بالاهتزاز اللمسي',
      icon: Repeat,
      badge: 'تفاعلي',
      color: 'from-amber-600 to-amber-700',
    },
    {
      screen: 'library' as ScreenName,
      label: 'مكتبة المحتوى',
      description: 'تحميل التفاسير وكتب الحديث للعمل بدون إنترنت',
      icon: Library,
      color: 'from-blue-600 to-blue-700',
    },
    {
      screen: 'planner' as ScreenName,
      label: 'خطة الحفظ والمراجعة',
      description: 'جدولة وردك اليومي وتذكيرات التكرار',
      icon: Calendar,
      color: 'from-purple-600 to-purple-700',
    },
    {
      screen: 'progress' as ScreenName,
      label: 'إحصائيات الإنجاز',
      description: 'متابعة تقدمك والتزامك اليومي بالأيام المتتالية',
      icon: BarChart3,
      color: 'from-teal-600 to-teal-700',
    },
    {
      screen: 'settings' as ScreenName,
      label: 'إعدادات التطبيق',
      description: 'تخصيص المظهر، الأذان والنسخ الاحتياطي',
      icon: SettingsIcon,
      color: 'from-slate-700 to-slate-800',
    },
  ];

  return (
    <div className="space-y-5 pb-6" dir="rtl">
      {/* Page Title */}
      <div className="flex items-center justify-between border-b border-primary-100 pb-3 dark:border-primary-800">
        <div>
          <h1 className="text-2xl font-bold text-primary-900 dark:text-primary-50 flex items-center gap-2">
            <Sparkles size={24} className="text-amber-500" />
            جميع الأقسام والخدمات
          </h1>
          <p className="mt-0.5 text-xs text-primary-700/80 dark:text-primary-300">
            تصفح كافة ميزات وأقسام تطبيق سكينة
          </p>
        </div>
      </div>

      {/* Grid of Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.screen}
              type="button"
              onClick={() => navigate(item.screen)}
              className="group text-right flex items-center gap-3.5 p-4 rounded-3xl border border-primary-100/90 bg-white/90 dark:border-primary-800/80 dark:bg-primary-950/80 shadow-md hover:shadow-xl hover:border-primary-400 dark:hover:border-primary-600 transition-all duration-200 active:scale-[0.98]"
            >
              <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${item.color} text-white flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform`}>
                <Icon size={22} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-bold text-sm text-primary-900 dark:text-primary-50 group-hover:text-primary-700 dark:group-hover:text-gold-300 transition-colors">
                    {item.label}
                  </p>
                  {item.badge && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                      {item.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {item.description}
                </p>
              </div>
              <ChevronLeft size={18} className="text-gray-400 group-hover:-translate-x-1 transition-transform shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-2">
        <Card className="border border-primary-100 dark:border-primary-800/60">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-100 p-2 text-primary-700 dark:bg-primary-800 dark:text-gold-400 shrink-0">
              <Shield size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-primary-900 dark:text-primary-100 mb-1">الخصوصية والأمان</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                لا يحتوي التطبيق على إعلانات أو تتبع. تحفظ جميع خططك وسورك المفضلة وإحصائياتك محلياً بحماية تامة.
              </p>
            </div>
          </div>
        </Card>

        <Card className="border border-primary-100 dark:border-primary-800/60">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-100 p-2 text-primary-700 dark:bg-primary-800 dark:text-gold-400 shrink-0">
              <Info size={20} />
            </div>
            <div>
              <p className="text-xs font-bold text-primary-900 dark:text-primary-100 mb-1">عن Sakinah</p>
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                رفيقك اليومي لتلاوة وتدبر وحفظ القرآن الكريم وإتمام الأذكار والصلوات بدون إنترنت.
              </p>
              <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mt-1.5">
                الإصدار 1.17.0 • تطوير متكامل
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
