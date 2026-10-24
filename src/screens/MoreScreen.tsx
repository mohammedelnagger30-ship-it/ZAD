import {
  BarChart3,
  BookOpen,
  BookText,
  Bookmark,
  Calendar,
  ChevronLeft,
  Heart,
  Info,
  Mic2,
  Moon,
  Music2,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';
import { Card } from '@/components/ui';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface MoreScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

interface MoreItem {
  screen: ScreenName;
  params?: NavParams;
  label: string;
  description: string;
  icon: LucideIcon;
  badge?: string;
}

interface MoreGroup {
  title: string;
  icon: LucideIcon;
  items: MoreItem[];
}

/**
 * The one card that leads the page. The sheikh's library is the newest and largest
 * section, so it is not a thirteenth tile in a grid: it takes the full width at the
 * top and wears the palette's own gradient, the way a cover leads a shelf.
 */
const FEATURED: MoreItem = {
  screen: 'huwaini',
  label: 'الشيخ أبو إسحاق الحويني',
  description: 'كل دوراته العلمية وسلاسله ومحاضراته، مرتّبة بأجود الأصوات، مع تنزيل ما تريد للاستماع بلا إنترنت',
  icon: Mic2,
  badge: 'جديد',
};

/**
 * Everything else, gathered by what the reader is doing rather than by internal
 * screen names: study the Qur'an and hadith, worship and follow the Prophet ﷺ, then
 * keep the daily habit and tune the app. A flat list of fifteen equal tiles made the
 * page read as an inventory; four named shelves read as a home.
 */
const GROUPS: MoreGroup[] = [
  {
    title: 'القرآن والحديث',
    icon: BookOpen,
    items: [
      {
        screen: 'search',
        label: 'البحث الشامل',
        description: 'ابحث في الآيات والأحاديث والأذكار ونصوص التفسير في نتيجة واحدة',
        icon: Search,
        badge: 'شامل',
      },
      {
        screen: 'bookmarks',
        label: 'محفوظاتي',
        description: 'الآيات والصفحات التي علّمتها في المصحف، عود إليها بضغطة واحدة',
        icon: Bookmark,
        badge: 'جديد',
      },
      {
        screen: 'library',
        params: { section: 'audio' },
        label: 'إدارة التلاوات',
        description: 'تنزيل التلاوات وترتيب السور المحفوظة لكل قارئ',
        icon: Music2,
      },
      {
        screen: 'library',
        params: { section: 'tafsir' },
        label: 'إدارة التفاسير',
        description: 'اختيار التفاسير وتنزيلها وإدارة المحفوظ منها',
        icon: BookOpen,
      },
      {
        screen: 'library',
        params: { section: 'hadith' },
        label: 'إدارة الأحاديث',
        description: 'تنزيل كتب الحديث وإدارة المجموعات المحفوظة',
        icon: BookText,
      },
    ],
  },
  {
    title: 'العبادة والسيرة',
    icon: Moon,
    items: [
      {
        screen: 'adhkar',
        label: 'الأذكار اليومية',
        description: 'أذكار الصباح والمساء والنوم وبعد الصلاة، مع أذكار الوضوء والمسجد والطعام والسفر والميت',
        icon: Heart,
        badge: 'مستحسنة',
      },
      {
        screen: 'tasbih',
        label: 'المسبحة الإلكترونية',
        description: 'عداد الذكر التفاعلي بالاهتزاز اللمسي',
        icon: Repeat,
        badge: 'تفاعلي',
      },
      {
        screen: 'salah',
        label: 'فقه الصلاة',
        description: 'أركان الصلاة وحركاتها الصحيحة وأخطاؤها وسننها بأدلتها',
        icon: BookOpen,
        badge: 'دليل',
      },
      {
        screen: 'nawafil',
        label: 'النوافل',
        description: 'السنن الرواتب والوتر والضحى وقيام الليل ونوافل الصلوات بأوقاتها وأفضلها',
        icon: Moon,
        badge: 'جديد',
      },
      {
        screen: 'prophet',
        label: 'النبي محمد ﷺ',
        description: 'اسمه ونسبه وشمائل خَلْقه وأخلاقه وأسرته وسيرته ومعجزاته',
        icon: Star,
        badge: 'جديد',
      },
      {
        screen: 'sunnah',
        label: 'سنن عن النبي',
        description: 'سنن يومية وصفات وأخلاق وتعامل، مع الأدلة',
        icon: Sparkles,
      },
    ],
  },
  {
    title: 'المتابعة والتخصيص',
    icon: BarChart3,
    items: [
      {
        screen: 'planner',
        label: 'خطة الحفظ والمراجعة',
        description: 'جدولة وردك اليومي وتذكيرات التكرار',
        icon: Calendar,
      },
      {
        screen: 'progress',
        label: 'إحصائيات الإنجاز',
        description: 'متابعة تقدمك والتزامك اليومي بالأيام المتتالية',
        icon: BarChart3,
      },
      {
        screen: 'settings',
        label: 'إعدادات التطبيق',
        description: 'تخصيص المظهر، الأذان والنسخ الاحتياطي',
        icon: SettingsIcon,
      },
    ],
  },
];

/** One shelf entry: an icon in the theme's tint, the name, and what waits behind it. */
function MoreCard({ item, onOpen }: { item: MoreItem; onOpen: () => void }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex h-full w-full items-start gap-2.5 rounded-2xl border border-primary-100/90 bg-white/95 p-2.5 text-right shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.99] sm:gap-3 sm:p-3.5 dark:border-primary-800/70 dark:bg-primary-950/70 dark:hover:border-primary-700 dark:focus-visible:ring-offset-primary-950"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700 transition-colors group-hover:bg-primary-100 sm:h-11 sm:w-11 dark:bg-primary-900/60 dark:text-gold-300 dark:group-hover:bg-primary-800">
        <Icon size={18} strokeWidth={1.9} className="sm:h-5 sm:w-5" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-bold text-primary-900 transition-colors group-hover:text-primary-700 sm:text-sm dark:text-primary-50 dark:group-hover:text-gold-200">
            {item.label}
          </span>
          {item.badge && (
            <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[0.5625rem] font-extrabold leading-none text-primary-800 sm:px-2 sm:text-[0.625rem] dark:bg-primary-800/80 dark:text-primary-100">
              {item.badge}
            </span>
          )}
        </span>
        <span className="mt-1 line-clamp-2 block text-[0.7rem] leading-relaxed text-primary-700/70 dark:text-primary-300/80">
          {item.description}
        </span>
      </span>

      <ChevronLeft
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-primary-300 transition-transform group-hover:-translate-x-1 sm:mt-1 dark:text-primary-600"
      />
    </button>
  );
}

export function MoreScreen({ navigate }: MoreScreenProps) {
  const total = GROUPS.reduce((sum, group) => sum + group.items.length, 1);

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-5 px-2.5 pb-[calc(env(safe-area-inset-bottom,0)+1.75rem)] pt-1 sm:space-y-6 sm:px-3 md:px-4 lg:px-6"
      dir="rtl"
    >
      {/* Page title — one line of purpose, and how much sits behind it. */}
      <div className="flex flex-col gap-2 border-b border-primary-100 pb-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3 dark:border-primary-800/80">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-primary-900 xs:text-xl md:text-2xl dark:text-primary-50">
            <Sparkles size={20} className="text-primary-500 dark:text-gold-300" aria-hidden="true" />
            جميع الأقسام والخدمات
          </h1>
          <p className="mt-1 text-xs text-primary-700/70 dark:text-primary-300/80">
            تصفح كافة ميزات وأقسام تطبيق قُرّة
          </p>
        </div>
        <span className="self-start rounded-full bg-primary-50 px-2.5 py-1 text-[0.625rem] font-bold text-primary-700 sm:mt-1 dark:bg-primary-900/60 dark:text-primary-200">
          {toArabicNumber(total)} قسمًا
        </span>
      </div>

      {/* The featured section — full width, dressed in the theme's own gradient. */}
      <button
        type="button"
        onClick={() => navigate(FEATURED.screen)}
        className="group relative w-full overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 p-3.5 text-right text-white shadow-lg shadow-primary-900/15 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 active:scale-[0.995] sm:p-4 md:p-5 dark:focus-visible:ring-offset-primary-950"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-10 -top-12 h-36 w-36 rounded-full bg-white/10 blur-2xl"
        />
        <span className="relative flex items-center gap-2.5 sm:gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur-sm sm:h-12 sm:w-12 md:h-14 md:w-14">
            <Mic2 size={22} className="sm:h-6 sm:w-6" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-extrabold sm:text-base md:text-lg">{FEATURED.label}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.625rem] font-extrabold leading-none">
                {FEATURED.badge}
              </span>
            </span>
            <span className="mt-1 block text-[0.7rem] leading-relaxed text-white/85 line-clamp-2 sm:line-clamp-none sm:text-xs">
              {FEATURED.description}
            </span>
          </span>
          <ChevronLeft
            size={18}
            aria-hidden="true"
            className="shrink-0 text-white/70 transition-transform group-hover:-translate-x-1"
          />
        </span>
      </button>

      {/* The shelves. */}
      {GROUPS.map((group) => {
        const GroupIcon = group.icon;
        return (
          <section key={group.title} aria-label={group.title} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-100/80 text-primary-700 dark:bg-primary-900/70 dark:text-gold-300">
                <GroupIcon size={15} aria-hidden="true" />
              </span>
              <h2 className="text-sm font-extrabold text-primary-900 dark:text-primary-50">{group.title}</h2>
              <span
                aria-hidden="true"
                className="h-px flex-1 bg-gradient-to-l from-primary-100 to-transparent dark:from-primary-800"
              />
            </div>

            <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {group.items.map((item) => (
                <MoreCard key={item.label} item={item} onOpen={() => navigate(item.screen, item.params)} />
              ))}
            </div>
          </section>
        );
      })}

      {/* Foot of the page — what the app promises, stated once. */}
      <div className="grid grid-cols-1 gap-2.5 pt-1 md:grid-cols-2">
        <Card className="border border-primary-100 dark:border-primary-800/60">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-xl bg-primary-50 p-2 text-primary-700 dark:bg-primary-900/60 dark:text-gold-300">
              <Shield size={20} aria-hidden="true" />
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-primary-900 dark:text-primary-100">الخصوصية والأمان</p>
              <p className="text-xs leading-relaxed text-primary-700/70 dark:text-primary-300/80">
                لا يحتوي التطبيق على إعلانات أو تتبع. تحفظ جميع خططك وسورك المفضلة وإحصائياتك محلياً بحماية تامة.
              </p>
            </div>
          </div>
        </Card>

        <Card className="border border-primary-100 dark:border-primary-800/60">
          <div className="flex items-start gap-3">
            <div className="shrink-0 rounded-xl bg-primary-50 p-2 text-primary-700 dark:bg-primary-900/60 dark:text-gold-300">
              <Info size={20} aria-hidden="true" />
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-primary-900 dark:text-primary-100">عن قُرّة</p>
              <p className="text-xs leading-relaxed text-primary-700/70 dark:text-primary-300/80">
                رفيقك اليومي لتلاوة وتدبر وحفظ القرآن الكريم وإتمام الأذكار والصلوات بدون إنترنت.
              </p>
              <p className="mt-1.5 text-[0.6875rem] font-semibold text-primary-400 dark:text-primary-500">
                الإصدار {import.meta.env.VITE_APP_VERSION ?? '1.24.0'} • تطوير متكامل
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
