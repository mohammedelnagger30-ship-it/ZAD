import { Calendar, BarChart3, Settings as SettingsIcon, ChevronLeft, Info, Shield, Heart, Repeat, Library } from 'lucide-react';
import { Card } from '@/components/ui';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface MoreScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

export function MoreScreen({ navigate }: MoreScreenProps) {
  const items = [
    { screen: 'library' as ScreenName, label: 'مكتبة المحتوى', description: 'تحميل التفاسير وكتب الحديث للعمل بدون إنترنت', icon: Library },
    { screen: 'planner' as ScreenName, label: 'خطة الحفظ', description: 'جدولة الحفظ والمراجعة', icon: Calendar },
    { screen: 'progress' as ScreenName, label: 'تقدّمي', description: 'الإحصائيات والإنجازات', icon: BarChart3 },
    { screen: 'adhkar' as ScreenName, label: 'الأذكار', description: 'أذكار الصباح والمساء والنوم', icon: Heart },
    { screen: 'tasbih' as ScreenName, label: 'المسبحة', description: 'عداد الذكر الإلكتروني', icon: Repeat },
    { screen: 'settings' as ScreenName, label: 'الإعدادات', description: 'التخصيص والنسخ الاحتياطي', icon: SettingsIcon },
  ];

  return (
    <div className="space-y-4 pb-4">
      <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">المزيد</h1>

      <div className="space-y-3">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.screen}
              onClick={() => navigate(item.screen)}
              className="flex items-center gap-3 hover:border-primary-300 transition-smooth"
            >
              <div className="w-12 h-12 rounded-xl bg-primary-100 dark:bg-primary-800 flex items-center justify-center flex-shrink-0">
                <Icon size={24} className="text-primary-600 dark:text-gold-400" />
              </div>
              <div className="flex-1">
                <p className="font-bold text-primary-800 dark:text-primary-100">{item.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.description}</p>
              </div>
              <ChevronLeft size={20} className="text-gray-300 dark:text-gray-600" />
            </Card>
          );
        })}
      </div>

      {/* Privacy statement */}
      <Card>
        <div className="flex items-start gap-3">
          <Shield size={20} className="text-primary-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-1">الخصوصية</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              لا يحتوي التطبيق على تحليلات أو تتبع. قد يحتاج تنزيل التفاسير أو تحميل الخطوط لأول مرة إلى اتصال بالإنترنت؛ وتُحفظ بياناتك ومحتوياتك المنزلة محلياً على جهازك.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex items-start gap-3">
          <Info size={20} className="text-primary-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-1">عن Sakinah</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              تطبيق حفظ القرآن الكريم وتتبع العبادات اليومية. تعمل الميزات الأساسية بدون إنترنت، ويمكن تنزيل التفاسير وكتب الحديث لاستخدامها لاحقاً.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              الإصدار {import.meta.env.VITE_APP_VERSION || '1.0'}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
