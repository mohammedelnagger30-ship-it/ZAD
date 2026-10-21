import { useEffect, useState, type ReactNode } from 'react';
import { BookOpen, ChevronLeft, Heart, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui';
import type { NavParams, ScreenName } from '@/hooks/useApp';

interface ProphetScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

import { PROPHET_SECTIONS, QUOTE_FRAME, type ProphetEntry, type ProphetSection } from '@/data/prophetData';
export { PROPHET_SECTIONS, type ProphetEntry, type ProphetSection };


function EntryCard({ entry }: { entry: ProphetEntry }) {
  return (
    <Card className="shadow-md">
      <p className="flex items-center gap-2 text-sm font-bold text-primary-900 dark:text-primary-50">
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500 dark:bg-gold-400"
          aria-hidden="true"
        />
        {entry.title}
      </p>
      {entry.hint && (
        <p className="mt-1.5 text-xs leading-6 text-gray-500 dark:text-gray-400">{entry.hint}</p>
      )}
      {entry.text && (
        <blockquote className={QUOTE_FRAME}>
          <p className="quran-text text-[1.0625rem] leading-[2] text-primary-900 dark:text-primary-50">
            {entry.text}
          </p>
        </blockquote>
      )}
      {entry.source && (
        <p className="mt-2 flex items-center gap-1.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
          <BookOpen size={13} className="shrink-0" />
          <span>{entry.source}</span>
        </p>
      )}
    </Card>
  );
}

function SectionHeading({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 pt-1 md:col-span-2">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-[#cfa95c]/15 dark:text-[#cfa95c]">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-primary-900 dark:text-primary-50">{title}</h2>
        <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}

export function ProphetScreen({ navigate }: ProphetScreenProps) {
  const [activeSection, setActiveSection] = useState(PROPHET_SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const section of PROPHET_SECTIONS) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-5 pb-8" dir="rtl">
      {/* Back to the more tab */}
      <button
        type="button"
        onClick={() => navigate('more')}
        className="inline-flex items-center gap-1 rounded-lg py-1.5 text-sm font-medium text-primary-600 transition-colors hover:text-primary-800 dark:text-gold-400 dark:hover:text-gold-300"
      >
        <ChevronLeft size={19} className="rotate-180" />
        المزيد
      </button>

      {/* Hero */}
      <section className="relative isolate overflow-hidden rounded-[2rem] bg-linear-to-br from-primary-600 via-primary-700 to-primary-900 p-6 text-white shadow-2xl dark:from-primary-900 dark:via-primary-950 dark:to-primary-950">
        <div className="pointer-events-none absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full border-4 border-white/5" />
        <div className="pointer-events-none absolute -left-16 top-16 -z-10 h-40 w-40 rounded-full border-4 border-white/5" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 -z-10 h-44 w-44 rounded-full border-4 border-white/5" />

        <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/90">
          <Sparkles size={13} />
          السيرة والشمائل
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight md:text-4xl">النبي محمد ﷺ</h1>
        <p className="mt-1.5 text-sm leading-6 text-white/80">
          اسمه ونَسَبه وشَمائلُ خَلْقه وخُلُقه وأسرتُه وسيرتُه ومعجزاتُه — من كتاب الله وصحيح السنة
        </p>

        <blockquote className="mt-4 rounded-2xl bg-black/15 px-4 py-3.5">
          <p className="quran-text text-lg leading-[2] text-gold-200">وَإِنَّكَ لَعَلَىٰ خُلُقٍ عَظِيمٍ</p>
          <p className="mt-1 text-xs text-white/70">سورة القلم: ٤</p>
        </blockquote>
        <blockquote className="mt-3 rounded-2xl border-r-[3px] border-gold-400/70 bg-white/10 px-4 py-3.5">
          <p className="quran-text text-lg leading-[2] text-white">وَمَا أَرْسَلْنَاكَ إِلَّا رَحْمَةً لِّلْعَالَمِينَ</p>
          <p className="mt-1 text-xs text-white/70">سورة الأنبياء: ١٠٧</p>
        </blockquote>
      </section>

      {/* Section chips */}
      <nav
        aria-label="أقسام الصفحة"
        className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-primary-100/80 bg-white/90 px-4 py-2.5 backdrop-blur-xs dark:border-primary-800/70 dark:bg-primary-950/90 md:mx-0 md:px-0"
      >
        {PROPHET_SECTIONS.map((section) => (
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

      {/* Sections */}
      {PROPHET_SECTIONS.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="scroll-mt-16 space-y-3.5 md:grid md:grid-cols-2 md:gap-3.5 md:space-y-0"
        >
          <SectionHeading
            title={section.title}
            subtitle={section.subtitle}
            icon={<section.icon size={20} />}
          />
          {section.entries.map((entry) => (
            <EntryCard key={entry.title} entry={entry} />
          ))}
        </section>
      ))}

      {/* Closing: the prayer upon him ﷺ */}
      <section className="rounded-[2rem] border border-gold-300/70 bg-gradient-to-br from-gold-50 to-white p-6 text-center shadow-md dark:border-gold-700/60 dark:from-primary-950 dark:to-primary-900">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gold-100 text-gold-700 dark:bg-gold-900/50 dark:text-gold-300">
          <Heart size={22} fill="currentColor" />
        </span>
        <blockquote className="mt-3">
          <p className="quran-text text-lg leading-[2.1] text-primary-900 dark:text-gold-200">
            إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ ۚ يَا أَيُّهَا الَّذِينَ آمَنُوا صَلُّوا عَلَيْهِ وَسَلِّمُوا تَسْلِيمًا
          </p>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">سورة الأحزاب: ٥٦</p>
        </blockquote>
        <p className="mt-3 text-sm font-bold text-primary-800 dark:text-gold-300">
          اللهم صلِّ وسلم وبارك على سيدنا محمد وعلى آله وصحبه أجمعين
        </p>
        <p className="mt-3 text-[0.6875rem] leading-5 text-gray-400 dark:text-gray-500">
          النصوص القرآنية والحديثية من كتاب الله وصحيح السنة، ومُثبتة بمصدرها عند كل نص؛ وما دون ذلك من السيرة المعروفة عند أهل العلم.
        </p>
      </section>
    </div>
  );
}
