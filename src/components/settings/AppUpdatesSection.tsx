import { Capacitor } from '@capacitor/core';
import { Check, Download, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export function AppUpdatesSection() {
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

  return (
    <>
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
    </>
  );
}
