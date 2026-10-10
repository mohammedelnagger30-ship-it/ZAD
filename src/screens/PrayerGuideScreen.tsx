import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronLeft,
  ListOrdered,
  PersonStanding,
  Sparkles,
} from 'lucide-react';
import { Card } from '@/components/ui';
import { PrayerPosture } from '@/components/PrayerPosture';
import {
  PRAYER_GUIDE_INTRO_QURAN,
  PRAYER_GUIDE_LEAD,
  PRAYER_GUIDE_MISTAKES,
  PRAYER_GUIDE_MOVEMENTS,
  PRAYER_GUIDE_MOVEMENTS_INTRO,
  PRAYER_GUIDE_PILLARS,
  PRAYER_GUIDE_SUNAN,
  type PrayerGuideItem,
  type PrayerGuideStep,
} from '@/data/prayerGuide';
import { toArabicNumber } from '@/data/surahs';
import type { NavParams, ScreenName } from '@/hooks/useApp';

interface PrayerGuideScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

const SECTIONS = [
  { id: 'pillars', label: 'الأركان', icon: ListOrdered },
  { id: 'movements', label: 'الحركات', icon: PersonStanding },
  { id: 'mistakes', label: 'الأخطاء', icon: AlertTriangle },
  { id: 'sunan', label: 'السنن', icon: Sparkles },
] as const;

const QUOTE_FRAME =
  'mt-3 rounded-xl border-r-[3px] border-gold-400/80 bg-primary-50/70 px-3.5 py-3 dark:border-[#cfa95c]/70 dark:bg-[#cfa95c]/[0.06]';

function SourceLine({ item, className = '' }: { item: PrayerGuideItem; className?: string }) {
  return (
    <p className={`mt-2 flex items-center gap-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400 ${className}`}>
      <BookOpen size={13} className="shrink-0" />
      <span>
        {item.source}
        {item.grade ? ` — ${item.grade}` : ''}
      </span>
    </p>
  );
}

function QuoteText({ text, className = '' }: { text: string; className?: string }) {
  return <p className={`quran-text leading-[2] text-primary-900 dark:text-primary-50 ${className}`}>{text}</p>;
}

function SectionHeading({
  title,
  subtitle,
  icon,
  tone = 'primary',
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  tone?: 'primary' | 'error';
}) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
          tone === 'error'
            ? 'bg-error-50 text-error-600 dark:bg-error-900/30 dark:text-error-400'
            : 'bg-primary-100 text-primary-700 dark:bg-[#cfa95c]/15 dark:text-[#cfa95c]'
        }`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-primary-900 dark:text-primary-50">{title}</h2>
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

function PillarCard({ item, index }: { item: PrayerGuideItem; index: number }) {
  return (
    <Card className="shadow-md">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-600 text-sm font-bold text-white shadow-xs dark:bg-primary-700">
          {toArabicNumber(index + 1)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary-900 dark:text-primary-50">{item.title}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.hint}</p>
        </div>
      </div>
      <blockquote className={QUOTE_FRAME}>
        <QuoteText text={item.text} className="text-[17px]" />
      </blockquote>
      <SourceLine item={item} />
    </Card>
  );
}

function MovementCard({ item }: { item: PrayerGuideStep }) {
  return (
    <Card className="shadow-md">
      <div className="flex items-start gap-3">
        <div className="-m-1 flex shrink-0 items-center justify-center">
          <PrayerPosture
            posture={item.posture}
            className="h-24 w-24 text-primary-800/75 dark:text-[#cfa95c]/85"
            accentClassName="text-gold-600 dark:text-[#cfa95c]"
          />
        </div>
        <div className="min-w-0 pt-2">
          <p className="text-sm font-bold text-primary-900 dark:text-primary-50">{item.title}</p>
          <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">{item.hint}</p>
        </div>
      </div>
      <blockquote className={QUOTE_FRAME}>
        <QuoteText text={item.text} className="text-[15px] leading-[1.9]" />
      </blockquote>
      <SourceLine item={item} />
    </Card>
  );
}

function MistakeCard({ item, index }: { item: PrayerGuideItem; index: number }) {
  return (
    <Card className="shadow-md">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-error-50 text-xs font-bold text-error-600 dark:bg-error-900/40 dark:text-error-400">
          {toArabicNumber(index + 1)}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary-900 dark:text-primary-50">{item.title}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.hint}</p>
        </div>
      </div>
      <blockquote className="mt-3 rounded-xl border-r-[3px] border-error-300 bg-error-50/50 px-3.5 py-3 dark:border-error-700 dark:bg-error-900/20">
        <QuoteText text={item.text} className="text-[15px] leading-[1.9]" />
      </blockquote>
      <SourceLine item={item} />
    </Card>
  );
}

function SunnahCard({ item }: { item: PrayerGuideItem }) {
  return (
    <Card className="shadow-md">
      <div className="flex items-start gap-2">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-gold-600 dark:text-[#cfa95c]" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary-900 dark:text-primary-50">{item.title}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{item.hint}</p>
        </div>
      </div>
      <blockquote className={QUOTE_FRAME}>
        <QuoteText text={item.text} className="text-[15px] leading-[1.9]" />
      </blockquote>
      <SourceLine item={item} />
    </Card>
  );
}

export function PrayerGuideScreen({ navigate }: PrayerGuideScreenProps) {
  const [activeSection, setActiveSection] = useState<string>('pillars');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-5 pb-8" dir="rtl">
      {/* Back to the prayer tab */}
      <button
        type="button"
        onClick={() => navigate('prayer')}
        className="inline-flex items-center gap-1 rounded-lg py-1.5 text-sm font-medium text-primary-600 transition-colors hover:text-primary-800 dark:text-gold-400 dark:hover:text-gold-300"
      >
        <ChevronLeft size={19} className="rotate-180" />
        مواقيت الصلاة
      </button>

      {/* Hero */}
      <section className="relative isolate overflow-hidden rounded-[2rem] bg-linear-to-br from-primary-600 via-primary-700 to-primary-900 p-6 text-white shadow-2xl dark:from-primary-900 dark:via-primary-950 dark:to-primary-950">
        <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full border-4 border-white/5" />
        <div className="pointer-events-none absolute -left-16 top-16 -z-10 h-40 w-40 rounded-full border-4 border-white/5" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-44 w-44 rounded-full border-4 border-white/5" />

        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
          <BookOpen size={13} />
          دليل الصلاة
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight">فقه الصلاة</h1>
        <p className="mt-1.5 text-sm leading-6 text-white/80">
          أركانها وحركاتها الصحيحة وأخطاؤها وسننها — كل نص مقتبس حرفيّاً من مصادرها
        </p>

        <blockquote className="mt-4 rounded-2xl bg-black/15 px-4 py-3.5">
          <p className="quran-text text-lg leading-[2] text-gold-200">{PRAYER_GUIDE_INTRO_QURAN.text}</p>
          <p className="mt-1 text-xs text-white/70">{PRAYER_GUIDE_INTRO_QURAN.source}</p>
        </blockquote>
        <blockquote className="mt-3 rounded-2xl border-r-[3px] border-gold-400/70 bg-white/10 px-4 py-3.5">
          <p className="quran-text text-lg leading-[2] text-white">{PRAYER_GUIDE_LEAD.text}</p>
          <p className="mt-1 text-xs text-white/70">{PRAYER_GUIDE_LEAD.source}</p>
        </blockquote>
      </section>

      {/* Section chips */}
      <nav
        aria-label="أقسام الصفحة"
        className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-primary-100/80 bg-white/90 px-4 py-2.5 backdrop-blur-xs dark:border-primary-800/70 dark:bg-primary-950/90"
      >
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => goTo(section.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors ${
              activeSection === section.id
                ? 'border-primary-600 bg-primary-600 text-white dark:border-[#cfa95c] dark:bg-[#cfa95c] dark:text-primary-950'
                : 'border-primary-200 bg-white text-primary-700 hover:border-primary-400 dark:border-primary-700 dark:bg-primary-900/60 dark:text-primary-200 dark:hover:border-[#cfa95c]/60'
            }`}
          >
            <section.icon size={13} />
            {section.label}
          </button>
        ))}
      </nav>

      {/* أركان الصلاة */}
      <section id="pillars" className="scroll-mt-16 space-y-3.5">
        <SectionHeading
          title="أركان الصلاة"
          subtitle="مع كل ركن نصّ من القرآن أو السنة"
          icon={<ListOrdered size={20} />}
        />
        {PRAYER_GUIDE_PILLARS.map((item, index) => (
          <PillarCard key={item.id} item={item} index={index} />
        ))}
      </section>

      {/* الحركات الصحيحة */}
      <section id="movements" className="scroll-mt-16 space-y-3.5">
        <SectionHeading
          title="الحركات الصحيحة"
          subtitle="من التكبير إلى التشهد — الصورة مع النص"
          icon={<PersonStanding size={20} />}
        />
        <Card className="border-gold-200 bg-gold-50/40 dark:border-[#cfa95c]/40 dark:bg-[#cfa95c]/[0.05]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gold-500 text-white shadow-xs">
              <BookOpen size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-50">
                {PRAYER_GUIDE_MOVEMENTS_INTRO.title}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
                {PRAYER_GUIDE_MOVEMENTS_INTRO.hint}
              </p>
            </div>
          </div>
          <blockquote className={QUOTE_FRAME}>
            <QuoteText text={PRAYER_GUIDE_MOVEMENTS_INTRO.text} className="text-[17px]" />
          </blockquote>
          <SourceLine item={PRAYER_GUIDE_MOVEMENTS_INTRO} />
        </Card>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {PRAYER_GUIDE_MOVEMENTS.map((item) => (
            <MovementCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {/* أخطاء شائعة */}
      <section id="mistakes" className="scroll-mt-16 space-y-3.5">
        <SectionHeading
          title="أخطاء شائعة"
          subtitle="مع كل خطأ نصٌّ يصحّحه"
          icon={<AlertTriangle size={20} />}
          tone="error"
        />
        {PRAYER_GUIDE_MISTAKES.map((item, index) => (
          <MistakeCard key={item.id} item={item} index={index} />
        ))}
      </section>

      {/* سنن الصلاة */}
      <section id="sunan" className="scroll-mt-16 space-y-3.5">
        <SectionHeading
          title="سنن الصلاة"
          subtitle="مستحبّات الصلاة، ومع كل واحد مرجعه"
          icon={<Sparkles size={20} />}
        />
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {PRAYER_GUIDE_SUNAN.map((item) => (
            <SunnahCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      <p className="pt-2 text-center text-[11px] leading-5 text-gray-400 dark:text-gray-500">
        الأحاديث مقتبسة حرفيّاً من الصحيحين والسنن، والآيات من نصّ المصحف — مع رقم كل مصدر.
      </p>
    </div>
  );
}
