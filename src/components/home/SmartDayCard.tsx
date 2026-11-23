import { BookOpen, MoonStar, Repeat, Sun, Sunrise, type LucideIcon } from 'lucide-react';
import { dayPhaseOf, type DayPhase } from '@/utils/dayPhase';
import type { NavParams, ScreenName } from '@/hooks/useApp';

interface SmartDayAction {
  label: string;
  Icon: LucideIcon;
  screen: ScreenName;
  params?: NavParams;
}

interface SmartDayContent {
  /** The phase's own name, worn as a small badge. */
  label: string;
  title: string;
  body: string;
  Icon: LucideIcon;
  primary: SmartDayAction;
  secondary: SmartDayAction;
}

/**
 * What each part of the day asks of the reader. The card does not invent a
 * schedule: morning carries the adhkar and the Quran wird, the middle of the day
 * carries the rawatib and the tasbih, and the evening carries the evening adhkar
 * and Surat Al-Mulk — the three practices the app already has screens for.
 */
const CONTENT: Record<DayPhase, SmartDayContent> = {
  morning: {
    label: 'صباح',
    title: 'أذكار الصباح ووردك من القرآن',
    body: 'ابدأ يومك بذكر الله، ثم اقرأ وردك قبل أن تنشغل — دقائق الصباح تبقى معك طول اليوم.',
    Icon: Sunrise,
    primary: {
      label: 'أذكار الصباح',
      Icon: Sunrise,
      screen: 'adhkar',
      params: { categoryId: 'morning' },
    },
    secondary: { label: 'ورد القرآن', Icon: BookOpen, screen: 'quran' },
  },
  midday: {
    label: 'ظهيرة',
    title: 'رواتبك وتسبيحك',
    body: 'الرواتب بين الأذان والإقامة، وتسبيح قصير يملأ ما بقي من يومك — لا تدعه يفوت.',
    Icon: Sun,
    primary: { label: 'الرواتب', Icon: Sun, screen: 'prayer' },
    secondary: { label: 'المسبحة', Icon: Repeat, screen: 'tasbih' },
  },
  evening: {
    label: 'مساء',
    title: 'أذكار المساء وسورة الملك',
    body: 'أذكار المساء تحفظ ليلتك، وسورة الملك رفيقة القبر — اجعلهما آخر ما تقرأ.',
    Icon: MoonStar,
    primary: {
      label: 'أذكار المساء',
      Icon: MoonStar,
      screen: 'adhkar',
      params: { categoryId: 'evening' },
    },
    secondary: {
      label: 'سورة الملك',
      Icon: BookOpen,
      screen: 'quran',
      params: { openSurahId: 67 },
    },
  },
};

interface SmartDayCardProps {
  /** The trusted clock Home already renders from, so the card turns with the day. */
  now: Date;
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

export function SmartDayCard({ now, navigate }: SmartDayCardProps) {
  const phase = dayPhaseOf(now);
  const content = CONTENT[phase];
  const actions = [content.primary, content.secondary];

  return (
    <section
      className={`smart-day-card smart-day-card--${phase} relative overflow-hidden rounded-3xl border border-primary-100 bg-white p-4 shadow-sm md:p-5 dark:border-primary-800/80 dark:bg-primary-950/70`}
      aria-labelledby="smart-day-title"
    >
      <span className="smart-day-card__pattern" aria-hidden="true" />

      <div className="relative flex items-start gap-3">
        <span className="smart-day-card__icon">
          <content.Icon size={21} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-gray-500 dark:text-gray-400">
            <span className="smart-day-card__badge">{content.label}</span>
            <span>تذكير حسب وقتك</span>
          </p>
          <h2
            id="smart-day-title"
            className="mt-1.5 text-lg font-extrabold leading-snug text-primary-900 md:text-xl dark:text-primary-100"
          >
            {content.title}
          </h2>
          <p className="mt-1 text-xs leading-6 text-gray-600 md:text-sm dark:text-gray-300">
            {content.body}
          </p>
        </div>
      </div>

      <div className="relative mt-3.5 flex flex-wrap gap-2">
        {actions.map((action, index) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.screen, action.params)}
            className={`smart-day-card__action smart-day-card__action--${
              index === 0 ? 'primary' : 'secondary'
            }`}
          >
            <action.Icon size={15} aria-hidden="true" />
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
