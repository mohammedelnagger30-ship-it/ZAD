import {
  BarChart3,
  BookOpen,
  BookText,
  Bookmark,
  CalendarDays,
  Clock3,
  Compass,
  FolderOpen,
  HandHeart,
  Home,
  Mic2,
  MoreHorizontal,
  Repeat,
  Search,
  Settings,
  Star,
  Sun,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { ScreenName } from '@/hooks/useApp';

export interface ScreenMetadata {
  label: string;
  icon: LucideIcon;
}

export const SCREEN_METADATA: Record<ScreenName, ScreenMetadata> = {
  home: { label: 'الرئيسية', icon: Home },
  quran: { label: 'القرآن', icon: BookOpen },
  planner: { label: 'خطة الحفظ', icon: CalendarDays },
  prayer: { label: 'الصلاة', icon: Clock3 },
  salah: { label: 'فقه الصلاة', icon: Compass },
  hadith: { label: 'الأحاديث', icon: BookText },
  sunnah: { label: 'السنن', icon: Star },
  nawafil: { label: 'النوافل', icon: Sun },
  prophet: { label: 'السيرة', icon: UserRound },
  huwaini: { label: 'المحاضرات', icon: Mic2 },
  library: { label: 'المكتبة', icon: FolderOpen },
  progress: { label: 'إنجازي', icon: BarChart3 },
  settings: { label: 'الإعدادات', icon: Settings },
  more: { label: 'المزيد', icon: MoreHorizontal },
  adhkar: { label: 'الأذكار', icon: HandHeart },
  tasbih: { label: 'المسبحة', icon: Repeat },
  bookmarks: { label: 'محفوظاتي', icon: Bookmark },
  search: { label: 'البحث', icon: Search },
};

export const MAIN_TAB_SCREENS: readonly ScreenName[] = [
  'home',
  'quran',
  'prayer',
  'hadith',
  'more',
];

export const MORE_TAB_SCREENS: readonly ScreenName[] = [
  'more',
  'planner',
  'progress',
  'adhkar',
  'tasbih',
  'settings',
  'library',
  'salah',
  'bookmarks',
  'search',
  'prophet',
  'huwaini',
  'sunnah',
  'nawafil',
];
