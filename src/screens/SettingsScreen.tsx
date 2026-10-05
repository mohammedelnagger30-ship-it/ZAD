import { useState, useCallback, useEffect } from 'react';
import { Moon, Sun, Monitor, Bell, Volume2, MapPin, Type, Download, Upload, Settings as SettingsIcon, Info, Check, Cloud, LogOut, RefreshCw, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Card, Button } from '@/components/ui';
import { TimeOptionButton } from '@/components/TimeOptionButton';
import { CALC_METHODS, CALC_METHOD_NAMES_AR } from '@/utils/prayerTimes';
import { ADHAN_SOUNDS, DEFAULT_ADHAN_SOUND_ID } from '@/data/adhanSounds';
import { createNotificationChannels, rescheduleAllNotifications } from '@/utils/notificationScheduler';
import { requestNotificationPermission } from '@/utils/notifications';
// `db` drives the backup export/import and `Settings` types the props. Both were used
// here without ever being imported, so this screen did not compile.
import { db, type Settings } from '@/db/database';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';
import type { CloudSyncState } from '@/utils/cloudSync';
import { checkForAppUpdate, type AppUpdateCheck } from '@/utils/appUpdates';
import { ADHKAR_CATEGORIES } from '@/data/adhkar';

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

/** Tables written by the export. Older backups may also carry `streaks`, which is ignored. */
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
] as const;

/** Keys accepted in an import that are not restored (removed or legacy tables). */
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
    return !!item
      && typeof count === 'number'
      && Number.isInteger(count)
      && count >= 0
      && count <= item.count;
  });
  return countsValid
    && value.favorites.every((id) => typeof id === 'string' && adhkar.some((item) => item.id === id))
    && typeof value.fontSize === 'number'
    && Number.isFinite(value.fontSize)
    && value.fontSize >= 18
    && value.fontSize <= 32
    && typeof value.haptics === 'boolean';
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
      return Object.keys(value).some((key) => [
        'theme', 'colorPalette', 'fontSize', 'notificationSound', 'adhanSound', 'adhanVoiceId',
        'randomDhikrEnabled', 'randomDhikrIntervalMinutes', 'randomDhikrStartTime', 'randomDhikrEndTime',
        'snoozeMinutes', 'prePrayerReminder', 'calcMethod', 'asrMadhab', 'locationMethod', 'timeZone',
      ].includes(key))
        && (value.theme === undefined || ['light', 'dark', 'system'].includes(value.theme as string))
        && (value.colorPalette === undefined || ['emerald', 'ocean', 'plum', 'sand'].includes(value.colorPalette as string))
        && (value.fontSize === undefined || isFiniteNumber(value.fontSize))
        && (value.notificationSound === undefined || typeof value.notificationSound === 'boolean')
        && (value.adhanSound === undefined || typeof value.adhanSound === 'boolean')
        && (value.adhanVoiceId === undefined || typeof value.adhanVoiceId === 'string')
        && (value.randomDhikrEnabled === undefined || typeof value.randomDhikrEnabled === 'boolean')
        && (value.randomDhikrIntervalMinutes === undefined || isFiniteNumber(value.randomDhikrIntervalMinutes))
        && (value.randomDhikrStartTime === undefined || isValidTime(value.randomDhikrStartTime))
        && (value.randomDhikrEndTime === undefined || isValidTime(value.randomDhikrEndTime))
        && (value.snoozeMinutes === undefined || isFiniteNumber(value.snoozeMinutes))
        && (value.prePrayerReminder === undefined || isFiniteNumber(value.prePrayerReminder))
        && (value.calcMethod === undefined || typeof value.calcMethod === 'string')
        && (value.asrMadhab === undefined || ['standard', 'hanafi'].includes(value.asrMadhab as string))
        && (value.locationMethod === undefined || ['manual', 'auto'].includes(value.locationMethod as string))
        && (value.latitude === undefined || isFiniteNumber(value.latitude))
        && (value.longitude === undefined || isFiniteNumber(value.longitude))
        && (value.cityName === undefined || typeof value.cityName === 'string')
        && (value.timeZone === undefined || typeof value.timeZone === 'string');
    case 'plans':
      return typeof value.name === 'string'
        && ['hifz', 'muraja'].includes(value.type as string)
        && typeof value.portion === 'string'
        && Array.isArray(value.daysOfWeek)
        && value.daysOfWeek.every((day) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6)
        && isValidTime(value.time)
        && isFiniteNumber(value.createdAt)
        && typeof value.active === 'boolean'
        && (value.portionSequence === undefined || (Array.isArray(value.portionSequence) && value.portionSequence.every((item) => typeof item === 'string')))
        && (value.progressionId === undefined || typeof value.progressionId === 'string');
    case 'tasks':
      return Number.isInteger(value.planId) && (value.planId as number) > 0
        && isDateKey(value.date)
        && ['hifz', 'muraja'].includes(value.type as string)
        && typeof value.portion === 'string'
        && isValidTime(value.scheduledTime)
        && ['pending', 'done', 'missed', 'snoozed'].includes(value.status as string)
        && isFiniteNumber(value.createdAt)
        && (value.snoozedUntil === undefined || isFiniteNumber(value.snoozedUntil))
        && (value.status !== 'snoozed' || isFiniteNumber(value.snoozedUntil))
        && (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt))
        && (value.strength === undefined || ['weak', 'medium', 'strong'].includes(value.strength as string));
    case 'bookmarks':
      return Number.isInteger(value.surahId) && (value.surahId as number) >= 1 && (value.surahId as number) <= 114
        && Number.isInteger(value.ayahNumber) && (value.ayahNumber as number) >= 1
        && isFiniteNumber(value.createdAt)
        && (value.note === undefined || typeof value.note === 'string');
    case 'pageBookmarks':
      return Number.isInteger(value.page) && (value.page as number) >= 1 && (value.page as number) <= 604
        && isFiniteNumber(value.createdAt);
    case 'prayerRecords':
      return isDateKey(value.date)
        && ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'].includes(value.prayer as string)
        && (value.status === null || ['ontime', 'late', 'missed'].includes(value.status as string))
        && (value.confirmedAt === undefined || isFiniteNumber(value.confirmedAt));
    case 'sunnahRecords':
      return isDateKey(value.date) && typeof value.type === 'string' && typeof value.done === 'boolean';
    case 'hifzProgress':
      return Number.isInteger(value.surahId) && (value.surahId as number) >= 1 && (value.surahId as number) <= 114
        && Number.isInteger(value.ayahStart) && (value.ayahStart as number) >= 1
        && Number.isInteger(value.ayahEnd) && (value.ayahEnd as number) >= (value.ayahStart as number)
        && ['memorized', 'reviewing', 'strong', 'weak'].includes(value.status as string)
        && isFiniteNumber(value.ratedAt);
    case 'hadithFavorites':
      return typeof value.hadithId === 'string' && typeof value.collection === 'string' && isFiniteNumber(value.createdAt);
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
  const [adhanTestStatus, setAdhanTestStatus] = useState('');
  const [dhikrPermissionStatus, setDhikrPermissionStatus] = useState('');
  const [accountActionStatus, setAccountActionStatus] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateCheck | null>(null);
  const [updateError, setUpdateError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const checkUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    setUpdateError('');
    try {
      setAppUpdate(await checkForAppUpdate());
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'تعذّر التحقق من التحديثات.');
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) void checkUpdate();
  }, [checkUpdate]);

  const testAdhan = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setAdhanTestStatus('تشغيل صوت الإشعار متاح في تطبيق أندرويد فقط.');
      return;
    }
    try {
      if (!(await requestNotificationPermission())) {
        setAdhanTestStatus('اسمح بالإشعارات من إعدادات الهاتف لتجربة الأذان.');
        return;
      }
      await createNotificationChannels(settings);
      const sound = ADHAN_SOUNDS.find((item) => item.id === settings.adhanVoiceId) ?? ADHAN_SOUNDS[0];
      await LocalNotifications.schedule({
        notifications: [{
          id: 999999,
          title: 'تجربة صوت الأذان',
          body: `الصوت المختار: ${sound.name}`,
          schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
          channelId: settings.adhanSound ? `prayer-${sound.id}` : 'prayer-muted',
          sound: settings.adhanSound ? sound.file : undefined,
          smallIcon: 'ic_notification',
          iconColor: '#1f734e',
        }],
      });
      setAdhanTestStatus('سيصلك إشعار تجريبي خلال لحظات.');
    } catch (error) {
      setAdhanTestStatus(error instanceof Error ? `تعذّر تشغيل التجربة: ${error.message}` : 'تعذّر تشغيل تجربة الأذان.');
    }
  }, [settings]);

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
        error instanceof Error ? `تعذّر تفعيل التذكيرات: ${error.message}` : 'تعذّر تفعيل التذكيرات.',
      );
    }
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const data: Record<string, unknown> = {
        _exportDate: new Date().toISOString(),
      };
      // Settings are exported as a single object — the table is guaranteed to hold one row.
      data.settings = [await db.settings.get(1)];
      data.plans = await db.plans.toArray();
      data.tasks = await db.tasks.toArray();
      data.bookmarks = await db.bookmarks.toArray();
      data.pageBookmarks = await db.pageBookmarks.toArray();
      data.prayerRecords = await db.prayerRecords.toArray();
      data.sunnahRecords = await db.sunnahRecords.toArray();
      data.hifzProgress = await db.hifzProgress.toArray();
      data.hadithFavorites = await db.hadithFavorites.toArray();
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
        // Validate backup structure
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
          },
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

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">الإعدادات</h1>
        <SettingsIcon size={28} className="text-primary-600 dark:text-gold-400" />
      </div>

      {accountEmail && syncState && (
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary-700 dark:text-primary-200">
            <Cloud size={18} /> مزامنة الحساب
          </p>
          <p className="text-sm text-gray-700 dark:text-gray-300" dir="ltr">{accountEmail}</p>
          <p className={`mt-2 text-xs ${syncState.status === 'error' ? 'text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`} role={syncState.status === 'error' ? 'alert' : 'status'}>
            {syncState.status === 'syncing' && 'جارٍ مزامنة السجلات...'}
            {syncState.status === 'synced' && `بياناتك متزامنة${syncState.lastSyncedAt ? ` — ${new Date(syncState.lastSyncedAt).toLocaleTimeString('ar-EG')}` : ''}`}
            {syncState.status === 'offline' && 'غير متصل بالإنترنت؛ ستتم المزامنة عند عودة الاتصال.'}
            {syncState.status === 'error' && `تعذّرت المزامنة: ${syncState.error ?? 'خطأ غير معروف'}`}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            تتم مزامنة كل سجل منفردًا؛ بيانات الحساب محمية ولا يطّلع عليها مستخدم آخر.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
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
            >
              <RefreshCw size={15} /> مزامنة الآن
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={accountActionBusy}
              onClick={async () => {
                if (!onSignOut) return;
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
            >
              <LogOut size={15} /> تسجيل الخروج
            </Button>
          </div>
          {accountActionStatus && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">{accountActionStatus}</p>}
        </Card>
      )}

      {Capacitor.isNativePlatform() && (
        <Card>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary-700 dark:text-primary-200">
            <Smartphone size={18} /> تحديث التطبيق
          </p>
          {checkingUpdate && <p role="status" className="text-xs text-gray-500 dark:text-gray-400">جارٍ التحقق من وجود إصدار جديد...</p>}
          {!checkingUpdate && appUpdate?.status === 'available' && (
            <>
              <p className="text-sm text-primary-700 dark:text-primary-200">يتوفر إصدار جديد: {appUpdate.version}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">بعد تنزيل الملف، افتحه من التنزيلات واختر «تحديث». سيطلب Android تأكيد التثبيت.</p>
              <Button
                variant="primary"
                size="sm"
                className="mt-3 w-full"
                onClick={() => {
                  if (!appUpdate || appUpdate.status !== 'available') return;
                  void Browser.open({ url: appUpdate.downloadUrl }).catch((error: unknown) => {
                    setUpdateError(error instanceof Error ? error.message : 'تعذّر فتح رابط التحديث.');
                  });
                }}
              >
                <Download size={16} /> تنزيل الإصدار {appUpdate.version}
              </Button>
            </>
          )}
          {!checkingUpdate && appUpdate?.status === 'current' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">التطبيق محدّث — الإصدار {appUpdate.version}</p>
          )}
          {!checkingUpdate && appUpdate?.status === 'no-release' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">لا يوجد إصدار منشور حاليًا.</p>
          )}
          {updateError && <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">تعذّر التحقق: {updateError}</p>}
          <Button variant="secondary" size="sm" className="mt-3 w-full" disabled={checkingUpdate} onClick={() => void checkUpdate()}>
            <RefreshCw size={15} /> التحقق الآن
          </Button>
        </Card>
      )}

      {/* Theme */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-3 flex items-center gap-2">
          <Sun size={18} /> المظهر
        </p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { mode: 'light' as const, label: 'فاتح', icon: Sun },
            { mode: 'dark' as const, label: 'داكن', icon: Moon },
            { mode: 'system' as const, label: 'النظام', icon: Monitor },
          ]).map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.mode}
                onClick={() => onChangeTheme(opt.mode)}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl transition-smooth ${
                  themeMode === opt.mode
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
                }`}
              >
                <Icon size={20} />
                <span className="text-xs font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 border-t border-primary-100 dark:border-primary-800/50 pt-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">ألوان الواجهة</p>
          <div className="grid grid-cols-4 gap-2">
            {COLOR_PALETTES.map((palette) => {
              const selected = colorPalette === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  aria-label={`اختيار اللون ${palette.name}`}
                  aria-pressed={selected}
                  onClick={() => onChangeColorPalette(palette.id)}
                  className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-smooth ${
                    selected
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-800/40'
                      : 'border-transparent bg-gray-50 dark:bg-primary-800/20'
                  }`}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full shadow-sm"
                    style={{ backgroundColor: palette.color }}
                  >
                    {selected && <Check size={17} className="text-white" strokeWidth={3} />}
                  </span>
                  <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200">{palette.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-3 flex items-center gap-2">
          <Bell size={18} /> التنبيهات
        </p>
        <div className="space-y-3">
          <ToggleRow
            label="أصوات التنبيه"
            icon={<Volume2 size={18} />}
            value={settings.notificationSound}
            onChange={(v) => onSaveSettings({ notificationSound: v })}
          />
          <ToggleRow
            label="صوت الأذان للصلاة"
            icon={<Volume2 size={18} />}
            value={settings.adhanSound}
            onChange={(v) => onSaveSettings({ adhanSound: v })}
          />
          {settings.adhanSound && (
            <div>
              <label htmlFor="adhan-sound" className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">
                صوت الأذان
              </label>
              <select
                id="adhan-sound"
                value={ADHAN_SOUNDS.some((sound) => sound.id === settings.adhanVoiceId)
                  ? settings.adhanVoiceId
                  : DEFAULT_ADHAN_SOUND_ID}
                onChange={(e) => onSaveSettings({ adhanVoiceId: e.target.value })}
                className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
              >
                {ADHAN_SOUNDS.map((sound) => (
                  <option key={sound.id} value={sound.id}>{sound.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                التسجيلات مضمنة وتعمل دون إنترنت. قد يؤثر وضع عدم الإزعاج أو إعداد صوت الإشعارات في الهاتف على التشغيل.
              </p>
              <Button variant="secondary" size="sm" onClick={testAdhan} className="mt-2 w-full">
                <Volume2 size={16} /> تجربة صوت الأذان
              </Button>
              {adhanTestStatus && (
                <p role="status" className="mt-2 text-xs text-primary-600 dark:text-gold-400">
                  {adhanTestStatus}
                </p>
              )}
            </div>
          )}
          <div className="border-t border-primary-100 dark:border-primary-800 pt-3">
            <ToggleRow
              label="تذكير عشوائي بالأذكار"
              icon={<Bell size={18} />}
              value={settings.randomDhikrEnabled}
              onChange={(v) => onSaveSettings({ randomDhikrEnabled: v })}
            />
            {settings.randomDhikrEnabled && (
              <div className="space-y-2">
                <TimeOptionButton
                  label="الفاصل (دقيقة)"
                  value={settings.randomDhikrIntervalMinutes}
                  options={[15, 30, 60, 120]}
                  onSelect={(v) => onSaveSettings({ randomDhikrIntervalMinutes: v })}
                />
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    من الساعة
                    <input
                      type="time"
                      value={settings.randomDhikrStartTime}
                      onChange={(e) => onSaveSettings({ randomDhikrStartTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-100 bg-gray-50 px-3 py-2 text-sm text-primary-800 dark:border-primary-800 dark:bg-primary-800/30 dark:text-primary-100"
                    />
                  </label>
                  <label className="text-xs text-gray-500 dark:text-gray-400">
                    إلى الساعة
                    <input
                      type="time"
                      value={settings.randomDhikrEndTime}
                      onChange={(e) => onSaveSettings({ randomDhikrEndTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-100 bg-gray-50 px-3 py-2 text-sm text-primary-800 dark:border-primary-800 dark:bg-primary-800/30 dark:text-primary-100"
                    />
                  </label>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  ستصلك إشعارات نصية بأذكار مختارة عشوائيًا خلال الفترة المحددة. لا تُقرأ بصوت مسجّل حاليًا؛ يلزم السماح بإشعارات التطبيق.
                </p>
                <Button variant="secondary" size="sm" onClick={enableRandomDhikrNotifications} className="w-full">
                  <Bell size={16} /> تفعيل صلاحية الإشعارات الآن
                </Button>
                {dhikrPermissionStatus && (
                  <p role="status" className="text-xs text-primary-600 dark:text-gold-400">
                    {dhikrPermissionStatus}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between py-2">
            <TimeOptionButton label="مدة التأجيل (دقائق)" value={settings.snoozeMinutes} options={[5,10,15,30]} onSelect={(v)=> onSaveSettings({snoozeMinutes: v})} />
          </div>
          <div className="flex items-center justify-between py-2">
            <TimeOptionButton label="تذكير قبل الصلاة (دقائق)" value={settings.prePrayerReminder} options={[0,5,10,15,20]} onSelect={(v)=> onSaveSettings({prePrayerReminder: v})} />
          </div>
        </div>
      </Card>

      {/* Prayer calculation */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-3 flex items-center gap-2">
          <MapPin size={18} /> حساب مواقيت الصلاة
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">طريقة الحساب</label>
            <select
              value={settings.calcMethod}
              onChange={(e) => onSaveSettings({ calcMethod: e.target.value })}
              className="w-full bg-gray-50 dark:bg-primary-800/30 border border-primary-100 dark:border-primary-800 rounded-xl py-2 px-3 text-sm text-primary-800 dark:text-primary-100"
            >
              {CALC_METHODS.map((m) => (
                <option key={m} value={m}>{CALC_METHOD_NAMES_AR[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">مذهب العصر</label>
            <div className="flex gap-2">
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'standard' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                  settings.asrMadhab === 'standard' ? 'bg-primary-600 text-white' : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
                }`}
              >
                الشافعي (الجمهور)
              </button>
              <button
                onClick={() => onSaveSettings({ asrMadhab: 'hanafi' })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium ${
                  settings.asrMadhab === 'hanafi' ? 'bg-primary-600 text-white' : 'bg-gray-50 dark:bg-primary-800/30 text-gray-600 dark:text-gray-300'
                }`}
              >
                الحنفي
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">الموقع الحالي</label>
            <p className="text-sm text-primary-700 dark:text-primary-200 bg-gray-50 dark:bg-primary-800/30 rounded-lg py-2 px-3">
              {settings.cityName || 'غير محدد'} ({settings.latitude?.toFixed(2)}, {settings.longitude?.toFixed(2)})
            </p>
          </div>
        </div>
      </Card>

      {/* Font size */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-3 flex items-center gap-2">
          <Type size={18} /> حجم خط القرآن
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">صغير</span>
          <input
            type="range"
            min={18}
            max={48}
            value={settings.fontSize}
            onChange={(e) => onSaveSettings({ fontSize: parseInt(e.target.value) })}
            className="flex-1 accent-primary-600"
          />
          <span className="text-xs text-gray-500">كبير</span>
        </div>
        <p className="text-center mt-2 quran-text text-primary-800 dark:text-primary-100" style={{ fontSize: settings.fontSize }}>
          بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
        </p>
      </Card>

      {/* Backup */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-3 flex items-center gap-2">
          <Download size={18} /> النسخ الاحتياطي
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleExport} className="flex-1">
            <Download size={16} /> تصدير
          </Button>
          <label className="flex-1">
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            <span className="flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium bg-primary-100 dark:bg-primary-800 text-primary-700 dark:text-primary-100 rounded-xl cursor-pointer hover:bg-primary-200 dark:hover:bg-primary-700 transition-smooth">
              <Upload size={16} /> استيراد
            </span>
          </label>
        </div>
        {exportStatus && <p className="text-xs text-center mt-2 text-primary-600 dark:text-gold-400">{exportStatus}</p>}
      </Card>

      {/* About */}
      <Card>
        <p className="text-sm font-semibold text-primary-700 dark:text-primary-200 mb-2 flex items-center gap-2">
          <Info size={18} /> عن التطبيق
        </p>
        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>زاد — رفيق القرآن والعبادة اليومية</p>
          <p>يعمل بالكامل بدون إنترنت بعد التثبيت</p>
          <p className="mt-2">جميع البيانات مخزنة محلياً على جهازك</p>
        </div>
      </Card>
    </div>
  );
}

function ToggleRow({ label, icon, value, onChange }: { label: string; icon: React.ReactNode; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
        {icon}
        <span>{label}</span>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-7 rounded-full transition-smooth ${value ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'left-1' : 'right-1'}`} />
      </button>
    </div>
  );
}
