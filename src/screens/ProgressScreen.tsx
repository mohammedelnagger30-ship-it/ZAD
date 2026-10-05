import { useState, useEffect, useCallback } from 'react';
import { Flame, TrendingUp, Award, BookOpen, Check, Calendar, Target } from 'lucide-react';
import { Card, SectionHeader } from '@/components/ui';
import { db } from '@/db/database';
import { getStreakCount } from '@/utils/taskManager';
import { getWeeklyPrayerStats, getMonthlyPrayerStats } from '@/utils/prayerTracker';
import { formatDateKey, getLast30Days, todayKey, addDays } from '@/utils/dateUtils';
import { TOTAL_QURAN_AYAHS, toArabicNumber } from '@/data/surahs';

export function ProgressScreen() {
  const [streak, setStreak] = useState(0);
  const [heatmapData, setHeatmapData] = useState<Record<string, { done: number; total: number }>>({});
  const [weeklyStats, setWeeklyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [memorizedAyahs, setMemorizedAyahs] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [doneTasks, setDoneTasks] = useState(0);
  const [badges, setBadges] = useState<string[]>([]);

  const load = useCallback(async () => {
    const s = await getStreakCount();
    setStreak(s);

    // Heatmap for last 30 days
    const last30 = getLast30Days();
    const heatMap: Record<string, { done: number; total: number }> = {};
    for (const date of last30) {
      const tasks = await db.tasks.where('date').equals(date).toArray();
      heatMap[date] = {
        done: tasks.filter((t) => t.status === 'done').length,
        total: tasks.length,
      };
    }
    setHeatmapData(heatMap);

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
    setTotalTasks(allTasks.length);
    setDoneTasks(allTasks.filter((t) => t.status === 'done').length);

    // Badges
    const earned: string[] = [];
    if (s >= 3) earned.push('بداية موفقة');
    if (s >= 7) earned.push('أسبوع متواصل');
    if (s >= 30) earned.push('شهر الإلتزام');
    if (uniqueAyahs.size >= 10) earned.push('حافظ صغير');
    if (uniqueAyahs.size >= 100) earned.push('حافظ مجتهد');
    if (uniqueAyahs.size >= 500) earned.push('حافظ متقن');
    if (allTasks.filter((t) => t.status === 'done').length >= 50) earned.push('مثابر');
    setBadges(earned);
  }, []);

  useEffect(() => { load(); }, [load]);

  const memorizationPercent = Math.round((memorizedAyahs / TOTAL_QURAN_AYAHS) * 100);

  // Generate calendar weeks for heatmap
  const today = new Date();
  const weeks: string[][] = [];
  const start = addDays(today, -29);
  // Align to start of week (Saturday in Arab world)
  const startDay = start.getDay();
  const adjustedStart = addDays(start, -startDay);
  let current = adjustedStart;
  while (current <= today) {
    const week: string[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(formatDateKey(current));
      current = addDays(current, 1);
    }
    weeks.push(week);
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">تقدّمي</h1>
        <TrendingUp size={28} className="text-primary-600 dark:text-gold-400" />
      </div>

      {/* Streak hero */}
      <div className="bg-gradient-to-bl from-accent-500 to-accent-700 rounded-3xl p-5 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-white/10 rounded-full -translate-x-16 -translate-y-16" />
        <div className="relative flex items-center gap-4">
          <Flame size={48} className="text-white" />
          <div>
            <p className="text-sm text-white/80">سلسلة الأيام المتتالية</p>
            <h2 className="text-4xl font-bold">{toArabicNumber(streak)} <span className="text-lg">يوم</span></h2>
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
          <div className="w-20 h-20 relative">
            <svg className="w-20 h-20 transform -rotate-90">
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
          <div className="h-full bg-gradient-to-l from-primary-500 to-gold-400 rounded-full transition-all duration-500" style={{ width: `${memorizationPercent}%` }} />
        </div>
      </Card>

      {/* Calendar heatmap */}
      <Card>
        <SectionHeader title="خريطة الالتزام" icon={<Calendar size={20} />} />
        <div className="overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((date) => {
                  const data = heatmapData[date];
                  const isToday = date === todayKey();
                  const isFuture = new Date(date) > today;
                  const ratio = data && data.total > 0 ? data.done / data.total : 0;
                  const intensity = isFuture ? 0 : ratio;
                  return (
                    <div
                      key={date}
                      className={`w-7 h-7 rounded-md transition-smooth ${
                        isFuture
                          ? 'bg-gray-50 dark:bg-gray-800/30'
                          : intensity === 0 && data?.total > 0
                          ? 'bg-error-100 dark:bg-error-900/30'
                          : intensity > 0 && intensity < 0.5
                          ? 'bg-warning-200 dark:bg-warning-800/50'
                          : intensity >= 0.5 && intensity < 1
                          ? 'bg-primary-300 dark:bg-primary-700'
                          : intensity === 1
                          ? 'bg-primary-500 dark:bg-primary-500'
                          : 'bg-gray-100 dark:bg-gray-800'
                      } ${isToday ? 'ring-2 ring-gold-400 ring-offset-1 dark:ring-offset-primary-900' : ''}`}
                      title={data ? `${date}: ${data.done}/${data.total}` : date}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span>أقل</span>
          <div className="flex gap-1">
            <div className="w-3 h-3 rounded bg-gray-100 dark:bg-gray-800" />
            <div className="w-3 h-3 rounded bg-error-100 dark:bg-error-900/30" />
            <div className="w-3 h-3 rounded bg-warning-200 dark:bg-warning-800/50" />
            <div className="w-3 h-3 rounded bg-primary-300 dark:bg-primary-700" />
            <div className="w-3 h-3 rounded bg-primary-500" />
          </div>
          <span>أكثر</span>
        </div>
      </Card>

      {/* Prayer stats */}
      {weeklyStats && monthlyStats && (
        <Card>
          <SectionHeader title="إحصائيات الصلاة" icon={<Award size={20} />} />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-primary-50 dark:bg-primary-800/20 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400">هذا الأسبوع</p>
              <p className="text-2xl font-bold text-primary-700 dark:text-gold-400 mt-1">{weeklyStats.percentage}%</p>
              <p className="text-xs text-gray-400 mt-1">
                {toArabicNumber(weeklyStats.ontime)} في وقتها · {toArabicNumber(weeklyStats.missed)} فائتة
              </p>
            </div>
            <div className="bg-gold-50 dark:bg-gold-900/20 rounded-xl p-3 text-center">
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
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-200">{toArabicNumber(totalTasks)}</p>
            <p className="text-xs text-gray-500">إجمالي</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-success-600">{toArabicNumber(doneTasks)}</p>
            <p className="text-xs text-gray-500">مكتملة</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary-700 dark:text-gold-400">
              {totalTasks > 0 ? toArabicNumber(Math.round((doneTasks / totalTasks) * 100)) + '%' : '٠%'}
            </p>
            <p className="text-xs text-gray-500">نسبة الإنجاز</p>
          </div>
        </div>
      </Card>

      {/* Badges/Achievements */}
      <Card>
        <SectionHeader title="الأوسمة" icon={<Award size={20} />} />
        {badges.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            ابدأ بالحفظ والمراجعة ل تكسب أوسمة!
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {badges.map((badge, i) => (
              <div key={i} className="flex flex-col items-center text-center animate-scale-in">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-bl from-gold-400 to-gold-600 flex items-center justify-center mb-1">
                  <Award size={24} className="text-white" />
                </div>
                <p className="text-xs font-medium text-primary-700 dark:text-primary-200">{badge}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
