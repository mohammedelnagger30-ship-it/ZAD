import { Home, BookOpen, Moon, BookText, MoreHorizontal } from 'lucide-react';
import type { ScreenName } from '@/hooks/useApp';

interface NavItem {
  screen: ScreenName;
  label: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { screen: 'home', label: 'الرئيسية', icon: Home },
  { screen: 'quran', label: 'القرآن', icon: BookOpen },
  { screen: 'prayer', label: 'الصلاة', icon: Moon },
  { screen: 'hadith', label: 'الأحاديث', icon: BookText },
  { screen: 'more', label: 'المزيد', icon: MoreHorizontal },
];

/** Screens reachable from the "المزيد" tab — they all highlight that tab as active. */
const MORE_TAB_SCREENS: ScreenName[] = [
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
];

interface BottomNavProps {
  current: ScreenName;
  onNavigate: (screen: ScreenName) => void;
}

export function BottomNav({ current, onNavigate }: BottomNavProps) {
  const activeScreen: ScreenName = MORE_TAB_SCREENS.includes(current) ? 'more' : current;

  return (
    <>
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed bottom-2.5 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 rounded-2xl border border-primary-200/80 bg-panel/92 shadow-[0_12px_36px_-12px_var(--brand-glow,rgba(31,115,78,0.22))] backdrop-blur-xl dark:border-primary-800/80 dark:bg-raised/92 safe-bottom md:hidden"
    >
      <div className="flex items-center justify-around gap-1 px-2 pt-1.5 pb-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.screen;
          return (
            <button
              key={item.screen}
              onClick={() => onNavigate(item.screen)}
              aria-current={isActive ? 'page' : undefined}
              className={`group relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-from,#1f734e)] dark:focus-visible:ring-[var(--brand-to,#b84414)] ${
                isActive
                  ? 'bg-[var(--brand-soft,#eef7f1)]/70 dark:bg-[var(--brand-from,#1f734e)]/20 shadow-xs ring-1 ring-[var(--brand-from,#1f734e)]/30 dark:ring-[var(--brand-to,#b84414)]/30'
                  : 'hover:bg-[var(--brand-soft,#eef7f1)]/70 dark:hover:bg-[var(--brand-from,#1f734e)]/10'
              }`}
            >
              <span className={`flex h-7 w-9 items-center justify-center rounded-full transition-all duration-200 ${
                isActive
                  ? 'text-[var(--brand-from,#1f734e)] dark:text-[var(--brand-to,#b84414)] scale-105'
                  : 'text-gray-500 group-hover:text-[var(--brand-from,#1f734e)] dark:text-gray-400 dark:group-hover:text-[var(--brand-to,#b84414)]'
              }`}>
                <Icon size={21} strokeWidth={isActive ? 2.5 : 1.9} />
              </span>
              <span
                className={`text-[0.625rem] leading-none transition-colors ${
                  isActive
                    ? 'font-bold text-[var(--brand-from,#1f734e)] dark:text-[var(--brand-to,#b84414)]'
                    : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
    <nav
      aria-label="التنقل الرئيسي"
      className="fixed inset-y-0 right-0 z-50 hidden w-[5.25rem] flex-col items-center overflow-y-auto border-l border-primary-100/80 bg-panel/90 py-5 shadow-xs backdrop-blur-xl dark:border-primary-800/50 dark:bg-raised/90 md:flex lg:w-24 xl:w-32"
      style={{ boxShadow: '0 4px 20px var(--brand-glow, rgba(31,115,78,0.22))' }}
    >
      <div
        className="mb-8 flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md shadow-primary-700/20 xl:h-12 xl:w-12"
        style={{ background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #b84414 100%))' }}
        aria-hidden="true"
      >
        <BookOpen size={23} />
      </div>
      <div className="flex w-full flex-col items-center gap-2 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeScreen === item.screen;
          return (
            <button
              key={item.screen}
              onClick={() => onNavigate(item.screen)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-[4.25rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl text-[0.6875rem] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-from,#1f734e)] dark:focus-visible:ring-[var(--brand-to,#b84414)] lg:gap-2 lg:text-xs xl:text-sm ${
                isActive
                  ? 'bg-[var(--brand-soft,#eef7f1)]/70 font-bold text-[var(--brand-from,#1f734e)] shadow-sm dark:bg-[var(--brand-from,#1f734e)]/20 dark:text-[var(--brand-to,#b84414)] ring-1 ring-[var(--brand-from,#1f734e)]/30 dark:ring-[var(--brand-to,#b84414)]/30'
                  : 'text-gray-500 hover:bg-[var(--brand-soft,#eef7f1)]/80 dark:text-gray-400 dark:hover:bg-[var(--brand-from,#1f734e)]/10'
              }`}
            >
              <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
    </>
  );
}
