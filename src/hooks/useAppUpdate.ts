import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  cancelAppUpdateDownload,
  checkForAppUpdate,
  clearPendingUpdate,
  downloadAppUpdate,
  getErrorCode,
  installAppUpdate,
  isInstallPermissionGranted,
  openUpdateInBrowser,
  readPendingUpdate,
  type AppUpdateCheck,
  type PendingUpdate,
  type UpdateProgress,
} from '@/utils/appUpdates';

export interface AppUpdateController {
  /** Latest release check result. */
  update: AppUpdateCheck | null;
  /** True while the GitHub release check is running. */
  checking: boolean;
  /** Human readable failure for the last update action. */
  error: string;
  /** True while the APK is streaming into the app. */
  downloading: boolean;
  /** Stream progress, or null when nothing is downloading. */
  progress: UpdateProgress | null;
  /** APK downloaded in a previous session that is still waiting to be installed. */
  pending: PendingUpdate | null;
  /** Follow-up message for install attempts (permission prompts, completion). */
  installHint: string;
  check: () => Promise<void>;
  startDownload: () => Promise<void>;
  cancelDownload: () => Promise<void>;
  install: () => Promise<void>;
  openInBrowser: () => Promise<void>;
}

/**
 * Shared state for the app-update card and the update banner: release check,
 * in-app download with progress, and handing the APK to the system installer.
 */
export function useAppUpdate(): AppUpdateController {
  const [update, setUpdate] = useState<AppUpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [pending, setPending] = useState<PendingUpdate | null>(() => readPendingUpdate());
  const [installHint, setInstallHint] = useState('');

  // Set once the system installer could not open because "install unknown apps"
  // is off; the resume listener then retries as soon as the user grants it.
  const awaitingInstallPermission = useRef(false);
  const installRef = useRef<() => Promise<void>>(async () => {});

  const check = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    setChecking(true);
    setError('');
    try {
      const result = await checkForAppUpdate();
      if (result.status === 'current') {
        // This build already includes (or supersedes) the downloaded APK.
        clearPendingUpdate();
        setPending(null);
      }
      setUpdate(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر التحقق من التحديثات.');
    } finally {
      setChecking(false);
    }
  }, []);

  const startDownload = useCallback(async () => {
    if (!update || update.status !== 'available') return;
    setError('');
    setInstallHint('');
    setDownloading(true);
    setProgress({ loaded: 0, total: 0, percent: 0 });
    try {
      await downloadAppUpdate(update.downloadUrl, update.version, (event) => setProgress(event));
      setPending(readPendingUpdate());
      setInstallHint('اكتمل التنزيل — اضغط «تثبيت» لإتمام التحديث.');
    } catch (cause) {
      if (getErrorCode(cause) === 'cancelled') {
        setInstallHint('تم إلغاء التنزيل.');
      } else if (getErrorCode(cause) === 'already-downloading') {
        setError('يوجد تنزيل تحديث جارٍ بالفعل.');
      } else {
        setError(cause instanceof Error ? cause.message : 'تعذّر تنزيل التحديث.');
      }
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }, [update]);

  const cancelDownload = useCallback(async () => {
    try {
      await cancelAppUpdateDownload();
    } catch {
      // Cancelling is best effort; the native side rejects with "cancelled".
    }
  }, []);

  const install = useCallback(async () => {
    if (!pending) return;
    setError('');
    setInstallHint('');
    try {
      const outcome = await installAppUpdate(pending.path);
      if (outcome === 'permission-required') {
        awaitingInstallPermission.current = true;
        setInstallHint('فعّل «السماح من هذا المصدر» في الشاشة المفتوحة ثم عد إلى التطبيق — سيُفتح التثبيت تلقائيًا.');
      } else {
        awaitingInstallPermission.current = false;
        setInstallHint('تم فتح شاشة التثبيت — اضغط «تثبيت» لتأكيد التحديث.');
      }
    } catch (cause) {
      const code = getErrorCode(cause);
      if (code === 'missing-file') {
        clearPendingUpdate();
        setPending(null);
        awaitingInstallPermission.current = false;
        setError('لم يعد ملف التحديث متاحًا — أعد تنزيله.');
      } else if (code === 'already-launching') {
        return;
      } else {
        setError(cause instanceof Error ? cause.message : 'تعذّر فتح شاشة التثبيت.');
      }
    }
  }, [pending]);

  const openInBrowser = useCallback(async () => {
    if (!update || update.status !== 'available') return;
    try {
      await openUpdateInBrowser(update.downloadUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر فتح رابط التحديث.');
    }
  }, [update]);

  useEffect(() => {
    installRef.current = install;
  }, [install]);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) void check();
  }, [check]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let remove: (() => void) | undefined;

    void CapApp.addListener('resume', () => {
      // Refresh the release info when returning from the browser/installer.
      void check();

      if (!awaitingInstallPermission.current) return;
      void (async () => {
        try {
          if (!(await isInstallPermissionGranted())) return;
          awaitingInstallPermission.current = false;
          await installRef.current();
        } catch {
          // Still blocked; the hint stays so the user can tap install again.
        }
      })();
    })
      .then((handle) => {
        remove = () => { void handle.remove(); };
      })
      .catch(() => {
        // Resume events are optional on some builds; the install button still works.
      });

    return () => remove?.();
  }, [check]);

  return {
    update,
    checking,
    error,
    downloading,
    progress,
    pending,
    installHint,
    check,
    startDownload,
    cancelDownload,
    install,
    openInBrowser,
  };
}
