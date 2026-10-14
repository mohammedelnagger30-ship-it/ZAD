import { useState, useEffect, useCallback } from 'react';
import { Flame, TrendingUp, Award, BookOpen, Check, Target, Share2, Download } from 'lucide-react';
import { Card, SectionHeader, Button } from '@/components/ui';
import { db, type Settings } from '@/db/database';
import { getStreakCount } from '@/utils/taskManager';
import { getWeeklyPrayerStats, getMonthlyPrayerStats } from '@/utils/prayerTracker';
import { TOTAL_QURAN_AYAHS, toArabicNumber } from '@/data/surahs';
import { DEFAULT_BADGES, shareBadge, type CustomBadge } from '@/data/customBadges';
import { exportProgressReport } from '@/utils/exportPDF';
import { YearHeatmap } from '@/components/YearHeatmap';

interface ProgressScreenProps {
  settings?: Settings;
}

export function ProgressScreen({ settings }: ProgressScreenProps) {
  const [streak, setStreak] = useState(0);
  const [weeklyStats, setWeeklyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ total: number; ontime: number; late: number; missed: number; unconfirmed: number; percentage: number } | null>(null);
  const [memorizedAyahs, setMemorizedAyahs] = useState(0);
  const [totalTasks, setTotalTasks] = useState(0);
  const [doneTasks, setDoneTasks] = useState(0);
  const [unlockedBadges, setUnlockedBadges] = useState<CustomBadge[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      await exportProgressReport();
    } catch (error) {
      console.error('Export failed:', error);
      alert('تعذّر تصدير تقرير التقدم');
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
    setTotalTasks(allTasks.length);
    setDoneTasks(allTasks.filter((t) => t.status === 'done').length);

    // Badges with custom emoji support
    const earned: CustomBadge[] = [];
    if (s >= 3) earned.push(DEFAULT_BADGES[0]); // بداية موفقة
    if (s >= 7) earned.push(DEFAULT_BADGES[1]); // أسبوع متواصل
    if (s >= 30) earned.push(DEFAULT_BADGES[2]); // شهر الإلتزام
    if (uniqueAyahs.size >= 10) earned.push(DEFAULT_BADGES[3]); // حافظ صغير
    if (uniqueAyahs.size >= 100) earned.push(DEFAULT_BADGES[4]); // حافظ مجتهد
    if (uniqueAyahs.size >= 500) earned.push(DEFAULT_BADGES[5]); // حافظ متقن
    if (allTasks.filter((t) => t.status === 'done').length >= 50) earned.push(DEFAULT_BADGES[6]); // مثابر
    setUnlockedBadges(earned);
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
        {unlockedBadges.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            ابدأ بالحفظ والمراجعة ل تكسب أوسمة!
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
            {unlockedBadges.map((badge) => (
              <div key={badge.id} className="flex flex-col items-center text-center animate-scale-in relative group">
                <div className="w-14 h-14 rounded-2xl bg-linear-to-bl from-gold-400 to-gold-600 flex items-center justify-center mb-1 shadow-lg">
                  <span className="text-2xl">{badge.emoji}</span>
                </div>
                <p className="text-xs font-medium text-primary-700 dark:text-primary-200">{badge.name}</p>
                {settings?.customBadgesEnabled && badge.shareable && (
                  <button
                    type="button"
                    onClick={() => void shareBadge(badge)}
                    className="absolute -top-2 -right-2 p-1.5 rounded-full bg-primary-600 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shadow-md hover:bg-primary-700"
                    title="مشاركة الوسام"
                  >
                    <Share2 size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
