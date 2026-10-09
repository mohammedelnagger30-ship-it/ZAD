import { useState, useEffect, useCallback } from 'react';
import { Check, X, Clock, Flame, BookOpen, Moon, Sunrise, BookText, ChevronLeft, Sparkles, Calendar, Heart, Repeat } from 'lucide-react';
import { Card, Button, Badge, SectionHeader, EmptyState, type BadgeProps } from '@/components/ui';
import { PrayerStatusSheet } from '@/components/PrayerStatusSheet';
import { type DailyTask, type Settings, type TaskStatus } from '@/db/database';
import { getTodayTasks, confirmTask, snoozeTask, unsnoozeTask, describePortion, getStreakCount } from '@/utils/taskManager';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import {
  calculatePrayerTimes,
  formatTime12h,
  getTimeUntil,
  getNextPrayer,
  getPrayerTimeZone,
} from '@/utils/prayerTimes';
import {
  getDayPrayerRecords,
  confirmPrayer,
  clearPrayer,
  getDaySunnahRecords,
  setSunnah,
  RAWATIB_BY_PRAYER,
  sunnahDoneMap,
  type PrayerKey,
  type PrayerStatus,
} from '@/utils/prayerTracker';
import { todayKey, formatArabicDate, getHijriDate, getDayName } from '@/utils/dateUtils';
import { getDailyQuranMessage, type DailyQuranMessage } from '@/utils/dailyQuranMessage';
import { getHadithCollection, hadithOfDay, installedCollections, HADITH_OF_DAY_BOOK } from '@/data/hadiths';
import { toArabicNumber } from '@/data/surahs';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface HomeScreenProps {
  settings: Settings;
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

export function HomeScreen({ settings, navigate }: HomeScreenProps) {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [streak, setStreak] = useState(0);
  const [prayerRecords, setPrayerRecords] = useState<Record<string, PrayerStatus | null>>({});
  const [prayerConfirmedAt, setPrayerConfirmedAt] = useState<Record<string, number | null>>({});
  const [sunnahRecords, setSunnahRecords] = useState<Record<string, boolean>>({});
  const [dailyQuranMessage, setDailyQuranMessage] = useState<DailyQuranMessage | null>(null);
  const [dailyQuranMessageError, setDailyQuranMessageError] = useState('');
  // Drives the "time until next prayer" countdown. Stored as a timestamp (not a bare
  // counter) so it can be handed to `getTimeUntil` as the reference clock.
  const [now, setNow] = useState(() => new Date());
  // Which prayer the confirmation sheet is open for, if any.
  const [sheetPrayer, setSheetPrayer] = useState<PrayerKey | null>(null);
  const today = new Date();

  const load = useCallback(async () => {
    const t = await getTodayTasks();
    setTasks(t);
    const s = await getStreakCount();
    setStreak(s);
    const records = await getDayPrayerRecords(todayKey());
    const map: Record<string, PrayerStatus | null> = {};
    const confirmationTimes: Record<string, number | null> = {};
    records.forEach((r) => {
      map[r.prayer] = r.status;
      confirmationTimes[r.prayer] = r.confirmedAt ?? null;
    });
    setPrayerRecords(map);
    setPrayerConfirmedAt(confirmationTimes);
    setSunnahRecords(sunnahDoneMap(await getDaySunnahRecords(todayKey())));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    try {
      setDailyQuranMessage(getDailyQuranMessage(now));
      setDailyQuranMessageError('');
    } catch (error) {
      setDailyQuranMessage(null);
      setDailyQuranMessageError(error instanceof Error ? error.message : 'تعذّر تحميل رسالة القرآن اليومية.');
    }
  }, [now]);

  // Calculate prayer times
  const prayerTimeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
  const prayerResult = settings.latitude != null && settings.longitude != null
    ? calculatePrayerTimes(settings.latitude, settings.longitude, now, settings.calcMethod, settings.asrMadhab, prayerTimeZone)
    : null;

  const nextPrayer = settings.latitude != null && settings.longitude != null
    ? getNextPrayer(settings.latitude, settings.longitude, settings.calcMethod, settings.asrMadhab, prayerTimeZone)
    : null;

  const [hadith, setHadith] = useState(() => hadithOfDay());
  // True while the default collection is being fetched on a fresh install. Sahih Muslim
  // is ~8.3 MB, so the prompt card says what is happening instead of sitting still.
  const [seedingHadith, setSeedingHadith] = useState(false);

  // "Hadith of the day" needs a collection on the device. On a fresh install none exists,
  // so the default collection (صحيح مسلم) is fetched once — about 8.3 MB, saved for good —
  // and the card then works offline from then on.
  //
  // The installed case has to *open* a collection, not merely find one on the device:
  // `hadithOfDay()` reads a synchronous in-memory snapshot that is empty on every fresh
  // boot, and only parsing a collection fills it. Checking the store and then calling
  // `hadithOfDay()` without opening anything left the snapshot empty, so the card fell back
  // to its "download a book" prompt on every launch after the first — including offline
  // launches, with the collection sitting right there in IndexedDB.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const installed = await installedCollections();
        // Prefer the default collection so the card is stable, otherwise take the first
        // installed id in a fixed order so the choice does not vary with store iteration.
        const id = installed.has(HADITH_OF_DAY_BOOK)
          ? HADITH_OF_DAY_BOOK
          : [...installed].sort()[0];
        if (!id && !cancelled) setSeedingHadith(true);
        try {
          // `getHadithCollection` reads from IndexedDB when the file is already there, so
          // this costs nothing offline and never re-downloads.
          await getHadithCollection(id ?? HADITH_OF_DAY_BOOK);
        } finally {
          if (!cancelled) setSeedingHadith(false);
        }
        if (!cancelled) setHadith(hadithOfDay());
      } catch {
        // Offline or blocked: the card renders its own prompt.
        if (!cancelled) setSeedingHadith(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleConfirm = async (taskId: number, status: 'done' | 'missed', strength?: 'weak' | 'medium' | 'strong') => {
    await confirmTask(taskId, status, strength);
    load();
  };

  const handleSnooze = async (taskId: number, minutes: number) => {
    await snoozeTask(taskId, minutes);
    try {
      await rescheduleAllNotifications();
    } finally {
      await load();
    }
  };

  const handleUnsnooze = async (taskId: number) => {
    await unsnoozeTask(taskId);
    try {
      await rescheduleAllNotifications();
    } finally {
      await load();
    }
  };

  const handlePrayerPick = async (status: PrayerStatus) => {
    if (!sheetPrayer) return;
    await confirmPrayer(todayKey(), sheetPrayer, status);
    await load();
  };

  const handlePrayerClear = async () => {
    if (!sheetPrayer) return;
    await clearPrayer(todayKey(), sheetPrayer);
    await load();
    setSheetPrayer(null);
  };

  /** Records one rawatib slot attached to the prayer the sheet is open for. */
  const handleSunnahToggle = async (type: string) => {
    if (!sheetPrayer) return;
    await setSunnah(todayKey(), type, !sunnahRecords[type]);
    await load();
  };

  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'snoozed');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  return (
    <div className="space-y-5 pb-4">
      {/* Header with greeting */}
      <div className="bg-gradient-to-bl from-primary-700 to-primary-900 dark:from-primary-800 dark:to-primary-950 rounded-3xl p-5 text-white relative overflow-hidden">
        <div className="absolute top-0 left-0 w-32 h-32 bg-gold-400/10 rounded-full -translate-x-16 -translate-y-16" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-gold-400/5 rounded-full translate-x-12 translate-y-12" />
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-gold-300 text-sm">{getDayName(today)}</p>
              <h1 className="text-2xl font-bold mt-0.5">السلام عليكم</h1>
            </div>
            <div className="text-left">
              <p className="text-xs text-primary-200">{formatArabicDate(today)}</p>
              <p className="text-xs text-gold-300 mt-0.5">{getHijriDate(today)}</p>
            </div>
          </div>

          {/* Next prayer card */}
          {nextPrayer && (
            <div className="mt-4 bg-white/10 rounded-2xl p-3 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sunrise size={20} className="text-gold-300" />
                  <div>
                    <p className="text-xs text-primary-200">الصلاة القادمة</p>
                    <p className="font-bold text-gold-300">{nextPrayer.arabicName}</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-bold text-lg">{formatTime12h(nextPrayer.time, prayerTimeZone)}</p>
                  <p className="text-xs text-primary-200">{getTimeUntil(nextPrayer.time, now)}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Shortcuts */}
      <div className="grid grid-cols-4 gap-2.5">
        <button
          type="button"
          onClick={() => navigate('quran')}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-sm hover:border-primary-400 transition-all hover:scale-[1.02] active:scale-95"
        >
          <div className="h-10 w-10 rounded-xl bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-gold-400 flex items-center justify-center mb-1.5 shadow-sm">
            <BookOpen size={20} />
          </div>
          <span className="text-xs font-bold text-primary-900 dark:text-primary-100">المصحف</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('prayer')}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-sm hover:border-primary-400 transition-all hover:scale-[1.02] active:scale-95"
        >
          <div className="h-10 w-10 rounded-xl bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-gold-400 flex items-center justify-center mb-1.5 shadow-sm">
            <Moon size={20} />
          </div>
          <span className="text-xs font-bold text-primary-900 dark:text-primary-100">الصلاة</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('adhkar')}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-sm hover:border-primary-400 transition-all hover:scale-[1.02] active:scale-95"
        >
          <div className="h-10 w-10 rounded-xl bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-gold-400 flex items-center justify-center mb-1.5 shadow-sm">
            <Heart size={20} />
          </div>
          <span className="text-xs font-bold text-primary-900 dark:text-primary-100">الأذكار</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('tasbih')}
          className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-sm hover:border-primary-400 transition-all hover:scale-[1.02] active:scale-95"
        >
          <div className="h-10 w-10 rounded-xl bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-gold-400 flex items-center justify-center mb-1.5 shadow-sm">
            <Repeat size={20} />
          </div>
          <span className="text-xs font-bold text-primary-900 dark:text-primary-100">المسبحة</span>
        </button>
      </div>

      <Card className="border-gold-200 bg-gradient-to-bl from-gold-50 to-white dark:border-gold-800/50 dark:from-gold-900/20 dark:to-primary-900/50">
        <div className="flex items-center gap-2 text-primary-700 dark:text-gold-300">
          <Sparkles size={18} />
          <h2 className="font-bold">رسالة اليوم من القرآن</h2>
        </div>
        {dailyQuranMessage ? (
          <>
            <p className="mt-3 text-lg leading-[2.2] text-primary-900 dark:text-primary-50 quran-text">
              {dailyQuranMessage.text}
            </p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              سورة {dailyQuranMessage.surahName} — الآية {toArabicNumber(dailyQuranMessage.ayahNumber)}
            </p>
            <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
              آية للتدبر من نص المصحف؛ لا تُعرض كتفسير للآية.
            </p>
          </>
        ) : (
          <p role="status" className="mt-3 text-sm text-error-700 dark:text-error-300">
            {dailyQuranMessageError || 'جارٍ تحميل رسالة اليوم...'}
          </p>
        )}
      </Card>

      {/* Streak + quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="flex flex-col items-center text-center !p-3">
          <Flame size={24} className={streak > 0 ? 'text-accent-500' : 'text-gray-300 dark:text-gray-600'} />
          <p className="text-2xl font-bold text-primary-700 dark:text-primary-200 mt-1">{streak}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">أيام متتالية</p>
        </Card>
        <Card className="flex flex-col items-center text-center !p-3">
          <Check size={24} className="text-success-500" />
          <p className="text-2xl font-bold text-primary-700 dark:text-primary-200 mt-1">{doneTasks.length}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">مهام مكتملة</p>
        </Card>
        <Card className="flex flex-col items-center text-center !p-3">
          <Clock size={24} className="text-warning-500" />
          <p className="text-2xl font-bold text-primary-700 dark:text-primary-200 mt-1">{pendingTasks.length}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">مهام معلقة</p>
        </Card>
      </div>

      {/* Today's tasks */}
      <div>
        <SectionHeader
          title="مهام اليوم"
          icon={<BookOpen size={20} />}
          action={
            <button onClick={() => navigate('planner')} className="text-sm text-primary-600 dark:text-gold-400 flex items-center gap-0.5">
              <span>الخطة</span>
              <ChevronLeft size={16} />
            </button>
          }
        />
        {tasks.length === 0 ? (
          <EmptyState
            icon={<Calendar size={48} />}
            title="لا توجد مهام اليوم"
            description="أنشئ خطة حفظ ومراجعة لترى مهامك اليومية هنا"
            action={<Button onClick={() => navigate('planner')} variant="primary" size="sm">إنشاء خطة</Button>}
          />
        ) : (
          <div className="space-y-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                snoozeMinutes={settings.snoozeMinutes}
                onConfirm={handleConfirm}
                onSnooze={handleSnooze}
                onUnsnooze={handleUnsnooze}
              />
            ))}
          </div>
        )}
      </div>

      {/* Prayer times today */}
      {prayerResult && (
        <div>
          <SectionHeader
            title="مواقيت الصلاة"
            icon={<Moon size={20} />}
            action={
              <button onClick={() => navigate('prayer')} className="text-sm text-primary-600 dark:text-gold-400 flex items-center gap-0.5">
                <span>تفاصيل</span>
                <ChevronLeft size={16} />
              </button>
            }
          />
          <Card noPadding>
            <div className="grid grid-cols-3 gap-1 p-2">
              {prayerResult.prayers.map((prayer) => {
                const isSunrise = prayer.name === 'sunrise';
                const record = prayerRecords[prayer.name] ?? null;
                const answerable = !isSunrise && prayer.passed;

                const body = (
                  <>
                    <p className={`text-xs font-medium ${isSunrise ? 'text-gold-600 dark:text-gold-400' : 'text-primary-600 dark:text-primary-300'}`}>
                      {prayer.arabicName}
                    </p>
                    <p className="text-sm font-bold text-primary-800 dark:text-primary-100 mt-0.5">
                      {formatTime12h(prayer.time, prayerTimeZone)}
                    </p>
                    <div className="mt-1.5 min-h-[1.25rem] flex items-center justify-center">
                      {isSunrise ? (
                        <Badge variant="gold">شروق</Badge>
                      ) : !prayer.passed ? null : record === 'ontime' ? (
                        <Badge variant="success"><Check size={10} /> في وقتها</Badge>
                      ) : record === 'late' ? (
                        <Badge variant="warning"><Clock size={10} /> قضاء</Badge>
                      ) : record === 'missed' ? (
                        <Badge variant="error"><X size={10} /> لم تصلَّ</Badge>
                      ) : (
                        <Badge variant="neutral">لم تسجّلها</Badge>
                      )}
                    </div>
                  </>
                );

                // The whole tile is the target. The previous 24px dots were well under
                // the 44px a finger reliably hits, and the grey undo ✕ sat next to the
                // red "missed" ✕ — so confirming was easy and undoing was not.
                if (!answerable) {
                  return (
                    <div
                      key={prayer.name}
                      className={`rounded-xl p-2.5 text-center ${prayer.passed ? 'bg-gray-50 dark:bg-gray-800/30' : 'bg-gray-50 dark:bg-gray-800/30'}`}
                    >
                      {body}
                    </div>
                  );
                }

                const key = prayer.name as PrayerKey;
                return (
                  <button
                    key={prayer.name}
                    onClick={() => setSheetPrayer(key)}
                    aria-label={`صلاة ${prayer.arabicName} — ${
                      record
                        ? (prayerConfirmedAt[prayer.name] != null &&
                          Date.now() - prayerConfirmedAt[prayer.name]! < 10_000
                          ? 'مسجّلة، اضغط لعرض مهلة التعديل'
                          : 'مسجّلة، التعديل مقفول')
                        : 'لم تسجّل بعد، اضغط للتأكيد'
                    }`}
                    className={`rounded-xl p-2.5 text-center transition-smooth active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 ${
                      record
                        ? 'bg-primary-50 dark:bg-primary-800/30'
                        : 'bg-gray-50 dark:bg-gray-800/30 hover:bg-primary-100/70 dark:hover:bg-primary-800/50'
                    }`}
                  >
                    {body}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* Prayer confirmation */}
      {sheetPrayer && prayerResult && (
        <PrayerStatusSheet
          prayer={sheetPrayer}
          timeLabel={formatTime12h(
            prayerResult.prayers.find((p) => p.name === sheetPrayer)!.time,
            prayerTimeZone,
          )}
          status={prayerRecords[sheetPrayer] ?? null}
          confirmedAt={prayerConfirmedAt[sheetPrayer]}
          sunnahs={RAWATIB_BY_PRAYER[sheetPrayer].map((slot) => ({
            ...slot,
            done: !!sunnahRecords[slot.type],
          }))}
          onToggleSunnah={(type) => void handleSunnahToggle(type)}
          onPick={handlePrayerPick}
          onClear={handlePrayerClear}
          onClose={() => setSheetPrayer(null)}
        />
      )}

      {/* Hadith of the day */}
      <div>
        <SectionHeader
          title="حديث اليوم"
          icon={<BookText size={20} />}
          action={
            <button onClick={() => navigate('hadith')} className="text-sm text-primary-600 dark:text-gold-400 flex items-center gap-0.5">
              <span>المكتبة</span>
              <ChevronLeft size={16} />
            </button>
          }
        />
        {hadith ? (
          <Card onClick={() => navigate('hadith', { hadithId: hadith.id })}>
            <div className="flex items-start gap-3">
              <Sparkles size={20} className="text-gold-500 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="text-sm leading-relaxed text-primary-800 dark:text-primary-100 line-clamp-3 quran-text whitespace-pre-line">
                  {hadith.text}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {hadith.collectionTitle} — رقم {toArabicNumber(hadith.number)}
                </p>
              </div>
            </div>
        </Card>
        ) : (
          <Card onClick={() => navigate('hadith')}>
            <div className="flex items-start gap-3">
              <Sparkles size={20} className="text-gold-500 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="text-sm leading-relaxed text-primary-800 dark:text-primary-100">
                  {seedingHadith
                    ? 'جارٍ تحميل صحيح مسلم — قد يطول قليلاً على شبكة بطيئة.'
                    : 'حمّل كتاب حديث لتظهر هنا أحاديث اليوم من فضلك.'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  {seedingHadith
                    ? '٧٣٦٠ حديثاً · ٨.٣ ميجابايت · يُحفظ على جهازك مرة واحدة'
                    : 'يبدأ بصحيح مسلم — أساس المكتبة، ٨.٣ ميجابايت مرة واحدة'}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// Task card component with confirmation buttons
function TaskCard({
  task,
  snoozeMinutes,
  onConfirm,
  onSnooze,
  onUnsnooze,
}: {
  task: DailyTask;
  snoozeMinutes: number;
  onConfirm: (id: number, status: 'done' | 'missed', strength?: 'weak' | 'medium' | 'strong') => void;
  onSnooze: (id: number, minutes: number) => void;
  onUnsnooze: (id: number) => void;
}) {
  const [showStrength, setShowStrength] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  const typeLabel = task.type === 'hifz' ? 'حفظ' : 'مراجعة';
  const typeColor: BadgeProps['variant'] = task.type === 'hifz' ? 'gold' : 'primary';
  const portionDesc = describePortion(task.portion);

  const statusBg: Record<TaskStatus, string> = {
    done: 'border-r-success-500 bg-success-50/50 dark:bg-success-900/20',
    missed: 'border-r-error-500 bg-error-50/50 dark:bg-error-900/20',
    pending: 'border-r-primary-500',
    snoozed: 'border-r-warning-500 bg-warning-50/50 dark:bg-warning-900/20',
  };

  return (
    <Card className={`border-r-4 ${statusBg[task.status]} animate-slide-up`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={typeColor}>{typeLabel}</Badge>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {task.status === 'snoozed' && task.snoozedUntil
                ? new Date(task.snoozedUntil).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : task.scheduledTime}
            </span>
            {task.status === 'done' && <Badge variant="success"><Check size={10} /> تم</Badge>}
            {task.status === 'missed' && <Badge variant="error"><X size={10} /> فات</Badge>}
            {task.status === 'snoozed' && <Badge variant="warning"><Clock size={10} /> مؤجل</Badge>}
          </div>
          <p className="font-semibold text-primary-800 dark:text-primary-100">{portionDesc}</p>
        </div>
      </div>

      {task.status === 'pending' && !showStrength && !showSnooze && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="success" onClick={() => setShowStrength(true)} className="flex-1">
            <Check size={16} /> تم
          </Button>
          <Button size="sm" variant="error" onClick={() => onConfirm(task.id!, 'missed')} className="flex-1">
            <X size={16} /> لم أتمكن
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowSnooze(true)}>
            <Clock size={16} /> أجّل
          </Button>
        </div>
      )}

      {task.status === 'snoozed' && !showStrength && (
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="success" onClick={() => setShowStrength(true)} className="flex-1">
            <Check size={16} /> تم
          </Button>
          <Button size="sm" variant="error" onClick={() => onConfirm(task.id!, 'missed')} className="flex-1">
            <X size={16} /> لم أتمكن
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onUnsnooze(task.id!)} className="flex-1">
            إلغاء التأجيل
          </Button>
        </div>
      )}

      {showStrength && (
        <div className="mt-3 animate-slide-down">
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">كيف كان حفظك؟</p>
          <div className="flex gap-2">
            <Button size="sm" variant="success" onClick={() => onConfirm(task.id!, 'done', 'strong')} className="flex-1">
              قوي
            </Button>
            <Button size="sm" variant="warning" onClick={() => onConfirm(task.id!, 'done', 'medium')} className="flex-1">
              متوسط
            </Button>
            <Button size="sm" variant="error" onClick={() => onConfirm(task.id!, 'done', 'weak')} className="flex-1">
              ضعيف
            </Button>
          </div>
        </div>
      )}

      {showSnooze && (
        <div className="mt-3 animate-slide-down">
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { onSnooze(task.id!, snoozeMinutes); setShowSnooze(false); }}
              className="flex-1"
            >
              {snoozeMinutes} دقيقة
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { onSnooze(task.id!, snoozeMinutes * 2); setShowSnooze(false); }}
              className="flex-1"
            >
              {snoozeMinutes * 2} دقيقة
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowSnooze(false)}>
              إلغاء
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
