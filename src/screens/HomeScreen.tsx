import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, X, Clock, Flame, BookOpen, Moon, Sunrise, BookText, ChevronLeft, Sparkles, Calendar, Heart, Repeat, Share2, LoaderCircle, Play, Pause } from 'lucide-react';
import { Card, Button, Badge, SectionHeader, EmptyState, type BadgeProps } from '@/components/ui';
import { PrayerStatusSheet } from '@/components/PrayerStatusSheet';
import { DeviceProtectionBanner } from '@/components/DeviceProtectionBanner';
import { type DailyTask, type Settings, type StrengthRating, type TaskStatus } from '@/db/database';
import { getTodayTasks, confirmTask, snoozeTask, unsnoozeTask, describePortion, getStreakCount } from '@/utils/taskManager';
import { resumeReading, readingParams, describeReading, describeReadingAge, listReading } from '@/utils/readingHistory';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import {
  formatTime12h,
  getTimeUntil,
} from '@/utils/prayerTimes';
import { useCountdownClock, usePrayerSchedule } from '@/hooks/usePrayerSchedule';
import { trustedNow } from '@/utils/clock';
import { prayerProgressFraction } from '@/utils/prayerProgress';
import {
  getDayPrayerRecords,
  confirmPrayer,
  getDaySunnahRecords,
  setSunnah,
  RAWATIB_BY_PRAYER,
  sunnahDoneMap,
  type PrayerKey,
  type PrayerStatus,
} from '@/utils/prayerTracker';
import { todayKey, formatArabicDate, getHijriDate, getDayName } from '@/utils/dateUtils';
// The daily message reaches into the whole Quran text (a random ayah), so the
// module is imported on demand in the effect below — a static import here would
// put the full text chunk on the app's very first screen.
import type { DailyQuranMessage } from '@/utils/dailyQuranMessage';
import { prepareAyahShare, shareAyahCard, shareTextOrCopy, type PreparedAyahShare } from '@/utils/shareCard';
import { loadPreferredReciter } from '@/data/audioReciters';
import { ensureSource, playAyah, stop as stopRecitation, getRecitationState, subscribeRecitation, setTrack } from '@/utils/recitationEngine';
import { getHadithCollection, hadithOfDay, installedCollections, HADITH_OF_DAY_BOOK } from '@/data/hadiths';
import { toArabicNumber } from '@/data/surahs';
import { getSurah } from '@/data/surahs';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface HomeScreenProps {
  settings: Settings;
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

export function HomeScreen({ settings, navigate }: HomeScreenProps) {
  const [tasks, setTasks] = useState<DailyTask[]>([]);
  const [streak, setStreak] = useState(0);
  const [prayerRecords, setPrayerRecords] = useState<Record<string, PrayerStatus | null>>({});
  const [sunnahRecords, setSunnahRecords] = useState<Record<string, boolean>>({});
  const [dailyQuranMessage, setDailyQuranMessage] = useState<DailyQuranMessage | null>(null);
  const [dailyQuranMessageError, setDailyQuranMessageError] = useState('');
  const [isPlayingDailyAyah, setIsPlayingDailyAyah] = useState(false);
  const [isLoadingDailyAyah, setIsLoadingDailyAyah] = useState(false);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [preparedAyahCard, setPreparedAyahCard] = useState<PreparedAyahShare | null>(null);
  const [isSharingAyah, setIsSharingAyah] = useState(false);
  const [isSharingHadith, setIsSharingHadith] = useState(false);
  const [hadithShareNotice, setHadithShareNotice] = useState<string | null>(null);
  const shareInProgress = useRef(false);
  const hadithShareInProgress = useRef(false);
  // Reference clock for the countdown: armed once, ticking per-second only in the
  // last minute before the next prayer (see useCountdownClock) instead of
  // re-rendering this screen every second of the day.
  const nextPrayerTargetRef = useRef<number | null>(null);
  const now = useCountdownClock(nextPrayerTargetRef);
  // The bar draws a whole percent and a prayer window is hours long, so a per-second
  // state update re-rendered this screen ~60 times a minute to move a number that could
  // not change for a minute or more. The clock is still read every second; React is only
  // told when the percent on screen actually moves.
  const [progressNow, setProgressNow] = useState(trustedNow());
  const progressStepRef = useRef<number | null>(null);
  // Which prayer the confirmation sheet is open for, if any.
  const [sheetPrayer, setSheetPrayer] = useState<PrayerKey | null>(null);
  const today = trustedNow();

  const load = useCallback(async () => {
    const t = await getTodayTasks();
    setTasks(t);
    const s = await getStreakCount();
    setStreak(s);
    const records = await getDayPrayerRecords(todayKey());
    const map: Record<string, PrayerStatus | null> = {};
    records.forEach((r) => {
      map[r.prayer] = r.status;
    });
    setPrayerRecords(map);
    setSunnahRecords(sunnahDoneMap(await getDaySunnahRecords(todayKey())));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The message is one per local day, so the work (and the whole-Quran chunk it
  // pulls in) is keyed to the day — not to the every-second countdown tick. The
  // card already says it is loading while the chunk arrives.
  const messageDayKey = todayKey();
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { getDailyQuranMessage } = await import('@/utils/dailyQuranMessage');
        if (!alive) return;
        setDailyQuranMessage(getDailyQuranMessage(trustedNow()));
        setPreparedAyahCard(null);
        setDailyQuranMessageError('');
      } catch (error) {
        if (!alive) return;
        setDailyQuranMessage(null);
        setDailyQuranMessageError(error instanceof Error ? error.message : 'تعذّر تحميل رسالة القرآن اليومية.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [messageDayKey]);

  useEffect(() => {
    if (!dailyQuranMessage) return;
    let alive = true;
    void prepareAyahShare({
      surahId: dailyQuranMessage.surahId,
      ayahText: dailyQuranMessage.text,
      surahName: dailyQuranMessage.surahName,
      ayahNumber: dailyQuranMessage.ayahNumber,
    }).then((blob) => {
      if (alive) setPreparedAyahCard(blob);
    });
    return () => {
      alive = false;
    };
  }, [dailyQuranMessage]);

  /**
   * Sends the day's ayah as a picture.
   *
   * The card does the work; what is decided here is only what to say
   * afterwards. A share sheet that opened is the feature doing its job, and a
   * person who closed it changed their mind — neither is a message worth
   * putting on the screen. Only the two cases that left the ayah stuck on the
   * phone say anything.
   */
  const shareDailyAyah = async () => {
    if (!dailyQuranMessage || shareInProgress.current) return;
    shareInProgress.current = true;
    setIsSharingAyah(true);
    try {
      const outcome = await shareAyahCard({
        surahId: dailyQuranMessage.surahId,
        ayahText: dailyQuranMessage.text,
        surahName: dailyQuranMessage.surahName,
        ayahNumber: dailyQuranMessage.ayahNumber,
      }, preparedAyahCard);
      if (outcome === 'shared' || outcome === 'cancelled') return;
      setShareNotice(
        outcome === 'copied'
          ? 'نُسخت الآية ومصدرها — يمكنك إرسالها الآن.'
          : 'تعذّرت المشاركة والنسخ على هذا الجهاز.',
      );
      setTimeout(() => setShareNotice(null), 3000);
    } catch (error) {
      console.error('Daily Quran ayah sharing failed:', error);
      setShareNotice('تعذّرت المشاركة الآن. حاول مرة أخرى.');
      setTimeout(() => setShareNotice(null), 3000);
    } finally {
      shareInProgress.current = false;
      setIsSharingAyah(false);
    }
  };

  const playDailyAyah = async () => {
    if (!dailyQuranMessage) return;
    if (isPlayingDailyAyah) {
      stopRecitation();
      setIsPlayingDailyAyah(false);
      return;
    }
    setIsLoadingDailyAyah(true);
    try {
      const reciterId = loadPreferredReciter();
      const surah = getSurah(dailyQuranMessage.surahId);
      setTrack({
        surahId: dailyQuranMessage.surahId,
        surahName: surah?.name ?? dailyQuranMessage.surahName,
        reciterId,
      });
      const source = await ensureSource();
      if (source) {
        playAyah(dailyQuranMessage.ayahNumber, false);
        setIsPlayingDailyAyah(true);
      }
    } catch (error) {
      console.error('Daily Quran ayah playback failed:', error);
    } finally {
      setIsLoadingDailyAyah(false);
    }
  };

  // Keep the play button in sync with the engine's actual playback state.
  useEffect(() => {
    const unsubscribe = subscribeRecitation(() => {
      const state = getRecitationState();
      if (!dailyQuranMessage) return;
      const stillPlayingThis =
        state.isPlaying &&
        state.activeAyah === dailyQuranMessage.ayahNumber &&
        state.surahId === dailyQuranMessage.surahId;
      setIsPlayingDailyAyah(stillPlayingThis);
    });
    return unsubscribe;
  }, [dailyQuranMessage]);

  // Prayer times for a calendar day never change while the day lasts; the shared
  // hook pins the calculation to the city's day (see usePrayerSchedule), and the
  // countdown clock above keeps re-renders to a minute outside the last minute.
  const { prayerTimeZone, prayerResult, nextPrayer } = usePrayerSchedule({
    latitude: settings.latitude,
    longitude: settings.longitude,
    calcMethod: settings.calcMethod,
    asrMadhab: settings.asrMadhab,
    timeZone: settings.timeZone,
    cityName: settings.cityName,
    prayerTimeAdjustments: settings.prayerTimeAdjustments,
    now,
  });

  // The clock re-reads the ref at every wake, so pointing it at the next prayer's
  // instant is all the coordination the countdown needs: the clock is already
  // per-second by then, so the flip at prayer time happens within a second.
  useEffect(() => {
    nextPrayerTargetRef.current = nextPrayer?.time.getTime() ?? null;
  });

  // The bar is a window hours long, so a whole percent can take a minute or more to
  // change and the fill then sits visibly still. It is stepped at a tenth of a percent
  // instead: fine enough that the width glides, coarse enough that the screen still
  // renders a few times an hour rather than sixty times a minute. The figure beside it
  // is rounded to a whole number at draw time, so it changes no more often than before.
  //
  // The early return compares against the last value *pushed*, not the last rendered
  // one. Sitting after the schedule on purpose: it reads the prayers the hook above has
  // just computed.
  useEffect(() => {
    // Drop the remembered step whenever the window itself changes — a new next prayer,
    // a new day — so the first tick after the move is not swallowed as a repeat.
    progressStepRef.current = null;

    const id = setInterval(() => {
      const next = trustedNow();
      const fraction = prayerProgressFraction(prayerResult?.prayers, nextPrayer, next);
      // A tenth of a percent: the same resolution the bar is filled to.
      const step = Math.round(fraction * 1000);
      if (step === progressStepRef.current) return;
      progressStepRef.current = step;
      setProgressNow(next);
    }, 1000);
    return () => clearInterval(id);
  }, [prayerResult, nextPrayer]);

  const [hadith, setHadith] = useState(() => hadithOfDay());
  // True while the default collection is being put on the device on a fresh
  // install. Sahih Muslim is ~8.3 MB, so the prompt card says what is
  // happening instead of sitting still.
  const [seedingHadith, setSeedingHadith] = useState(false);

  // "Hadith of the day" needs a collection on the device. On a fresh install none
  // exists, so the default collection (صحيح مسلم) is installed once — it is
  // bundled inside the app itself, so this copies the local asset with no
  // network at all — and the card then works offline from then on.
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

  const shareDailyHadith = async () => {
    if (!hadith || hadithShareInProgress.current) return;
    hadithShareInProgress.current = true;
    setIsSharingHadith(true);
    setHadithShareNotice(null);
    try {
      const outcome = await shareTextOrCopy(
        `${hadith.text}\n\n${hadith.collectionTitle} — رقم ${toArabicNumber(hadith.number)}\nحديث اليوم من تطبيق قُرّة`,
      );
      if (outcome === 'copied') {
        setHadithShareNotice('نُسخ الحديث ومصدره — يمكنك إرساله الآن.');
        setTimeout(() => setHadithShareNotice(null), 3000);
      } else if (outcome === 'failed') {
        setHadithShareNotice('تعذّرت مشاركة الحديث أو نسخه.');
        setTimeout(() => setHadithShareNotice(null), 3000);
      }
    } catch (error) {
      console.error('Daily hadith sharing failed:', error);
      setHadithShareNotice('تعذّرت مشاركة الحديث الآن. حاول مرة أخرى.');
      setTimeout(() => setHadithShareNotice(null), 3000);
    } finally {
      hadithShareInProgress.current = false;
      setIsSharingHadith(false);
    }
  };

  const handleConfirm = async (taskId: number, status: 'done' | 'missed', strength?: 'weak' | 'medium' | 'strong') => {
    await confirmTask(taskId, status, strength);
    try {
      await rescheduleAllNotifications();
    } finally {
      await load();
    }
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

  /** Records one rawatib slot attached to the prayer the sheet is open for. */
  const handleSunnahToggle = async (type: string) => {
    if (!sheetPrayer) return;
    await setSunnah(todayKey(), type, !sunnahRecords[type]);
    await load();
  };

  // The bar is filled to a tenth of a percent so it glides, and the figure beside it is
  // the same number rounded to a whole one. Both come from the same fraction, so they
  // can never disagree. The fill is clamped short of 100 so the bar never reads as
  // finished while the prayer is still ahead.
  const prayerProgressFill = prayerProgressFraction(prayerResult?.prayers, nextPrayer, progressNow) * 100;

  const pendingTasks = tasks.filter((t) => t.status === 'pending' || t.status === 'snoozed');
  const doneTasks = tasks.filter((t) => t.status === 'done');

  // Resume target and recent reads, read once per visit — screens unmount on
  // tab change, so this is a fresh read every time Home appears, and it is
  // synchronous localStorage (not Dexie) precisely so the card can render on
  // the first paint without a loading state. Separate states, so the resume
  // target is a const the click handler's narrowing can rely on.
  const [readingResume] = useState(() => resumeReading());
  const [readingRecent] = useState(() => listReading(4));

  return (
    <div className="space-y-5 pb-4">
      {/* Header with greeting */}
      <div
        className="rounded-3xl p-5 md:p-6 text-white relative overflow-hidden shadow-xl"
        style={{
          background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))',
          boxShadow: '0 20px 40px -15px var(--brand-glow, rgba(31, 115, 78, 0.35))',
        }}
      >
        <div
          className="absolute -top-12 -left-12 w-44 h-44 rounded-full blur-2xl pointer-events-none opacity-40 animate-float"
          style={{ background: 'var(--brand-to, #b84414)' }}
        />
        <div
          className="absolute -bottom-10 -right-10 w-40 h-40 rounded-full blur-xl pointer-events-none opacity-35 animate-float-slow"
          style={{ background: 'var(--brand-from, #1f734e)' }}
        />
        <div className="relative">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-white/85 text-xs md:text-sm font-semibold tracking-wide">{getDayName(today)}</p>
              <h1 className="text-2xl md:text-3xl font-extrabold mt-0.5 tracking-tight">السلام عليكم</h1>
            </div>
            <div className="text-left">
              <p className="text-xs md:text-sm text-white/85 font-medium">{formatArabicDate(today)}</p>
              <p className="text-xs md:text-sm text-white/90 font-semibold mt-0.5">{getHijriDate(today, settings.hijriAdjustment)}</p>
            </div>
          </div>

          {/* Next prayer card */}
          {nextPrayer && (
            <div className="mt-4 bg-white/15 dark:bg-black/20 rounded-2xl p-3.5 backdrop-blur-md border border-white/20 shadow-inner">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm text-white shadow-xs">
                    <Sunrise size={20} />
                    <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                      <span className="animate-ping-soft absolute inline-flex h-full w-full rounded-full bg-[var(--func-accent)] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--func-accent)] shadow-xs" />
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-[11px] text-white/85 font-medium">الصلاة القادمة</p>
                      <span className="inline-block h-1 w-1 rounded-full bg-[var(--func-accent)] animate-pulse" />
                    </div>
                    <p className="font-bold text-base text-white">{nextPrayer.arabicName}</p>
                  </div>
                </div>
                <div className="text-left">
                  <p className="font-bold text-lg md:text-xl text-white">{formatTime12h(nextPrayer.time, prayerTimeZone)}</p>
                  <p className="text-xs text-white/80 font-medium">{getTimeUntil(nextPrayer.time, now)}</p>
                </div>
              </div>

              {/* Prayer-window progress. The fill is the exact fraction of the window
                  that has elapsed, so it glides; the figure beside it is that same
                  fraction rounded, so the two never disagree. */}
              <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center gap-2.5">
                <div
                  className="flex-1 h-1.5 rounded-full bg-black/20 overflow-hidden p-0.5 backdrop-blur-xs"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(prayerProgressFill)}
                  aria-label={`ما مضى من الوقت حتى ${nextPrayer.arabicName}`}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-white via-white/90 to-white/60 transition-[width] duration-1000 ease-linear shadow-xs"
                    style={{ width: `${prayerProgressFill.toFixed(2)}%` }}
                  />
                </div>
                <span className="text-[10px] text-white/90 font-bold tabular-nums">
                  {Math.round(prayerProgressFill)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* A phone that can silence the adhan says so here, on the first screen — the
          fix lives in the system settings, and nobody opens those on a hint alone. */}
      <DeviceProtectionBanner />

      {/* Quick Shortcuts */}
      <div className="grid grid-cols-4 gap-2.5 md:gap-3">
        <button
          type="button"
          onClick={() => navigate('quran')}
          className="group flex flex-col items-center justify-center p-3 md:p-5 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-xs hover:border-primary-400 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
        >
          <div className="h-11 w-11 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center mb-1.5 shadow-md shadow-emerald-600/25 transition-transform duration-200 group-hover:scale-110">
            <BookOpen size={21} />
          </div>
          <span className="text-xs md:text-sm font-bold text-primary-900 dark:text-primary-100">المصحف</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('prayer')}
          className="group flex flex-col items-center justify-center p-3 md:p-5 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-xs hover:border-primary-400 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
        >
          <div className="h-11 w-11 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center mb-1.5 shadow-md shadow-blue-600/25 transition-transform duration-200 group-hover:scale-110">
            <Moon size={21} />
          </div>
          <span className="text-xs md:text-sm font-bold text-primary-900 dark:text-primary-100">الصلاة</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('adhkar')}
          className="group flex flex-col items-center justify-center p-3 md:p-5 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-xs hover:border-primary-400 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
        >
          <div className="h-11 w-11 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center mb-1.5 shadow-md shadow-amber-600/25 transition-transform duration-200 group-hover:scale-110">
            <Heart size={21} />
          </div>
          <span className="text-xs md:text-sm font-bold text-primary-900 dark:text-primary-100">الأذكار</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('tasbih')}
          className="group flex flex-col items-center justify-center p-3 md:p-5 rounded-2xl bg-white dark:bg-primary-950/80 border border-primary-100 dark:border-primary-800/80 shadow-xs hover:border-primary-400 hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 active:scale-95"
        >
          <div className="h-11 w-11 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white flex items-center justify-center mb-1.5 shadow-md shadow-pink-600/25 transition-transform duration-200 group-hover:scale-110">
            <Repeat size={21} />
          </div>
          <span className="text-xs md:text-sm font-bold text-primary-900 dark:text-primary-100">المسبحة</span>
        </button>
      </div>

      {/* Resume reading + recent reads (utils/readingHistory) — the gap the
          surah list's own «متابعة» button could not cover: the position has to
          be visible from the first screen, before the Quran tab is opened. */}
      {readingResume && (
        <Card className="border-primary-200/70 bg-linear-to-bl from-primary-50/60 via-white to-white dark:border-primary-800/60 dark:from-primary-950/30 dark:via-primary-950/10 dark:to-primary-950/10">
          <div className="flex items-center gap-2 text-primary-700 dark:text-primary-300">
            <BookText size={18} className="shrink-0" />
            <h2 className="flex-1 font-bold">متابعة القراءة</h2>
            {readingRecent[0] && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {describeReadingAge(readingRecent[0].at, trustedNow().getTime())}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-extrabold text-primary-900 dark:text-primary-100">
                {readingRecent[0] ? describeReading(readingRecent[0]) : describeReading(readingResume)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">آخر قراءة على هذا الجهاز</p>
            </div>
            <Button
              onClick={() => navigate('quran', readingParams(readingResume))}
              variant="primary"
              size="sm"
            >
              متابعة
            </Button>
          </div>
          {/* The rest of the recent reads, each a tap away. The first entry is
              already the «متابعة» button above, so the chips start at one. */}
          {readingRecent.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-primary-100 pt-3 dark:border-primary-800/70">
              {readingRecent.slice(1).map((entry, index) => (
                <button
                  key={`${entry.kind}-${'page' in entry ? entry.page : `${entry.surahId}:${entry.ayah}`}-${index}`}
                  type="button"
                  onClick={() => navigate('quran', readingParams(entry))}
                  className="rounded-xl bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 hover:text-primary-900 focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-900/40 dark:text-primary-200 dark:hover:bg-primary-900/70"
                >
                  {describeReading(entry)}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="border-gold-300/70 bg-gradient-to-bl from-gold-50/70 via-white to-primary-50/30 dark:border-gold-800/50 dark:from-gold-950/20 dark:via-primary-950/40 dark:to-primary-900/40 shadow-[0_8px_24px_-10px_var(--brand-glow)] transition-all duration-300 hover:shadow-lg">
        <div className="flex items-center gap-2 text-primary-700 dark:text-gold-300">
          <Sparkles size={18} className="animate-pulse-soft text-accent-500 shrink-0" />
          <h2 className="flex-1 font-bold">رسالة اليوم من القرآن</h2>
          {dailyQuranMessage && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void playDailyAyah()}
                disabled={isLoadingDailyAyah}
                aria-label={isPlayingDailyAyah ? 'إيقاف الاستماع' : 'استماع إلى الآية'}
                aria-pressed={isPlayingDailyAyah}
                title={isPlayingDailyAyah ? 'إيقاف الاستماع' : 'استماع إلى آية اليوم'}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-primary-100 px-3 text-xs font-bold text-primary-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-200 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-sm motion-reduce:transition-none dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
              >
                {isLoadingDailyAyah ? (
                  <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : isPlayingDailyAyah ? (
                  <Pause size={15} aria-hidden="true" />
                ) : (
                  <Play size={15} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void shareDailyAyah()}
                disabled={isSharingAyah}
                aria-label="مشاركة آية اليوم"
                aria-busy={isSharingAyah}
                title={isSharingAyah ? 'جارٍ تجهيز بطاقة الآية للمشاركة' : 'مشاركة آية اليوم كبطاقة'}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-primary-700 px-3 text-xs font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-800 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-sm motion-reduce:transition-none dark:bg-gold-400 dark:text-primary-950 dark:hover:bg-gold-300"
              >
                {isSharingAyah ? (
                  <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <Share2 size={15} aria-hidden="true" />
                )}
              </button>
            </div>
          )}

        </div>
        {dailyQuranMessage ? (
          <>
            <p className="mt-3 text-lg leading-[2.2] text-primary-900 dark:text-primary-50 quran-text">
              {dailyQuranMessage.text}
            </p>
            <p className="mt-2 text-xs md:text-sm text-gray-500 dark:text-gray-400">
              سورة {dailyQuranMessage.surahName} — الآية {toArabicNumber(dailyQuranMessage.ayahNumber)}
            </p>
            {shareNotice ? (
              <p role="status" className="mt-1 text-[0.6875rem] md:text-sm text-success-700 dark:text-success-300">
                {shareNotice}
              </p>
            ) : (
              <p className="mt-1 text-[0.6875rem] md:text-sm text-gray-400 dark:text-gray-500">
                آية للتدبر من نص المصحف؛ لا تُعرض كتفسير للآية.
              </p>
            )}
          </>
        ) : (
          <p role="status" className="mt-3 text-sm text-error-700 dark:text-error-300">
            {dailyQuranMessageError || 'جارٍ تحميل رسالة اليوم...'}
          </p>
        )}
      </Card>

      {/* Streak + quick stats */}
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        <Card className="flex flex-col items-center text-center p-3 md:p-4! group transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-accent-700 text-white shadow-md shadow-accent-600/25 transition-transform duration-200 group-hover:scale-110">
            <Flame size={22} className={streak > 0 ? 'animate-flame' : 'opacity-70'} />
            {streak > 0 && (
              <span className="absolute -inset-1 rounded-xl bg-accent-500/25 blur-xs pointer-events-none -z-10 animate-pulse" />
            )}
          </div>
          <p className="text-2xl font-extrabold text-primary-800 dark:text-primary-100 mt-2">{streak}</p>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">أيام متتالية</p>
        </Card>
        <Card className="flex flex-col items-center text-center p-3 md:p-4! group transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-success-500 to-success-700 text-white shadow-md shadow-success-600/25 transition-transform duration-200 group-hover:scale-110">
            <Check size={22} />
          </div>
          <p className="text-2xl font-extrabold text-primary-800 dark:text-primary-100 mt-2">{doneTasks.length}</p>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">مهام مكتملة</p>
        </Card>
        <Card className="flex flex-col items-center text-center p-3 md:p-4! group transition-all duration-300 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-warning-500 to-warning-700 text-white shadow-md shadow-warning-600/25 transition-transform duration-200 group-hover:scale-110">
            <Clock size={22} />
          </div>
          <p className="text-2xl font-extrabold text-primary-800 dark:text-primary-100 mt-2">{pendingTasks.length}</p>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">مهام معلقة</p>
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
          <div className="space-y-3 md:space-y-0 md:grid md:grid-cols-2 md:gap-3">
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
            <div className="grid grid-cols-3 gap-1.5 p-2 md:grid-cols-6 md:gap-2.5 md:p-3">
              {prayerResult.prayers.map((prayer) => {
                const isSunrise = prayer.name === 'sunrise';
                const isNext = nextPrayer?.name === prayer.name;
                const record = prayerRecords[prayer.name] ?? null;
                const answerable = !isSunrise && prayer.passed;

                const body = (
                  <>
                    <p className={`text-xs font-semibold ${isSunrise ? 'text-accent-600 dark:text-accent-400' : isNext ? 'text-primary-800 dark:text-primary-200 font-bold' : 'text-primary-700 dark:text-primary-300'}`}>
                      {prayer.arabicName}
                    </p>
                    <p className="text-sm font-bold text-primary-900 dark:text-primary-100 mt-0.5">
                      {formatTime12h(prayer.time, prayerTimeZone)}
                    </p>
                    <div className="mt-1.5 min-h-[1.25rem] flex items-center justify-center">
                      {isSunrise ? (
                        <Badge variant="gold">شروق</Badge>
                      ) : isNext ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-600 text-white dark:bg-gold-400 dark:text-primary-950 shadow-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-primary-950 animate-ping-soft" />
                          القادمة
                        </span>
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

                // The whole tile is the target.
                if (!answerable) {
                  return (
                    <div
                      key={prayer.name}
                      className={`rounded-xl p-2.5 text-center transition-all ${
                        isNext
                          ? 'border-2 border-primary-500/80 dark:border-primary-400/70 bg-primary-100 dark:bg-primary-900/40 shadow-sm scale-[1.02]'
                          : prayer.passed
                          ? 'bg-primary-50/60 dark:bg-gray-800/30'
                          : 'bg-primary-50/60 dark:bg-gray-800/30'
                      }`}
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
                      record ? 'مسجّلة، اضغط للعرض' : 'لم تسجّل بعد، اضغط للتأكيد'
                    }`}
                    className={`rounded-xl p-2.5 text-center transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-primary-400 ${
                      isNext
                        ? 'border-2 border-primary-500/80 dark:border-primary-400/70 bg-primary-100 dark:bg-primary-900/50 shadow-sm ring-2 ring-primary-400/20 scale-[1.02]'
                        : record
                        ? 'bg-primary-50 dark:bg-primary-800/30'
                        : 'bg-primary-50/60 dark:bg-gray-800/30 hover:bg-primary-100 dark:hover:bg-primary-800/50'
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
          sunnahs={RAWATIB_BY_PRAYER[sheetPrayer].map((slot) => ({
            ...slot,
            done: !!sunnahRecords[slot.type],
          }))}
          onToggleSunnah={(type) => void handleSunnahToggle(type)}
          onPick={handlePrayerPick}
          onClose={() => setSheetPrayer(null)}
        />
      )}

      {/* Hadith of the day */}
      <div>
        <SectionHeader
          title="حديث اليوم"
          icon={<BookText size={20} />}
          action={
            <div className="flex items-center gap-2">
              {hadith && (
                <button
                  type="button"
                  onClick={() => void shareDailyHadith()}
                  disabled={isSharingHadith}
                  aria-label="مشاركة حديث اليوم"
                  aria-busy={isSharingHadith}
                  title="مشاركة حديث اليوم"
                  className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-primary-700 px-3 text-xs font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary-800 hover:shadow-md active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0 disabled:hover:shadow-sm motion-reduce:transition-none dark:bg-gold-400 dark:text-primary-950 dark:hover:bg-gold-300"
                >
                  {isSharingHadith ? (
                    <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Share2 size={18} aria-hidden="true" />
                  )}
                </button>
              )}
              <button onClick={() => navigate('hadith')} className="text-sm text-primary-600 dark:text-gold-400 flex items-center gap-0.5">
                <span>المكتبة</span>
                <ChevronLeft size={16} />
              </button>
            </div>
          }
        />
        {hadith ? (
          <>
            <Card onClick={() => navigate('hadith', { hadithId: hadith.id })}>
              <div className="flex items-start gap-3">
                <Sparkles size={20} className="text-gold-500 shrink-0 mt-1" />
                <div className="flex-1">
                  <p className="text-sm md:text-base md:leading-relaxed md:max-w-prose text-primary-800 dark:text-primary-100 line-clamp-3 quran-text whitespace-pre-line">
                    {hadith.text}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    {hadith.collectionTitle} — رقم {toArabicNumber(hadith.number)}
                  </p>
                </div>
              </div>
            </Card>
            {hadithShareNotice && (
              <p role="status" className="mt-1 text-xs text-success-700 dark:text-success-300">
                {hadithShareNotice}
              </p>
            )}
          </>
        ) : (
          <Card onClick={() => navigate('hadith')}>
            <div className="flex items-start gap-3">
              <Sparkles size={20} className="text-gold-500 shrink-0 mt-1" />
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

/**
 * How the portion went, as the memoriser said when confirming it.
 *
 * The rating has been recorded since the first build and never once shown
 * back — the question was asked, and the answer filed away. Beside «تم» it
 * becomes what it was always for: yesterday's card saying which portions to
 * lean on again, and which to expect a weak answer from.
 *
 * The colours are a traffic light on purpose: green held, amber is holding,
 * red slipped.
 */
const STRENGTH_LABELS_AR: Record<StrengthRating, string> = {
  weak: 'ضعيف',
  medium: 'متوسط',
  strong: 'قوي',
};

const STRENGTH_VARIANTS: Record<StrengthRating, BadgeProps['variant']> = {
  weak: 'error',
  medium: 'warning',
  strong: 'success',
};

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
            {/* The answer to «كيف كان حفظك؟», finally shown back. */}
            {task.status === 'done' && task.strength && (
              <Badge variant={STRENGTH_VARIANTS[task.strength]}>
                {STRENGTH_LABELS_AR[task.strength]}
              </Badge>
            )}
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
            <Button size="sm" variant="success" onClick={() => { onConfirm(task.id!, 'done', 'strong'); setShowStrength(false); }} className="flex-1">
              قوي
            </Button>
            <Button size="sm" variant="warning" onClick={() => { onConfirm(task.id!, 'done', 'medium'); setShowStrength(false); }} className="flex-1">
              متوسط
            </Button>
            <Button size="sm" variant="error" onClick={() => { onConfirm(task.id!, 'done', 'weak'); setShowStrength(false); }} className="flex-1">
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
