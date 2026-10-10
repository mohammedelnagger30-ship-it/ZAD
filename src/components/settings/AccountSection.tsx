import { useState } from 'react';
import { Cloud, LogOut, RefreshCw } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import type { CloudSyncState } from '@/utils/cloudSync';

interface AccountSectionProps {
  accountEmail?: string;
  syncState?: CloudSyncState | null;
  onSyncNow?: () => Promise<void>;
  onSignOut?: () => Promise<void>;
}

export function AccountSection({ accountEmail, syncState, onSyncNow, onSignOut }: AccountSectionProps) {
  const [accountActionStatus, setAccountActionStatus] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  return (
    <>
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
    </>
  );
}
