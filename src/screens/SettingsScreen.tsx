import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Moon,
  Sun,
  Monitor,
  Bell,
  Volume2,
  MapPin,
  Type,
  Download,
  Upload,
  Settings as SettingsIcon,
  Info,
  Check,
  Cloud,
  LogOut,
  RefreshCw,
  Smartphone,
  Play,
  Square,
  Sparkles,
  ShieldCheck,
  Database,
  Calendar,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Card, Button } from '@/components/ui';
import { TimeOptionButton } from '@/components/TimeOptionButton';
import { CALC_METHODS, CALC_METHOD_NAMES_AR } from '@/utils/prayerTimes';
import { ADHAN_SOUNDS, DEFAULT_ADHAN_SOUND_ID } from '@/data/adhanSounds';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import {
  canScheduleExactAlarms,
  NOTIFICATION_WARNING_EVENT,
  requestExactAlarms,
  requestNotificationPermission,
} from '@/utils/notifications';
import { db, type Settings } from '@/db/database';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';
import type { CloudSyncState } from '@/utils/cloudSync';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { ADHKAR_CATEGORIES } from '@/data/adhkar';
import { TOTAL_QURAN_PAGES } from '@/data/surahs';

interface SettingsScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  themeMode: 'light' | 'dark' | 'system';
  onChangeTheme: (mode: 'light' | 'dark' | 'system') => void;
  colorPalette: ColorPalette;
  onChangeColorPalette: (palette: ColorPalette) => void;
  accountEmail?: string;
  syncState?: CloudSyncState | null;
  onSyncNow?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}

const BACKUP_TABLES = [
  'settings',
  'plans',
  'tasks',
  'bookmarks',
  'pageBookmarks',
  'prayerRecords',
  'sunnahRecords',
  'hifzProgress',
  'hadithFavorites',
  'khatmah',
] as const;

const IGNORED_BACKUP_KEYS = ['_exportDate', 'streaks'];
type BackupTable = (typeof BACKUP_TABLES)[number];
const ADHKAR_STATE_KEY = 'hifzi-adhkar-state';

function isValidAdhkarBackup(value: unknown): value is {
  day: string;
  counts: Record<string, number>;
  favorites: string[];
  fontSize: number;
  haptics: boolean;
} {
  if (!isRecord(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return false;
  if (!isRecord(value.counts) || !Array.isArray(value.favorites)) return false;
  const adhkar = ADHKAR_CATEGORIES.flatMap((category) => category.items);
  const countsValid = Object.entries(value.counts).every(([id, count]) => {
    const item = adhkar.find((dhikr) => dhikr.id === id);
    return !!item && typeof count === 'number' && Number.isInteger(count) && count >= 0 && count <= item.count;
  });
  return (
    countsValid &&
    value.favorites.every((id) => typeof id === 'string' && adhkar.some((item) => item.id === id)) &&
    typeof value.fontSize === 'number' &&
    Number.isFinite(value.fontSize) &&
    value.fontSize >= 18 &&
    value.fontSize <= 32 &&
    typeof value.haptics === 'boolean'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidBackupRow(table: BackupTable, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (value.id !== undefined && (!Number.isInteger(value.id) || (value.id as number) < 1)) return false;

  switch (table) {
    case 'settings':
      return (
        Object.keys(value).some((key) =>
          [
            'theme',
            'colorPalette',
            'fontSize',
            'notificationSound',
            'adhanSound',
            'adhanVoiceId',
            'randomDhikrEnabled',
            'randomDhikrCategory',
            'randomDhikrIntervalMinutes',
            'randomDhikrStartTime',
            'randomDhikrEndTime',
            'snoozeMinutes',
            'prePrayerReminder',
            'calcMethod',
            'asrMadhab',
            'locationMethod',
            'timeZone',
            'hijriAdjustment',
          ].includes(key)
        ) &&
        (value.theme === undefined || ['light', 'dark', 'system'].includes(value.theme as string)) &&
        (value.colorPalette === undefined || ['emerald', 'ocean', 'plum', 'sand'].includes(value.colorPalette as string)) &&
        (value.fontSize === undefined || isFiniteNumber(value.fontSize)) &&
        (value.notificationSound === undefined || typeof value.notificationSound === 'boolean') &&
        (value.adhanSound === undefined || typeof value.adhanSound === 'boolean') &&
        (value.adhanVoiceId === undefined || typeof value.adhanVoiceId === 'string') &&
        (value.randomDhikrEnabled === undefined || typeof value.randomDhikrEnabled === 'boolean') &&
        (value.randomDhikrCategory === undefined ||
          ['varied', 'morning', 'evening', 'istighfar'].includes(value.randomDhikrCategory as string)) &&
        (value.randomDhikrIntervalMinutes === undefined || isFiniteNumber(value.randomDhikrIntervalMinutes)) &&
        (value.randomDhikrStartTime === undefined || isValidTime(value.randomDhikrStartTime)) &&
        (value.randomDhikrEndTime === undefined || isValidTime(value.randomDhikrEndTime)) &&
        (value.snoozeMinutes === undefined || isFiniteNumber(value.snoozeMinutes)) &&
        (value.prePrayerReminder === undefined || isFiniteNumber(value.prePrayerReminder)) &&
        (value.calcMethod === undefined || typeof value.calcMethod === 'string') &&
        (value.asrMadhab === undefined || ['standard', 'hanafi'].includes(value.asrMadhab as string)) &&
        (value.locationMethod === undefined || ['manual', 'auto'].includes(value.locationMethod as string)) &&
        (value.latitude === undefined || isFiniteNumber(value.latitude)) &&
        (value.longitude === undefined || isFiniteNumber(value.longitude)) &&
        (value.cityName === undefined || typeof value.cityName === 'string') &&
        (value.timeZone === undefined || typeof value.timeZone === 'string') &&
        (value.hijriAdjustment === undefined || [-1, 0, 1].includes(value.hijriAdjustment as number))
      );
    case 'plans':
      return (
        typeof value.name === 'string' &&
        ['hifz', 'muraja'].includes(value.type as string) &&
        typeof value.portion === 'string' &&
        Array.isArray(value.daysOfWeek) &&
        value.daysOfWeek.every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6) &&
        isValidTime(value.time) &&
        isFiniteNumber(value.createdAt) &&
        typeof value.active === 'boolean' &&
        (value.portionSequence === undefined ||
          (Array.isArray(value.portionSequence) && value.portionSequence.every((item) => typeof item === 'string'))) &&
        (value.progressionId === undefined || typeof value.progressionId === 'string')
      );
    case 'tasks':
      return (
        Number.isInteger(value.planId) &&
        (value.planId as number) > 0 &&
        isDateKey(value.date) &&
        ['hifz', 'muraja'].includes(value.type as string) &&
        typeof value.portion === 'string' &&
        isValidTime(value.scheduledTime) &&
        ['pending', 'done', 'missed', 'snoozed'].includes(value.status as string) &&
        isFiniteNumber(value.createdAt) &&
        (value.snoozedUntil === undefined || isFiniteNumber(value.snoozedUntil)) &&
        (value.status !== 'snoozed' || isFiniteNumber(value.snoozedUntil)) &&
        (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt)) &&
        (value.strength === undefined || ['weak', 'medium', 'strong'].includes(value.strength as string))
      );
    case 'bookmarks':
      return (
        Number.isInteger(value.surahId) &&
        (value.surahId as number) >= 1 &&
        (value.surahId as number) <= 114 &&
        Number.isInteger(value.ayahNumber) &&
        (value.ayahNumber as number) >= 1 &&
        isFiniteNumber(value.createdAt) &&
        (value.note === undefined || typeof value.note === 'string')
      );
    case 'pageBookmarks':
      return (
        Number.isInteger(value.page) &&
        (value.page as number) >= 1 &&
        (value.page as number) <= TOTAL_QURAN_PAGES &&
        isFiniteNumber(value.createdAt)
      );
    case 'prayerRecords':
      return (
        isDateKey(value.date) &&
        ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(value.prayer as string) &&
        (value.status === null || ['ontime', 'late', 'missed'].includes(value.status as string)) &&
        (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt))
      );
    case 'sunnahRecords':
      return isDateKey(value.date) && typeof value.type === 'string' && typeof value.done === 'boolean';
    case 'hifzProgress':
      return (
        Number.isInteger(value.surahId) &&
        (value.surahId as number) >= 1 &&
        (value.surahId as number) <= 114 &&
        Number.isInteger(value.ayahStart) &&
        (value.ayahStart as number) >= 1 &&
        Number.isInteger(value.ayahEnd) &&
        (value.ayahEnd as number) >= (value.ayahStart as number) &&
        ['memorized', 'reviewing', 'strong', 'weak'].includes(value.status as string) &&
        isFiniteNumber(value.ratedAt)
      );
    case 'hadithFavorites':
      return typeof value.hadithId === 'string' && typeof value.collection === 'string' && isFiniteNumber(value.createdAt);
    case 'khatmah':
      return (
        isDateKey(value.startDate) &&
        (value.targetDate === null || value.targetDate === undefined || isDateKey(value.targetDate)) &&
        isFiniteNumber(value.currentPage) &&
        (value.currentPage as number) >= 0 &&
        isFiniteNumber(value.updatedAt)
      );
  }
}

function isValidTime(value: unknown): boolean {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isDateKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function SettingsScreen({
  settings,
  onSaveSettings,
  themeMode,
  onChangeTheme,
  colorPalette,
  onChangeColorPalette,
  accountEmail,
  syncState,
  onSyncNow,
  onSignOut,
}: SettingsScreenProps) {
  const [exportStatus, setExportStatus] = useState('');
  const [adhanPreviewStatus, setAdhanPreviewStatus] = useState('');
  const [previewingAdhanId, setPreviewingAdhanId] = useState<string | null>(null);
  const adhanAudioRef = useRef<HTMLAudioElement | null>(null);
  const [dhikrPermissionStatus, setDhikrPermissionStatus] = useState('');
  const [accountActionStatus, setAccountActionStatus] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  /**
   * State of the exact-alarm permission that makes the adhan sound at the prayer
   * minute while the app is closed.
   *
   * Checked once on mount and re-raised by the scheduler whenever a rebuild had to
   * back off (see `NOTIFICATION_WARNING_EVENT`), so the fix — one tap into the system
   * page — sits exactly where the sound settings are.
   */
  const [exactAlarmNotice, setExactAlarmNotice] = useState<'' | 'denied' | 'inexact' | 'failed'>('');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    void canScheduleExactAlarms().then((ok) => {
      if (alive && !ok) setExactAlarmNotice('denied');
    });
    const onWarning = (event: Event) => {
      const type = (event as CustomEvent).detail;
      if (type === 'exact-alarm-denied') setExactAlarmNotice('denied');
      else if (type === 'scheduled-inexact') setExactAlarmNotice('inexact');
      else if (type === 'schedule-failed') setExactAlarmNotice('failed');
    };
    window.addEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    };
  }, []);

  const {
    update: appUpdate,
    checking: checkingUpdate,
    error: updateError,
    downloading: updating,
    progress: updateProgress,
    pending: pendingUpdate,
    installHint: updateInstallHint,
    check: checkUpdate,
    startDownload: startUpdateDownload,
    cancelDownload: cancelUpdateDownload,
    install: installUpdate,
    openInBrowser: openUpdateInBrowserFallback,
  } = useAppUpdate();

  const updatePercent = updateProgress && updateProgress.percent >= 0 ? updateProgress.percent : null;

  const stopAdhanPreview = useCallback(() => {
    const audio = adhanAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      adhanAudioRef.current = null;
    }
    setPreviewingAdhanId(null);
  }, []);

  const playAdhanPreview = useCallback(async () => {
    const sound = ADHAN_SOUNDS.find((item) => item.id === settings.adhanVoiceId) ?? ADHAN_SOUNDS[0];
    if (previewingAdhanId === sound.id) {
      stopAdhanPreview();
      setAdhanPreviewStatus('تم إيقاف الاستماع.');
      return;
    }

    stopAdhanPreview();
    setAdhanPreviewStatus('');
    const audio = new Audio(`${import.meta.env.BASE_URL}audio/${sound.file}`);
    audio.preload = 'auto';
    audio.onended = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
        setAdhanPreviewStatus('انتهى تشغيل تسجيل الأذان.');
      }
    };
    audio.onerror = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
        setAdhanPreviewStatus('تعذّر تشغيل ملف الأذان. تحقّق من توفر الملف ثم أعد المحاولة.');
      }
    };
    adhanAudioRef.current = audio;
    setPreviewingAdhanId(sound.id);

    try {
      await audio.play();
      setAdhanPreviewStatus(`يُشغّل تسجيل ${sound.name} كاملًا الآن.`);
    } catch (error) {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
      }
      setAdhanPreviewStatus(error instanceof Error ? `تعذّر تشغيل الأذان: ${error.message}` : 'تعذّر تشغيل الأذان.');
    }
  }, [previewingAdhanId, settings.adhanVoiceId, stopAdhanPreview]);

  useEffect(() => {
    if (previewingAdhanId && previewingAdhanId !== settings.adhanVoiceId) {
      stopAdhanPreview();
      setAdhanPreviewStatus('تم إيقاف التسجيل بعد تغيير صوت الأذان.');
    }
  }, [previewingAdhanId, settings.adhanVoiceId, stopAdhanPreview]);

  useEffect(() => () => {
    adhanAudioRef.current?.pause();
    adhanAudioRef.current = null;
  }, []);

  const enableRandomDhikrNotifications = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setDhikrPermissionStatus('التذكيرات المجدولة تعمل في تطبيق أندرويد، وليس في معاينة المتصفح.');
      return;
    }
    try {
      if (!(await requestNotificationPermission())) {
        setDhikrPermissionStatus('لم تُمنح صلاحية الإشعارات. يمكنك تفعيلها من إعدادات الهاتف.');
        return;
      }
      await rescheduleAllNotifications();
      setDhikrPermissionStatus('تم تفعيل الإشعارات وإعادة جدولة التذكيرات.');
    } catch (error) {
      setDhikrPermissionStatus(
        error instanceof Error ? `تعذّر تفعيل التذكيرات: ${error.message}` : 'تعذّر تفعيل التذكيرات.'
      );
    }
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const data: Record<string, unknown> = {
        _exportDate: new Date().toISOString(),
      };
      data.settings = [await db.settings.get(1)];
      data.plans = await db.plans.toArray();
      data.tasks = await db.tasks.toArray();
      data.bookmarks = await db.bookmarks.toArray();
      data.pageBookmarks = await db.pageBookmarks.toArray();
      data.prayerRecords = await db.prayerRecords.toArray();
      data.sunnahRecords = await db.sunnahRecords.toArray();
      data.hifzProgress = await db.hifzProgress.toArray();
      data.hadithFavorites = await db.hadithFavorites.toArray();
      data.khatmah = await db.khatmah.toArray();
      const adhkarState = localStorage.getItem(ADHKAR_STATE_KEY);
      if (adhkarState) data.adhkar = JSON.parse(adhkarState) as unknown;

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hifzi-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportStatus('تم التصدير بنجاح');
      setTimeout(() => setExportStatus(''), 3000);
    } catch {
      setExportStatus('فشل التصدير');
    }
  }, []);

  const handleImport = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        if (!data || typeof data !== 'object' || typeof data._exportDate !== 'string' || Number.isNaN(Date.parse(data._exportDate))) {
          setExportStatus('فشل الاستيراد - الملف ليس نسخة احتياطية صالحة');
          return;
        }
        for (const key of Object.keys(data)) {
          if (IGNORED_BACKUP_KEYS.includes(key)) continue;
          if (key === 'adhkar') {
            if (!isValidAdhkarBackup(data.adhkar)) {
              setExportStatus('فشل الاستيراد - بيانات الأذكار في النسخة غير صالحة');
              return;
            }
            continue;
          }
          if (!BACKUP_TABLES.includes(key as BackupTable)) {
            setExportStatus('فشل الاستيراد - بنية الملف غير صحيحة');
            return;
          }
          if (!Array.isArray(data[key]) || !(data[key] as unknown[]).every((row) => isValidBackupRow(key as BackupTable, row))) {
            setExportStatus('فشل الاستيراد - بنية الملف غير صحيحة');
            return;
          }
        }
        await db.transaction(
          'rw',
          BACKUP_TABLES.map((key) => db.table(key)),
          async () => {
            for (const key of BACKUP_TABLES) {
              if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
              const table = db.table(key);
              await table.clear();
              await table.bulkPut(data[key] as Record<string, unknown>[]);
            }
          }
        );
        if (data.adhkar !== undefined) {
          localStorage.setItem(ADHKAR_STATE_KEY, JSON.stringify(data.adhkar));
        }
        setExportStatus('تم الاستيراد بنجاح. جارٍ إعادة التشغيل...');
        setTimeout(() => window.location.reload(), 1500);
      } catch {
        setExportStatus('فشل الاستيراد - ملف غير صالح');
      }
    };
    reader.onerror = () => setExportStatus('فشل الاستيراد - تعذّرت قراءة الملف');
    reader.readAsText(file);
  }, []);

  const triggerAzanOverlayPreview = () => {
    window.dispatchEvent(
      new CustomEvent('zad:trigger-azan', {
        detail: {
          prayerKey: 'fajr',
          prayerName: 'الفجر',
          isPreview: true,
        },
      })
    );
  };

  return (
    <div className="space-y-6 pb-8" dir="rtl">
      {/* Top Main Header */}
      <div className="flex items-center justify-between border-b border-primary-100 pb-4 dark:border-primary-800">
        <div>
          <h1 className="text-2xl font-bold text-primary-900 dark:text-primary-50 flex items-center gap-2">
            <SettingsIcon size={26} className="text-primary-600 dark:text-gold-400" />
            إعدادات التطبيق
          </h1>
          <p className="mt-1 text-xs text-primary-700/80 dark:text-primary-300">
            تخصيص المظهر، التنبيهات، مواقيت الصلاة والنسخ الاحتياطي
          </p>
        </div>
      </div>

      {/* Account & Cloud Sync Section */}
      {accountEmail && syncState && (
        <section className="space-y-2">
          <SectionTitle icon={<Cloud size={20} />} title="الحساب والمزامنة السحابية" />
          <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md">
            <div className="flex items-center justify-between pb-3 border-b border-primary-100 dark:border-primary-800/60">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">الحساب المسجل</p>
                <p className="text-sm font-bold text-primary-900 dark:text-primary-100 mt-0.5" dir="ltr">
                  {accountEmail}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                syncState.status === 'synced'
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : syncState.status === 'syncing'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 animate-pulse'
                  : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
              }`}>
                <span className="h-2 w-2 rounded-full bg-current" />
                {syncState.status === 'syncing' && 'جارٍ المزامنة...'}
                {syncState.status === 'synced' && 'متزامن بنجاح'}
                {syncState.status === 'offline' && 'غير متصل'}
                {syncState.status === 'error' && 'تعذرت المزامنة'}
              </span>
            </div>

            <p className="mt-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              تتم مزامنة بيانات الحساب تلقائياً بشكل آمن وسري بين أجهزتك.
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={accountActionBusy}
                onClick={async () => {
                  if (!onSyncNow) return;
                  setAccountActionBusy(true);
                  setAccountActionStatus('');
                  try {
                    await onSyncNow();
                  } catch (error) {
                    setAccountActionStatus(error instanceof Error ? error.message : 'تعذّرت المزامنة.');
                  } finally {
                    setAccountActionBusy(false);
                  }
                }}
                className="flex items-center justify-center gap-1.5 font-semibold text-xs"
              >
                <RefreshCw size={15} className={accountActionBusy ? 'animate-spin' : ''} /> مزامنة الآن
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={accountActionBusy}
                onClick={async () => {
                  if (!onSignOut) return;
                  // Signing out uploads what is on this device and then deletes the local
                  // copy — a destructive step the button never mentioned. Say what will
                  // happen and let the user decide before anything is cleared.
                  const proceed = window.confirm(
                    'سيتم رفع بياناتك إلى حسابك أولاً، ثم حذفها من هذا الجهاز بعد تسجيل الخروج. بياناتك تبقى محفوظة في حسابك وتعود عند تسجيل الدخول مجدداً. هل تريد المتابعة؟',
                  );
                  if (!proceed) return;
                  setAccountActionBusy(true);
                  setAccountActionStatus('');
                  try {
                    await onSignOut();
                  } catch (error) {
                    setAccountActionStatus(error instanceof Error ? error.message : 'تعذّر تسجيل الخروج.');
                  } finally {
                    setAccountActionBusy(false);
                  }
                }}
                className="flex items-center justify-center gap-1.5 font-semibold text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
              >
                <LogOut size={15} /> تسجيل الخروج
              </Button>
            </div>
            {accountActionStatus && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300 font-semibold">
                {accountActionStatus}
              </p>
            )}
          </Card>
        </section>
      )}

      {/* App Updates (Native Mobile) */}
      {Capacitor.isNativePlatform() && (
        <section className="space-y-2">
          <SectionTitle icon={<Smartphone size={20} />} title="تحديثات التطبيق" />
          <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md">
            {checkingUpdate && (
              <p role="status" className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin text-primary-600" /> جارٍ التحقق من وجود إصدار جديد...
              </p>
            )}
            {!checkingUpdate && !updating && !pendingUpdate && appUpdate?.status === 'available' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold text-primary-900 dark:text-primary-100">
                    يتوفر إصدار جديد: {appUpdate.version}
                  </p>
                  <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                    تحديث جديد
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  ينزلّ التحديث داخل التطبيق مباشرة، ثم تضغط «تثبيت» لإتمام التحديث دون مغادرة التطبيق.
                </p>
                <Button variant="primary" size="sm" className="w-full font-bold" onClick={() => void startUpdateDownload()}>
                  <Download size={16} /> تنزيل الإصدار {appUpdate.version}
                </Button>
              </div>
            )}
            {updating && (
              <div className="space-y-2">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r from-primary-600 to-amber-500 transition-all duration-300 ${
                      updatePercent === null ? 'animate-pulse' : ''
                    }`}
                    style={{ width: `${updatePercent === null ? 35 : updatePercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                  <span>{updatePercent === null ? 'جارٍ التنزيل...' : `تم تنزيل ${updatePercent}%`}</span>
                  <button type="button" onClick={() => void cancelUpdateDownload()} className="underline text-red-500">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
            {!updating && pendingUpdate && (
              <div className="space-y-3">
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  اكتمل تنزيل التحديث {pendingUpdate.version} وهو جاهز للتثبيت.
                </p>
                <Button variant="primary" size="sm" className="w-full font-bold bg-emerald-600 hover:bg-emerald-700" onClick={() => void installUpdate()}>
                  <Check size={16} /> تثبيت التحديث الآن
                </Button>
              </div>
            )}
            {!checkingUpdate && !updating && appUpdate?.status === 'current' && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-600 dark:text-gray-300">التطبيق محدّث إلى أحدث إصدار — الإصدار {appUpdate.version}</p>
                <ShieldCheck size={18} className="text-emerald-500" />
              </div>
            )}
            {!checkingUpdate && !updating && appUpdate?.status === 'no-release' && (
              <p className="text-xs text-gray-500 dark:text-gray-400">لا يوجد إصدار منشور حاليًا.</p>
            )}
            {updateInstallHint && !updating && (
              <p role="status" className="mt-2 text-xs text-primary-600 dark:text-primary-300">
                {updateInstallHint}
              </p>
            )}
            {updateError && (
              <div className="mt-2 space-y-2">
                <p role="alert" className="text-xs text-red-600 dark:text-red-300 font-semibold">
                  تعذّر التحديث: {updateError}
                </p>
                {appUpdate?.status === 'available' && !updating && (
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => void openUpdateInBrowserFallback()}>
                    تنزيل عبر المتصفح كبديل
                  </Button>
                )}
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full font-semibold"
              disabled={checkingUpdate || updating}
              onClick={() => void checkUpdate()}
            >
              <RefreshCw size={15} /> التحقق من التحديثات
            </Button>
          </Card>
        </section>
      )}

      {/* Theme & Palette */}
      <section className="space-y-2">
        <SectionTitle icon={<Sun size={20} />} title="المظهر والسمات البصرية" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5">وضع الشاشة</p>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { mode: 'light' as const, label: 'فاتح', icon: Sun },
                { mode: 'dark' as const, label: 'داكن', icon: Moon },
                { mode: 'system' as const, label: 'النظام', icon: Monitor },
              ].map((opt) => {
                const Icon = opt.icon;
                const active = themeMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    onClick={() => onChangeTheme(opt.mode)}
                    className={`flex flex-col items-center justify-center gap-1.5 py-3 rounded-2xl border transition-all duration-200 ${
                      active
                        ? 'border-primary-500 bg-gradient-to-b from-primary-600 to-primary-700 text-white shadow-md shadow-primary-900/20'
                        : 'border-primary-100/80 bg-gray-50/70 dark:border-primary-800/60 dark:bg-primary-900/30 text-gray-700 dark:text-gray-200 hover:bg-primary-50 dark:hover:bg-primary-800/50'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="text-xs font-bold">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-4">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2.5">نغمة ألوان الواجهة</p>
            <div className="grid grid-cols-4 gap-2.5">
              {COLOR_PALETTES.map((palette) => {
                const selected = colorPalette === palette.id;
                return (
                  <button
                    key={palette.id}
                    type="button"
                    aria-label={`اختيار اللون ${palette.name}`}
                    aria-pressed={selected}
                    onClick={() => onChangeColorPalette(palette.id)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-all duration-200 ${
                      selected
                        ? 'border-gold-400 bg-primary-50 dark:bg-primary-800/50 shadow-md ring-1 ring-gold-400/40'
                        : 'border-transparent bg-gray-50 dark:bg-primary-900/20 hover:bg-primary-50/50 dark:hover:bg-primary-800/30'
                    }`}
                  >
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-transform"
                      style={{ backgroundColor: palette.color }}
                    >
                      {selected && <Check size={18} className="text-white" strokeWidth={3} />}
                    </span>
                    <span className="text-xs font-bold text-primary-900 dark:text-primary-100">{palette.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      </section>

      {/* Notifications & Azan Settings */}
      <section className="space-y-2">
        <SectionTitle icon={<Bell size={20} />} title="التنبيهات وصوت الأذان" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          {exactAlarmNotice !== '' && (
            <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-700 dark:bg-amber-900/30">
              <p className="text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
                {exactAlarmNotice === 'denied'
                  ? 'تنبيهات الأذان الدقيقة موقوفة من إعدادات الجهاز — الأذان قد يتأخر دقائق أثناء السكون.'
                  : exactAlarmNotice === 'inexact'
                    ? 'شُغّلت تنبيهات هذا الدور بنظام تقريبي — الأذان قد يتأخر دقائق أثناء السكون.'
                    : 'تعذّرت جدولة تنبيهات هذا الدور، وعادت التنبيهات السابقة إلى مكانها؛ ستُعاد المحاولة عند فتح التطبيق.'}
              </p>
              {exactAlarmNotice !== 'failed' && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const granted = await requestExactAlarms();
                    setExactAlarmNotice(granted ? '' : 'denied');
                    if (granted) await rescheduleAllNotifications();
                  }}
                  className="font-semibold text-xs"
                >
                  فتح إعدادات تنبيهات الأذان الدقيقة
                </Button>
              )}
            </div>
          )}

          <ToggleRow
            label="أصوات تنبيهات المهام والحفظ"
            icon={<Volume2 size={18} className="text-primary-600 dark:text-gold-400" />}
            value={settings.notificationSound}
            onChange={(v) => onSaveSettings({ notificationSound: v })}
          />

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
            <ToggleRow
              label="تفعيل صوت الأذان عند وقت الصلاة"
              icon={<Volume2 size={18} className="text-primary-600 dark:text-gold-400" />}
              value={settings.adhanSound}
              onChange={(v) => onSaveSettings({ adhanSound: v })}
            />

            {settings.adhanSound && (
              <div className="mt-3 space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                <div>
                  <label htmlFor="adhan-sound" className="text-xs font-semibold text-primary-900 dark:text-primary-100 mb-1.5 block">
                    صوت وشكل الأذان
                  </label>
                  <select
                    id="adhan-sound"
                    value={
                      ADHAN_SOUNDS.some((sound) => sound.id === settings.adhanVoiceId)
                        ? settings.adhanVoiceId
                        : DEFAULT_ADHAN_SOUND_ID
                    }
                    onChange={(e) => onSaveSettings({ adhanVoiceId: e.target.value })}
                    className="w-full bg-white dark:bg-primary-900 border border-primary-200 dark:border-primary-700 rounded-xl py-2.5 px-3 text-sm text-primary-900 dark:text-primary-100 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {ADHAN_SOUNDS.map((sound) => (
                      <option key={sound.id} value={sound.id}>
                        {sound.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Play audio preview */}
                  <Button variant="secondary" size="sm" onClick={() => void playAdhanPreview()} className="font-semibold text-xs">
                    {previewingAdhanId === settings.adhanVoiceId ? <Square size={15} /> : <Play size={15} />}
                    {previewingAdhanId === settings.adhanVoiceId ? 'إيقاف الصوت' : 'استماع للصوت'}
                  </Button>

                  {/* Trigger Fullscreen Azan Overlay Preview */}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={triggerAzanOverlayPreview}
                    className="font-bold text-xs bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950"
                  >
                    <Sparkles size={15} /> معاينة صفحة الأذان
                  </Button>
                </div>

                {adhanPreviewStatus && (
                  <p role="status" className="text-xs font-semibold text-primary-700 dark:text-gold-300 text-center">
                    {adhanPreviewStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Random Dhikr Notifications */}
          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
            <ToggleRow
              label="تذكير عشوائي بالأذكار"
              icon={<Bell size={18} className="text-primary-600 dark:text-gold-400" />}
              value={settings.randomDhikrEnabled}
              onChange={(v) => onSaveSettings({ randomDhikrEnabled: v })}
            />

            {settings.randomDhikrEnabled && (
              <div className="mt-3 space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                <label htmlFor="dhikr-reminder-category" className="block text-xs font-semibold text-primary-900 dark:text-primary-100">
                  نوع رسائل التذكير
                  <select
                    id="dhikr-reminder-category"
                    value={settings.randomDhikrCategory ?? 'varied'}
                    onChange={(e) =>
                      onSaveSettings({
                        randomDhikrCategory: e.target.value as Settings['randomDhikrCategory'],
                      })
                    }
                    className="mt-1.5 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100 font-semibold"
                  >
                    <option value="varied">متنوع حسب الوقت</option>
                    <option value="morning">أذكار الصباح</option>
                    <option value="evening">أذكار المساء</option>
                    <option value="istighfar">الاستغفار</option>
                  </select>
                </label>

                <TimeOptionButton
                  label="الفاصل الزمني (دقيقة)"
                  value={settings.randomDhikrIntervalMinutes}
                  options={[15, 30, 60, 120]}
                  onSelect={(v) => onSaveSettings({ randomDhikrIntervalMinutes: v })}
                />

                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    من الساعة
                    <input
                      type="time"
                      value={settings.randomDhikrStartTime}
                      onChange={(e) => onSaveSettings({ randomDhikrStartTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    إلى الساعة
                    <input
                      type="time"
                      value={settings.randomDhikrEndTime}
                      onChange={(e) => onSaveSettings({ randomDhikrEndTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                </div>

                <Button variant="secondary" size="sm" onClick={enableRandomDhikrNotifications} className="w-full font-semibold">
                  <Bell size={16} /> تفعيل صلاحية الإشعارات للهاتف
                </Button>
                {dhikrPermissionStatus && (
                  <p role="status" className="text-xs text-primary-600 dark:text-gold-400 font-semibold text-center">
                    {dhikrPermissionStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
            <TimeOptionButton
              label="مدة تأجيل التذكيرات (دقائق)"
              value={settings.snoozeMinutes}
              options={[5, 10, 15, 30]}
              onSelect={(v) => onSaveSettings({ snoozeMinutes: v })}
            />
          </div>

          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
            <TimeOptionButton
              label="التذكير المسبق قبل وقت الصلاة (دقائق)"
              value={settings.prePrayerReminder}
              options={[0, 5, 10, 15, 20]}
              onSelect={(v) => onSaveSettings({ prePrayerReminder: v })}
            />
          </div>
        </Card>
      </section>

      {/* Prayer Calculation Settings */}
      <section className="space-y-2">
        <SectionTitle icon={<MapPin size={20} />} title="حساب مواقيت الصلاة" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">طريقة الحساب المعتمدة</label>
            <select
              value={settings.calcMethod}
              onChange={(e) => onSaveSettings({ calcMethod: e.target.value })}
              className="w-full bg-gray-50 dark:bg-primary-900/50 border border-primary-200 dark:border-primary-700 rounded-xl py-2.5 px-3 text-sm text-primary-900 dark:text-primary-100 font-semibold focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {CALC_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CALC_METHOD_NAMES_AR[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">حساب وقت صلاة العصر (المذهب)</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'standard' })}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  settings.asrMadhab === 'standard'
                    ? 'border-primary-500 bg-primary-600 text-white shadow-sm'
                    : 'border-primary-100 bg-gray-50 dark:border-primary-800 dark:bg-primary-900/30 text-gray-700 dark:text-gray-300'
                }`}
              >
                الشافعي / المالكي / الحنبلي
              </button>
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'hanafi' })}
                className={`py-2.5 rounded-xl text-xs font-bold border transition-all ${
                  settings.asrMadhab === 'hanafi'
                    ? 'border-primary-500 bg-primary-600 text-white shadow-sm'
                    : 'border-primary-100 bg-gray-50 dark:border-primary-800 dark:bg-primary-900/30 text-gray-700 dark:text-gray-300'
                }`}
              >
                الحنفي
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5 block">الموقع الحالي المسجل</label>
            <div className="flex items-center justify-between rounded-xl bg-primary-50/70 p-3 border border-primary-100 dark:bg-primary-900/30 dark:border-primary-800/60">
              <span className="text-sm font-bold text-primary-900 dark:text-primary-100 flex items-center gap-1.5">
                <MapPin size={16} className="text-primary-600 dark:text-gold-400" />
                {settings.cityName || 'غير محدد'}
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                ({settings.latitude?.toFixed(2)}, {settings.longitude?.toFixed(2)})
              </span>
            </div>
          </div>
        </Card>
      </section>

      {/* Hijri Date Correction */}
      <section className="space-y-2">
        <SectionTitle icon={<Calendar size={20} />} title="التاريخ الهجري" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md">
          <div className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">تصحيح عرض التاريخ</p>
              <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                إن كان تاريخك الهجري يختلف بيوم، اضبطه هنا ليُطبَّق على تاريخ اليوم في كل الشاشات.
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              {[-1, 0, 1].map((delta) => (
                <button
                  key={delta}
                  onClick={() => onSaveSettings({ hijriAdjustment: delta })}
                  aria-pressed={(settings.hijriAdjustment ?? 0) === delta}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    (settings.hijriAdjustment ?? 0) === delta
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {delta === 0 ? 'الأصل' : delta > 0 ? '+١' : '−١'}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* Font Size Settings */}
      <section className="space-y-2">
        <SectionTitle icon={<Type size={20} />} title="حجم خط القرآن الكريم" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-500">A-</span>
            <input
              type="range"
              min={18}
              max={48}
              value={settings.fontSize}
              onChange={(e) => onSaveSettings({ fontSize: parseInt(e.target.value) })}
              className="flex-1 accent-primary-600 cursor-pointer h-2 bg-primary-100 dark:bg-primary-800 rounded-lg"
            />
            <span className="text-sm font-semibold text-gray-500">A+</span>
          </div>

          {/* Live Quran Text Preview */}
          <div className="rounded-2xl border border-gold-400/30 bg-amber-50/40 p-4 text-center dark:bg-primary-950/60 shadow-inner">
            <p className="quran-text font-serif text-primary-900 dark:text-primary-50 transition-all duration-200" style={{ fontSize: settings.fontSize }}>
              بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
            </p>
            <p className="quran-text font-serif text-primary-800 dark:text-primary-200 mt-2 transition-all duration-200" style={{ fontSize: settings.fontSize * 0.95 }}>
              إِنَّاهَذَا الْقُرْآنَ يَهْدِي لِلَّتِي هِيَ أَقْوَمُ
            </p>
          </div>
        </Card>
      </section>

      {/* Backup & Restore */}
      <section className="space-y-2">
        <SectionTitle icon={<Database size={20} />} title="النسخ الاحتياطي واستعادة البيانات" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-3">
          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            يمكنك حفظ نسخة احتياطية من جميع بياناتك (خطط الحفظ، الورد اليومي، الفواصل، وإعدادات الصلاة) واستعادتها في أي وقت.
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" size="sm" onClick={handleExport} className="font-bold text-xs">
              <Download size={16} /> تصدير نسخة (JSON)
            </Button>
            <label className="block">
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
              <span className="flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold bg-primary-100 dark:bg-primary-800 text-primary-800 dark:text-primary-100 rounded-xl cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-700 transition-all border border-primary-200 dark:border-primary-700 h-9">
                <Upload size={16} /> استيراد نسخة
              </span>
            </label>
          </div>
          {exportStatus && (
            <p className="text-xs text-center font-bold text-primary-700 dark:text-gold-300">
              {exportStatus}
            </p>
          )}
        </Card>
      </section>

      {/* About Application */}
      <section className="space-y-2">
        <SectionTitle icon={<Info size={20} />} title="عن التطبيق" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-2 text-xs text-gray-600 dark:text-gray-300">
          <p className="font-bold text-sm text-primary-900 dark:text-primary-50">قُرّة — رفيق القرآن والعبادة اليومية</p>
          <p>يعمل بالكامل بدون إنترنت بحفظ كامل لجميع بياناتك محلياً على جهازك.</p>
          <p className="pt-2 text-[11px] text-gray-400 dark:text-gray-500 border-t border-primary-100 dark:border-primary-800/50">
            الإصدار 1.0.6 • جميع الحقوق محفوظة
          </p>
        </Card>
      </section>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="text-sm font-bold text-primary-900 dark:text-primary-100 flex items-center gap-2 px-1">
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-gold-400">
        {icon}
      </span>
      {title}
    </h2>
  );
}

function ToggleRow({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-primary-900 dark:text-primary-100">
        {icon}
        <span>{label}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          value ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            value ? '-translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
