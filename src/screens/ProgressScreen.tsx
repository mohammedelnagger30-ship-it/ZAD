import { useState, useEffect, useCallback } from 'react';
import { Flame, TrendingUp, Award, BookOpen, Check, Target, Share2, Download, Lock } from 'lucide-react';
import { Card, SectionHeader, Button } from '@/components/ui';
import { db, type Settings } from '@/db/database';
import { getStreakCount } from '@/utils/taskManager';
import { getWeeklyPrayerStats, getMonthlyPrayerStats } from '@/utils/prayerTracker';
import { todayKey } from '@/utils/dateUtils';
import { TOTAL_QURAN_AYAHS, toArabicNumber } from '@/data/surahs';
import { shareBadge } from '@/data/customBadges';
import { evaluateBadges, type BadgeMetrics, type BadgeProgress } from '@/utils/badgeProgress';
import { describeKhatmah } from '@/utils/khatmah';
import { ADHKAR_STATE_KEY } from '@/utils/backup';
import { normalizeCompletedDays } from '@/utils/adhkarDays';
import { exportProgressReport } from '@/utils/exportPDF';
import { useSnackbar } from '@/hooks/useSnackbar';
import { YearHeatmap } from '@/components/YearHeatmap';

interface ProgressScreenProps {
  settings?: Settings;
}

/**
 * How many days the daily adhkar was carried through, as the counters
 * recorded them.
 *
 * The counters themselves only ever hold today, so this reads the list of
 * completed days that the adhkar screen appends to. A backup that predates
 * that list simply counts as none — the badge starts from zero rather than
 * the screen failing over a field it might not find.
 */
function readAdhkarDays(): number {
  try {
    const raw = localStorage.getItem(ADHKAR_STATE_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { completedDays?: unknown };
    // Through the same normalizer the adhkar screen writes with, so a list
    // merged from another device is not counted twice on this screen either.
    return normalizeCompletedDays(parsed.completedDays).length;
  } catch {
    // An unreadable counter must not take the whole progress screen down.
    return 0;
  }
}

export function ProgressScreen({ settings }: ProgressScreenProps) {
  const [streak, setStreak] = useState(0);
  const [weeklyStats, setWeeklyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [memorizedAyahs, setMemorizedAyahs] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [doneTasks, setDoneTasks] = useState(0);
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const { show, snackbar } = useSnackbar();

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      await exportProgressReport();
    } catch (error) {
      console.error('Export failed:', error);
      // A bar, not a dialog: the export failed, nothing is pending an answer,
      // and the person's other choice is a modal they must dismiss with a tap
      // they did not want to spend. The app already has a bar for exactly this.
      show({ message: 'تعذّر تصدير تقرير التقدم' });
    } finally {
      setIsExporting(false);
    }
  };

  const load = useCallback(async () => {
    const s = await getStreakCount();
    setStreak(s);

    // Prayer stats
    setWeeklyStats(await getWeeklyPrayerStats());
    setMonthlyStats(await getMonthlyPrayerStats());

    // Memorized ayahs
    const progress = await db.hifzProgress.toArray();
    const uniqueAyahs = new Set<string>();
    progress.forEach((p) => {
      for (let i = p.ayahStart; i <= p.ayahEnd; i++) {
        uniqueAyahs.add(`${p.surahId}:${i}`);
      }
    });
    setMemorizedAyahs(uniqueAyahs.size);

    // Overall task stats
    const allTasks = await db.tasks.toArray();
    const completedTasks = allTasks.filter((t) => t.status === 'done').length;
    setTotalTasks(allTasks.length);
    setDoneTasks(completedTasks);

    // Every figure the badges are measured against. Three of these had a
    // badge named for them and nothing in this screen that could ever feed
    // it — they were unreachable precisely because no one was shown them.
    const prayerRecords = await db.prayerRecords.toArray();
    const ontimePrayers = prayerRecords.filter((record) => record.status === 'ontime').length;

    const plans = await db.khatmah.toArray();
    const today = todayKey();
    const completedKhatmahs = plans.filter((plan) => describeKhatmah(plan, today).finished).length;

    const metrics: BadgeMetrics = {
      streak: s,
      memorizedAyahs: uniqueAyahs.size,
      completedTasks,
      ontimePrayers,
      completedKhatmahs,
      adhkarDays: readAdhkarDays(),
    };
    setBadgeProgress(evaluateBadges(metrics));
  }, []);

  useEffect(() => { load(); }, [load]);

  const memorizationPercent = Math.round((memorizedAyahs / TOTAL_QURAN_AYAHS) * 100);

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">تقدّمي</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-2"
          >
            <Download size={16} />
            {isExporting ? 'جارٍ التصدير...' : 'تصدير تقرير'}
          </Button>
          <TrendingUp size={28} className="text-primary-600 dark:text-gold-400" />
        </div>
      </div>

      {/* Streak hero */}
      <div className="bg-linear-to-bl from-accent-500 to-accent-700 rounded-3xl p-5 md:p-7 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-white/10 rounded-full -translate-x-16 -translate-y-16" />
        <div className="relative flex items-center gap-4">
          <Flame size={48} className="text-white md:scale-110" />
          <div>
            <p className="text-sm text-white/80">سلسلة الأيام المتتالية</p>
            <h2 className="text-4xl md:text-5xl font-bold">{toArabicNumber(streak)} <span className="text-lg">يوم</span></h2>
          </div>
        </div>
      </div>

      {/* Memorization progress */}
      <Card>
        <SectionHeader title="نسبة حفظ القرآن" icon={<BookOpen size={20} />} />
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-3xl font-bold text-primary-700 dark:text-gold-400">{memorizationPercent}%</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {toArabicNumber(memorizedAyahs)} من {toArabicNumber(TOTAL_QURAN_AYAHS)} آية
            </p>
          </div>
          <div className="w-20 h-20 md:w-28 md:h-28 relative">
            <svg className="w-20 h-20 md:w-28 md:h-28 transform -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" className="text-gray-200 dark:text-gray-700" />
              <circle
                cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6"
                className="text-primary-500"
                strokeDasharray={2 * Math.PI * 34}
                strokeDashoffset={2 * Math.PI * 34 * (1 - memorizationPercent / 100)}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <Target size={20} className="text-primary-500" />
            </div>
          </div>
        </div>
        <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-linear-to-l from-primary-500 to-gold-400 rounded-full transition-all duration-500" style={{ width: `${memorizationPercent}%` }} />
        </div>
      </Card>

      {/* Calendar heatmap */}
      <YearHeatmap />

      {/* Prayer stats */}
      {weeklyStats && monthlyStats && (
        <Card>
          <SectionHeader title="إحصائيات الصلاة" icon={<Award size={20} />} />
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <div className="bg-primary-50 dark:bg-primary-800/20 rounded-xl p-3 md:p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">هذا الأسبوع</p>
              <p className="text-2xl font-bold text-primary-700 dark:text-gold-400 mt-1">{weeklyStats.percentage}%</p>
              <p className="text-xs text-gray-400 mt-1">
                {toArabicNumber(weeklyStats.ontime)} في وقتها · {toArabicNumber(weeklyStats.missed)} فائتة
              </p>
            </div>
            <div className="bg-gold-50 dark:bg-gold-900/20 rounded-xl p-3 md:p-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">هذا الشهر</p>
              <p className="text-2xl font-bold text-gold-700 dark:text-gold-400 mt-1">{monthlyStats.percentage}%</p>
              <p className="text-xs text-gray-400 mt-1">
                {toArabicNumber(monthlyStats.ontime)} في وقتها · {toArabicNumber(monthlyStats.missed)} فائتة
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Task completion */}
      <Card>
        <SectionHeader title="إنجاز المهام" icon={<Check size={20} />} />
        <div className="grid grid-cols-3 gap-3 md:gap-6 text-center">
          <div>
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-200">{toArabicNumber(totalTasks)}</p>
            <p className="text-xs md:text-sm text-gray-500">إجمالي</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-success-600">{toArabicNumber(doneTasks)}</p>
            <p className="text-xs md:text-sm text-gray-500">مكتملة</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-700 dark:text-gold-400">
              {totalTasks > 0 ? toArabicNumber(Math.round((doneTasks / totalTasks) * 100)) + '%' : '٠%'}
            </p>
            <p className="text-xs md:text-sm text-gray-500">نسبة الإنجاز</p>
          </div>
        </div>
      </Card>

      {/* Badges/Achievements */}
      <Card>
        <SectionHeader title="الأوسمة" icon={<Award size={20} />} />
        {badgeProgress.length === 0 ? (
          <p role="status" className="py-4 text-center text-sm text-gray-400 dark:text-gray-500">
            جارٍ تحميل الأوسمة...
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {badgeProgress.map(({ badge, value, target, unlocked, fraction }) => (
              <div
                key={badge.id}
                className={`group relative flex flex-col items-center rounded-2xl border p-3 text-center ${
                  unlocked
                    ? 'animate-scale-in border-gold-200 bg-gold-50/60 dark:border-gold-800 dark:bg-gold-900/10'
                    : 'border-dashed border-gray-200 bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/20'
                }`}
              >
                <div
                  className={`relative mb-1.5 flex h-14 w-14 items-center justify-center rounded-2xl ${
                    unlocked ? 'bg-linear-to-bl from-gold-400 to-gold-600 shadow-lg' : ''
                  }`}
                >
                  <span className={`text-2xl ${unlocked ? '' : 'opacity-30 grayscale'}`}>
                    {badge.emoji}
                  </span>
                  {!unlocked && (
                    <span
                      aria-hidden="true"
                      className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-gray-500 ring-2 ring-white dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-900"
                    >
                      <Lock size={11} />
                    </span>
                  )}
                </div>

                <p
                  className={`text-xs font-semibold ${
                    unlocked ? 'text-primary-800 dark:text-gold-300' : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {badge.name}
                </p>
                <p className="mt-0.5 text-[0.6875rem] leading-snug text-gray-500 dark:text-gray-400">
                  {badge.description}
                </p>

                {unlocked ? (
                  settings?.customBadgesEnabled && badge.shareable ? (
                    <button
                      type="button"
                      onClick={() => void shareBadge(badge)}
                      aria-label="مشاركة الوسام"
                      className="absolute -top-2 -right-2 rounded-full bg-primary-600 p-1.5 text-white opacity-100 shadow-md transition-opacity hover:bg-primary-700 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Share2 size={12} />
                    </button>
                  ) : null
                ) : (
                  /* A goal you cannot see is not a goal — the bar and the two
                     numbers are what make «سعي» mean something. */
                  <div className="mt-2 w-full">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                      <div
                        className="h-full rounded-full bg-linear-to-l from-primary-500 to-gold-400 transition-all duration-500"
                        style={{ width: `${Math.round(fraction * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[0.625rem] text-gray-400 dark:text-gray-500">
                      {toArabicNumber(value)} من {toArabicNumber(target)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
      {snackbar}
    </div>
  );
}
