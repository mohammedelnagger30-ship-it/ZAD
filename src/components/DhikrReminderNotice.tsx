import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { requestNotificationPermission } from '@/utils/notifications';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import type { Settings } from '@/db/database';
import type { ScreenName, NavParams } from '@/hooks/useApp';

/**
 * Once-off, remembered dismissal — read lazily so the notice does not flash on mounts where
 * it has already been turned down.
 */
const DISMISSED_KEY = 'qura:dhikr-notice-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'true';
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); a notice that cannot
    // remember being dismissed is still better than a crash.
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(DISMISSED_KEY, 'true');
  } catch {
    // Nothing to do: the worst case is the notice showing again next session.
  }
}

/**
 * A quiet invitation to turn on the random dhikr reminders.
 *
 * This used to be a full step of the onboarding carousel, which meant every first run was
 * interrupted by a screen whose only purpose was one optional switch — and if the reader
 * skipped it, nothing ever mentioned the feature again. An inline card that can be read in a
 * second and dismissed for good is a far lighter ask, and it is also reachable at any time
 * from Settings.
 */
export function DhikrReminderNotice({
  settings,
  onSaveSettings,
  navigate,
  hidden = false,
}: {
  settings: Settings;
  /**
   * Awaited before the scheduler runs: `rescheduleAllNotifications` reads settings straight
   * from the database, so scheduling before this write lands would arm the *old* queue —
   * with the dhikr switch still off.
   */
  onSaveSettings: (patch: Partial<Settings>) => void | Promise<void>;
  navigate: (target: ScreenName, params?: NavParams) => void;
  /** Set while the reader is already looking at the very setting this points at. */
  hidden?: boolean;
}) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // The feature is native-only: the scheduler returns early on web, and the matching toggle
  // in Settings refuses to arm there too. Offering a one-tap enable that could not possibly
  // send anything would be a lie, so the web build is simply pointed at Settings.
  const canEnableInPlace = Capacitor.isNativePlatform();

  if (hidden || dismissed || settings.randomDhikrEnabled) return null;

  const dismiss = () => {
    rememberDismissal();
    setDismissed(true);
  };

  const enable = async () => {
    setStatus(null);
    setRequesting(true);
    try {
      const granted = await requestNotificationPermission();
      if (!granted) {
        setStatus('لم تُمنح صلاحية الإشعارات. فعّلها من إعدادات الهاتف ثم أعد المحاولة.');
        return;
      }
      await onSaveSettings({ randomDhikrEnabled: true });
      await rescheduleAllNotifications();
    } catch {
      // Never trap the reader on a banner: say so once and leave Settings as the fallback.
      setStatus('تعذّر تفعيل التذكيرات الآن. جرّب من الإعدادات.');
    } finally {
      setRequesting(false);
    }
  };

  const openSettings = () => navigate('settings', { section: 'notifications' });

  return (
    <div
      role="status"
      className="mb-3 flex items-start gap-3 rounded-2xl border border-primary-200 bg-primary-50/70 p-3 text-sm dark:border-primary-700 dark:bg-primary-900/50"
      dir="rtl"
    >
      <Sparkles size={18} className="mt-0.5 shrink-0 text-primary-600 dark:text-gold-400" />
      <div className="flex-1">
        <p className="font-semibold text-primary-900 dark:text-primary-50">تذكير عشوائي بالأذكار</p>
        <p className="mt-0.5 text-primary-800 dark:text-primary-100">
          هل تريد أن نذكّرك بأذكار عشوائية على مدار اليوم؟ تذكيرات لطيفة تساعدك على ذكر الله في كل وقت.
        </p>
        {status && (
          <p role="alert" className="mt-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {status}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canEnableInPlace && (
            <button
              type="button"
              onClick={() => void enable()}
              disabled={requesting}
              className="rounded-lg bg-primary-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-800 disabled:opacity-60"
            >
              {requesting ? 'جارٍ التفعيل…' : 'تفعيل التذكيرات'}
            </button>
          )}
          <button
            type="button"
            onClick={openSettings}
            className="rounded-lg border border-primary-300 px-3 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 dark:border-primary-600 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            {canEnableInPlace ? 'خيارات أخرى' : 'الذهاب إلى الإعدادات'}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="إخفاء تنبيه الأذكار نهائيًا"
        className="shrink-0 rounded-lg p-1 text-primary-600 hover:bg-primary-100 dark:text-primary-200 dark:hover:bg-primary-800"
      >
        <X size={16} />
      </button>
    </div>
  );
}
