import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, Sparkles, Check, X, Calendar, Clock, BookOpenCheck, Search, RotateCcw, CircleDashed } from 'lucide-react';
import { Card, Button, Badge, EmptyState } from '@/components/ui';
import { db, type HifzPlan, type HifzProgress, type ProgressType } from '@/db/database';
import { SURAHS, JUZ_INFO, getSurah, toArabicNumber } from '@/data/surahs';
import { describePortion, suggestPlan, generateDailyTasks } from '@/utils/taskManager';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import { getDayNameShort } from '@/utils/dateUtils';

const SUGGESTION_EXAMPLES = [
  {
    category: 'حفظ السور',
    goals: [
      'حفظ سورة الملك',
      'حفظ سورة الكهف',
      'حفظ سورة يس',
      'حفظ سورة البقرة',
    ],
  },
  {
    category: 'حفظ الأجزاء',
    goals: [
      'حفظ جزء عمّ',
      'حفظ جزء تبارك',
      'حفظ الجزء الأول',
      'حفظ الجزء الثلاثين',
    ],
  },
];

type PlannerTab = 'plans' | 'surahs';
type SurahFilter = 'all' | 'memorized' | 'partial' | 'notStarted' | 'reviewed';

interface SurahProgressSummary {
  memorizedAyahs: number;
  reviewedAyahs: number;
  isMemorized: boolean;
  isPartial: boolean;
  hasReview: boolean;
}

function countCoveredAyahs(records: HifzProgress[], statuses: ProgressType[], surahId: number): number {
  const ayahCount = getSurah(surahId)?.ayahCount ?? 0;
  const ranges = records
    .filter((record) => record.surahId === surahId && statuses.includes(record.status))
    .map((record) => [
      Math.max(1, record.ayahStart),
      Math.min(ayahCount, record.ayahEnd),
    ] as const)
    .filter(([start, end]) => start <= end)
    .sort((a, b) => a[0] - b[0]);
  let count = 0;
  let start = 0;
  let end = -1;
  for (const [nextStart, nextEnd] of ranges) {
    if (nextStart > end + 1) {
      if (end >= start) count += end - start + 1;
      start = nextStart;
      end = nextEnd;
    } else {
      end = Math.max(end, nextEnd);
    }
  }
  if (end >= start) count += end - start + 1;
  return count;
}

export function PlannerScreen() {
  const [plans, setPlans] = useState<HifzPlan[]>([]);
  const [progress, setProgress] = useState<HifzProgress[]>([]);
  const [activeTab, setActiveTab] = useState<PlannerTab>('plans');
  const [surahFilter, setSurahFilter] = useState<SurahFilter>('all');
  const [surahSearch, setSurahSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [goalText, setGoalText] = useState('');
  const goalSuggestion = useMemo(
    () => (goalText.trim() ? suggestPlan(goalText) : null),
    [goalText],
  );

  const load = useCallback(async () => {
    const [storedPlans, storedProgress] = await Promise.all([
      db.plans.toArray(),
      db.hifzProgress.toArray(),
    ]);
    setPlans(storedPlans.filter((plan) => !plan.syncPlaceholder).sort((a, b) => b.createdAt - a.createdAt));
    setProgress(storedProgress);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshTodayTasks = async () => {
    await generateDailyTasks();
    await rescheduleAllNotifications();
  };

  const deletePlan = async (id: number) => {
    await db.plans.delete(id);
    await rescheduleAllNotifications();
    load();
  };

  const toggleActive = async (plan: HifzPlan) => {
    await db.plans.update(plan.id!, { active: !plan.active });
    await refreshTodayTasks();
    load();
  };

  const handleSuggest = async () => {
    const suggestion = suggestPlan(goalText);
    const progressionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await Promise.all(suggestion.plans.map((plan) =>
      db.plans.add({ ...plan, progressionId, createdAt: Date.now() }),
    ));
    await refreshTodayTasks();
    setGoalText('');
    setShowSuggest(false);
    await load();
  };

  const surahSummaries = useMemo(() => SURAHS.map((surah) => {
    const memorizedAyahs = countCoveredAyahs(progress, ['memorized', 'strong', 'weak'], surah.id);
    const reviewedAyahs = countCoveredAyahs(progress, ['reviewing', 'strong', 'weak'], surah.id);
    return {
      surah,
      summary: {
        memorizedAyahs,
        reviewedAyahs,
        isMemorized: memorizedAyahs >= surah.ayahCount,
        isPartial: memorizedAyahs > 0 && memorizedAyahs < surah.ayahCount,
        hasReview: reviewedAyahs > 0,
      },
    };
  }), [progress]);
  const memorizedSurahs = surahSummaries.filter(({ summary }) => summary.isMemorized).length;
  const partiallyMemorizedSurahs = surahSummaries.filter(({ summary }) => summary.isPartial).length;
  const reviewedSurahs = surahSummaries.filter(({ summary }) => summary.hasReview).length;
  const visibleSurahs = surahSummaries.filter(({ surah, summary }) => {
    const query = surahSearch.trim().replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).toLowerCase();
    const matchesSearch = !query || surah.name.toLowerCase().includes(query) ||
      surah.nameLatin.toLowerCase().includes(query) || String(surah.id) === query;
    const matchesFilter = surahFilter === 'all' ||
      (surahFilter === 'memorized' && summary.isMemorized) ||
      (surahFilter === 'partial' && summary.isPartial) ||
      (surahFilter === 'notStarted' && summary.memorizedAyahs === 0) ||
      (surahFilter === 'reviewed' && summary.hasReview);
    return matchesSearch && matchesFilter;
  });

  const markSurahProgress = async (surahId: number, status: 'memorized' | 'reviewing') => {
    const surah = getSurah(surahId);
    if (!surah) return;
    await db.hifzProgress.add({
      surahId,
      ayahStart: 1,
      ayahEnd: surah.ayahCount,
      status,
      ratedAt: Date.now(),
    });
    await load();
  };

  return (
    <div className="space-y-4 pb-4">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-bl from-primary-700 via-primary-800 to-primary-950 p-5 text-white shadow-lg">
        <div className="pointer-events-none absolute -left-8 -top-10 h-40 w-40 rounded-full border border-white/10" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-wide text-white/70">رحلتك مع كتاب الله</p>
            <h1 className="mt-1 text-2xl font-bold">الحفظ والمراجعة</h1>
            <p className="mt-2 text-sm leading-6 text-white/75">خطط يومية وسجل واضح لما حفظته وما يحتاج إلى مراجعة</p>
          </div>
          <BookOpenCheck size={30} className="mt-1 shrink-0 text-gold-300" />
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <ProgressStat value={memorizedSurahs} label="سورة محفوظة" />
          <ProgressStat value={partiallyMemorizedSurahs} label="قيد الحفظ" />
          <ProgressStat value={reviewedSurahs} label="تمت مراجعتها" />
        </div>
      </section>

      <div className="flex gap-1.5 rounded-2xl border border-primary-100/80 bg-white/75 p-1.5 shadow-sm dark:border-primary-800/60 dark:bg-primary-950/45">
        {([
          { tab: 'plans' as const, label: 'خططي', icon: Calendar },
          { tab: 'surahs' as const, label: 'سجل السور', icon: BookOpenCheck },
        ]).map(({ tab, label, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2 text-sm font-semibold transition-all ${
              activeTab === tab
                ? 'bg-primary-700 text-white shadow-sm dark:bg-primary-600'
                : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700 dark:text-gray-400 dark:hover:bg-primary-900/60 dark:hover:text-primary-100'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'plans' && (
        <>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="gold" onClick={() => setShowSuggest(true)}>
              <Sparkles size={16} /> اقترح خطة
            </Button>
            <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> خطة جديدة
            </Button>
          </div>

          {plans.length === 0 && !showCreate && (
        <EmptyState
          icon={<Calendar size={48} />}
          title="لا توجد خطط بعد"
          description="خططك التي تنشئها أو تقترحها ستظهر هنا"
        />
          )}

      {/* Plans list */}
      <div className="space-y-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            onDelete={() => deletePlan(plan.id!)}
            onToggle={() => toggleActive(plan)}
          />
        ))}
      </div>
        </>
      )}

      {activeTab === 'surahs' && (
        <section className="space-y-3">
          <div className="relative">
            <Search size={17} className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-primary-500 dark:text-primary-300" />
            <input
              type="search"
              value={surahSearch}
              onChange={(event) => setSurahSearch(event.target.value)}
              aria-label="ابحث في سجل السور"
              placeholder="ابحث باسم السورة أو رقمها..."
              className="min-h-12 w-full rounded-2xl border border-primary-100 bg-white py-3 pl-4 pr-11 text-sm text-primary-800 shadow-sm outline-none transition focus:border-primary-400 focus:ring-4 focus:ring-primary-100/70 placeholder:text-gray-400 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-100 dark:focus:ring-primary-900/60"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-xl bg-primary-50/80 p-1 dark:bg-primary-900/35">
            {([
              { filter: 'all' as const, label: 'الكل' },
              { filter: 'memorized' as const, label: 'محفوظة' },
              { filter: 'partial' as const, label: 'قيد الحفظ' },
              { filter: 'notStarted' as const, label: 'لم تبدأ' },
              { filter: 'reviewed' as const, label: 'تمت مراجعتها' },
            ]).map(({ filter, label }) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSurahFilter(filter)}
                aria-pressed={surahFilter === filter}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  surahFilter === filter
                    ? 'bg-white text-primary-700 shadow-sm dark:bg-primary-800 dark:text-primary-100'
                    : 'text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-gray-500 dark:text-gray-400">يمكنك تحديث حالة السورة من أزرارها</p>
            <p className="text-xs font-semibold text-primary-700 dark:text-primary-200">{toArabicNumber(visibleSurahs.length)} سورة</p>
          </div>
          {visibleSurahs.length ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {visibleSurahs.map(({ surah, summary }) => (
                <SurahProgressCard
                  key={surah.id}
                  surahId={surah.id}
                  name={surah.name}
                  latinName={surah.nameLatin}
                  ayahCount={surah.ayahCount}
                  summary={summary}
                  onMarkMemorized={() => markSurahProgress(surah.id, 'memorized')}
                  onMarkReviewed={() => markSurahProgress(surah.id, 'reviewing')}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-primary-200 bg-white/60 px-4 py-10 text-center dark:border-primary-800 dark:bg-primary-950/30">
              <Search size={24} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">لا توجد سور في هذا التصنيف</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">غيّر الفلتر أو ابحث باسم سورة أخرى</p>
            </div>
          )}
        </section>
      )}

      {/* Create plan modal */}
      {showCreate && (
        <CreatePlanModal
          onClose={() => setShowCreate(false)}
          onSave={async (plan) => {
            await db.plans.add({ ...plan, createdAt: Date.now() });
            await refreshTodayTasks();
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* Suggest plan modal */}
      {showSuggest && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="suggest-plan-title"
            className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm animate-scale-in dark:border-primary-800 dark:bg-primary-900"
          >
            <div className="flex items-center justify-between p-4 border-b border-primary-100 dark:border-primary-800">
              <h2 id="suggest-plan-title" className="text-lg font-bold text-primary-800 dark:text-primary-100">اقتراح خطة</h2>
              <button onClick={() => setShowSuggest(false)} aria-label="إغلاق" className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-1">
                <p className="text-sm text-gray-600 dark:text-gray-300">اختر هدفاً أو اكتب اسم السورة أو الجزء:</p>
                <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                  التقدير يفترض نصف صفحة في جلسة الحفظ وخمس جلسات جديدة أسبوعياً. يتدرج الحفظ مقطعاً مقطعاً، وتُختار المراجعة من المقاطع التي أُنجزت. سنّ ٢١ لا يحدد سرعة واحدة؛ عدّل الوتيرة حسب وقتك وثبات التسميع.
                </p>
              </div>
              {SUGGESTION_EXAMPLES.map(({ category, goals }) => (
                <section key={category} className="space-y-2">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">{category}</h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {goals.map((example) => (
                      <button
                        key={example}
                        type="button"
                        aria-pressed={goalText === example}
                        onClick={() => setGoalText(example)}
                        className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition-smooth ${
                          goalText === example
                            ? 'border-primary-400 bg-primary-100 text-primary-800 dark:border-primary-500 dark:bg-primary-800 dark:text-primary-100'
                            : 'border-primary-100 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-800 dark:bg-primary-800/40 dark:text-primary-200 dark:hover:bg-primary-800'
                        }`}
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              <textarea
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="مثال: حفظ سورة الملك"
                className="min-h-20 w-full rounded-xl border border-primary-100 bg-gray-50 p-3 text-sm text-primary-800 focus:outline-none focus:border-primary-400 dark:border-primary-800 dark:bg-primary-800/30 dark:text-primary-100"
              />
              {goalSuggestion && (
                <div className="bg-gold-50 dark:bg-gold-900/20 rounded-xl p-3">
                  <p className="text-sm text-gold-800 dark:text-gold-300">
                    {goalSuggestion.description}
                  </p>
                  <div className="mt-2 space-y-1">
                    {goalSuggestion.plans.map((p, i) => (
                      <div key={i} className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                        <Badge variant={p.type === 'hifz' ? 'gold' : 'primary'}>
                          {p.type === 'hifz' ? 'حفظ' : 'مراجعة'}
                        </Badge>
                        <span>
                          {p.portionSequence
                            ? p.type === 'hifz'
                              ? `${p.portionSequence.length} مقطع حفظ تدريجي`
                              : 'مراجعة المقاطع المنجزة'
                            : describePortion(p.portion)} — {p.time}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-primary-100 dark:border-primary-800">
              <Button fullWidth variant="gold" onClick={handleSuggest} disabled={!goalText.trim()}>
                <Sparkles size={18} /> إنشاء الخطة المقترحة
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/10 px-2 py-2.5 text-center backdrop-blur-sm">
      <p className="text-xl font-bold">{toArabicNumber(value)}</p>
      <p className="mt-0.5 text-[10px] leading-4 text-white/75 sm:text-xs">{label}</p>
    </div>
  );
}

function SurahProgressCard({
  surahId,
  name,
  latinName,
  ayahCount,
  summary,
  onMarkMemorized,
  onMarkReviewed,
}: {
  surahId: number;
  name: string;
  latinName: string;
  ayahCount: number;
  summary: SurahProgressSummary;
  onMarkMemorized: () => void;
  onMarkReviewed: () => void;
}) {
  const percentage = Math.round((summary.memorizedAyahs / ayahCount) * 100);
  const status = summary.isMemorized
    ? { label: 'محفوظة', icon: BookOpenCheck, style: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' }
    : summary.isPartial
      ? { label: 'قيد الحفظ', icon: CircleDashed, style: 'bg-gold-100 text-gold-700 dark:bg-gold-900/30 dark:text-gold-300' }
      : { label: 'لم تبدأ', icon: CircleDashed, style: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' };
  const StatusIcon = status.icon;

  return (
    <Card className="!p-3 transition-all hover:border-primary-300 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary-200 bg-primary-50 text-sm font-bold text-primary-700 dark:border-primary-700 dark:bg-primary-800 dark:text-gold-300">
          {toArabicNumber(surahId)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-bold text-primary-800 dark:text-primary-100">{name}</h3>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.style}`}>
              <StatusIcon size={12} />
              {status.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">{latinName} · {toArabicNumber(ayahCount)} آية</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">الحفظ</span>
          <span className="font-semibold text-primary-700 dark:text-primary-200">
            {toArabicNumber(summary.memorizedAyahs)} / {toArabicNumber(ayahCount)} · {toArabicNumber(percentage)}٪
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-primary-800"
          role="progressbar"
          aria-label={`تقدم حفظ سورة ${name}`}
          aria-valuemin={0}
          aria-valuemax={ayahCount}
          aria-valuenow={summary.memorizedAyahs}
        >
          <div className="h-full rounded-full bg-gradient-to-l from-primary-500 to-gold-400 transition-all" style={{ width: `${percentage}%` }} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1 text-xs ${summary.hasReview ? 'text-primary-700 dark:text-primary-200' : 'text-gray-400 dark:text-gray-500'}`}>
            <RotateCcw size={13} />
            {summary.hasReview
              ? `تمت مراجعة ${toArabicNumber(summary.reviewedAyahs)} آية`
              : 'لم تسجل لها مراجعة'}
          </span>
          <div className="flex gap-1.5">
            {!summary.isMemorized && (
              <button
                type="button"
                onClick={onMarkMemorized}
                className="rounded-lg bg-success-50 px-2.5 py-1.5 text-[11px] font-semibold text-success-700 transition hover:bg-success-100 dark:bg-success-900/25 dark:text-success-300 dark:hover:bg-success-900/40"
              >
                تم الحفظ
              </button>
            )}
            <button
              type="button"
              onClick={onMarkReviewed}
              className="rounded-lg bg-primary-50 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-100 dark:bg-primary-800/60 dark:text-primary-200 dark:hover:bg-primary-800"
            >
              تمت المراجعة
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PlanCard({ plan, onDelete, onToggle }: { plan: HifzPlan; onDelete: () => void; onToggle: () => void }) {
  const typeLabel = plan.type === 'hifz' ? 'حفظ جديد' : 'مراجعة';
  return (
    <Card className={`border-r-4 ${plan.active ? 'border-r-primary-500' : 'border-r-gray-300 dark:border-r-gray-600'} animate-slide-up`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={plan.type === 'hifz' ? 'gold' : 'primary'}>{typeLabel}</Badge>
            {plan.active ? <Badge variant="success">نشط</Badge> : <Badge variant="neutral">متوقف</Badge>}
          </div>
          <h3 className="font-bold text-primary-800 dark:text-primary-100">{plan.name}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{describePortion(plan.portion)}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1"><Clock size={12} /> {plan.time}</span>
            <span className="flex items-center gap-1">
              {plan.daysOfWeek.sort().map((d) => getDayNameShort(d)).join('، ')}
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onToggle}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-smooth ${
              plan.active ? 'bg-success-100 text-success-600 dark:bg-success-900/30' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'
            }`}
          >
            <Check size={16} />
          </button>
          <button
            onClick={onDelete}
            className="w-8 h-8 rounded-lg bg-error-100 dark:bg-error-900/30 text-error-600 dark:text-error-400 flex items-center justify-center hover:bg-error-200 transition-smooth"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </Card>
  );
}

function CreatePlanModal({ onClose, onSave }: { onClose: () => void; onSave: (plan: Omit<HifzPlan, 'id' | 'createdAt'>) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'hifz' | 'muraja'>('hifz');
  const [portionType, setPortionType] = useState<'surah' | 'juz' | 'page'>('surah');
  const [surahId, setSurahId] = useState(1);
  const [juzId, setJuzId] = useState(30);
  const [pageId, setPageId] = useState(604);
  const [fromAyah, setFromAyah] = useState(1);
  const [toAyah, setToAyah] = useState<number | null>(null);
  const [time, setTime] = useState('06:00');
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  const toggleDay = (day: number) => {
    setDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  };

  const getPortionString = () => {
    if (portionType === 'surah') {
      const surah = getSurah(surahId);
      const range = fromAyah > 1 || (toAyah && toAyah < (surah?.ayahCount || 0))
        ? `${fromAyah}-${toAyah ?? surah?.ayahCount}`
        : '';
      return `surah:${surahId}${range ? ':' + range : ''}`;
    }
    if (portionType === 'juz') return `juz:${juzId}`;
    return `page:${pageId}`;
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      type,
      portion: getPortionString(),
      daysOfWeek: days,
      time,
      active: true,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-plan-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-xl animate-scale-in dark:border-primary-800 dark:bg-primary-900 sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-primary-100 bg-white p-4 dark:border-primary-800 dark:bg-primary-900">
          <h2 id="create-plan-title" className="text-lg font-bold text-primary-800 dark:text-primary-100">خطة جديدة</h2>
          <button onClick={onClose} aria-label="إغلاق" className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-primary-800">
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Name */}
        <div>
          <label htmlFor="plan-name" className="text-sm font-medium text-primary-700 dark:text-primary-200 mb-1 block">اسم الخطة</label>
          <input
            id="plan-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: حفظ جزء عمّ"
            className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2.5 px-3 text-sm text-primary-800 dark:text-primary-100 focus:outline-none focus:border-primary-400"
          />
        </div>

        {/* Type */}
        <div>
          <label className="text-sm font-medium text-primary-700 dark:text-primary-200 mb-1 block">النوع</label>
          <div className="flex gap-2">
            <button
              onClick={() => setType('hifz')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${type === 'hifz' ? 'bg-gold-500 text-white' : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'}`}
            >
              حفظ جديد
            </button>
            <button
              onClick={() => setType('muraja')}
              className={`flex-1 py-2 rounded-lg text-sm font-medium ${type === 'muraja' ? 'bg-primary-500 text-white' : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'}`}
            >
              مراجعة
            </button>
          </div>
        </div>

        {/* Portion type */}
        <div>
          <label className="text-sm font-medium text-primary-700 dark:text-primary-200 mb-1 block">الجزء</label>
          <div className="flex gap-2 mb-2">
            {(['surah', 'juz', 'page'] as const).map((pt) => (
              <button
                key={pt}
                onClick={() => setPortionType(pt)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium ${portionType === pt ? 'bg-primary-500 text-white' : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'}`}
              >
                {pt === 'surah' ? 'سورة' : pt === 'juz' ? 'جزء' : 'صفحة'}
              </button>
            ))}
          </div>
          {portionType === 'surah' && (
            <div className="space-y-2">
              <select
                value={surahId}
                onChange={(e) => { setSurahId(parseInt(e.target.value)); setFromAyah(1); setToAyah(null); }}
                className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
              >
                {SURAHS.map((s) => (
                  <option key={s.id} value={s.id}>{s.id}. {s.name} ({s.ayahCount} آية)</option>
                ))}
              </select>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <label htmlFor="plan-from-ayah" className="text-xs text-gray-500">من آية:</label>
                <input id="plan-from-ayah" type="number" min={1} value={fromAyah} onChange={(e) => setFromAyah(parseInt(e.target.value) || 1)}
                  className="min-w-0 rounded-lg border border-primary-100 bg-gray-50 px-2 py-1 text-center text-sm dark:bg-primary-800/30" />
                <label htmlFor="plan-to-ayah" className="text-xs text-gray-500">إلى:</label>
                <input id="plan-to-ayah" type="number" min={fromAyah} value={toAyah ?? ''} placeholder="النهاية"
                  onChange={(e) => setToAyah(e.target.value ? parseInt(e.target.value) : null)}
                  className="min-w-0 rounded-lg border border-primary-100 bg-gray-50 px-2 py-1 text-center text-sm dark:bg-primary-800/30" />
              </div>
            </div>
          )}
          {portionType === 'juz' && (
            <select
              value={juzId}
              onChange={(e) => setJuzId(parseInt(e.target.value))}
              className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
            >
              {JUZ_INFO.map((j) => (
                <option key={j.id} value={j.id}>{j.name} (صفحة {j.startPage}-{j.endPage})</option>
              ))}
            </select>
          )}
          {portionType === 'page' && (
            <input
              type="number"
              min={1}
              max={604}
              value={pageId}
              onChange={(e) => setPageId(parseInt(e.target.value) || 1)}
              className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
            />
          )}
        </div>

        {/* Time */}
        <div>
          <label className="text-sm font-medium text-primary-700 dark:text-primary-200 mb-1 block">الوقت</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2.5 px-3 text-sm text-primary-800 dark:text-primary-100"
          />
        </div>

        {/* Days */}
        <div>
          <label className="text-sm font-medium text-primary-700 dark:text-primary-200 mb-1 block">أيام الأسبوع</label>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-smooth ${
                  days.includes(day)
                    ? 'bg-primary-500 text-white'
                    : 'bg-gray-50 dark:bg-primary-800/30 text-gray-500 dark:text-gray-400'
                }`}
              >
                {getDayNameShort(day)}
              </button>
            ))}
          </div>
        </div>
        </div>
        <div className="shrink-0 border-t border-primary-100 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] dark:border-primary-800 dark:bg-primary-900">
          <Button fullWidth variant="primary" onClick={handleSave} disabled={!name.trim() || days.length === 0}>
            <Check size={18} /> حفظ الخطة
          </Button>
        </div>
      </div>
    </div>
  );
}
