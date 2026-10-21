import { useState } from 'react';
import { Cloud, CloudUpload, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { SectionTitle } from '@/components/settings/SectionTitle';
import { useConfirm } from '@/hooks/useConfirm';
import type { CloudSyncState, SignOutOptions, SignOutResult } from '@/utils/cloudSync';

interface AccountSectionProps {
  accountEmail?: string;
  syncState?: CloudSyncState | null;
  onSyncNow?: () => Promise<void>;
  onSignOut?: (options?: SignOutOptions) => Promise<SignOutResult>;
  /** Present only for an allow-listed account — opens the admin dashboard. */
  onOpenAdmin?: () => void;
  /** Present only for a guest — opens the sign-up form. */
  onCreateAccount?: () => void;
}

export function AccountSection({ accountEmail, syncState, onSyncNow, onSignOut, onOpenAdmin, onCreateAccount }: AccountSectionProps) {
  const { confirm, dialog } = useConfirm();
  const [accountActionStatus, setAccountActionStatus] = useState('');
  const [accountActionBusy, setAccountActionBusy] = useState(false);

  return (
    <>
      {/* Account & Cloud Sync Section */}
      {accountEmail && syncState && (
        <section className="space-y-2">
          <SectionTitle icon={<Cloud size={20} />} title="الحساب والمزامنة السحابية" />
          <Card>
            {/* Deliberately plain: Card already supplies border and shadow. Passing
                border/shadow here created duplicate Tailwind classes, which resolve by
                stylesheet order rather than string order — so the base `shadow-sm` won and
                this card ended up as the only one in Settings carrying a stray shadow. */}
            <div className="flex items-center justify-between pb-3 border-b border-primary-100 dark:border-primary-800/60">
              <div className="min-w-0">
                <p className="text-xs text-gray-500 dark:text-gray-400">الحساب المسجل</p>
                <p className="text-sm font-bold text-primary-900 dark:text-primary-100 mt-0.5 min-w-0 truncate" dir="ltr">
                  {accountEmail}
                </p>
              </div>
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
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
                  const proceed = await confirm({
                    title: 'تسجيل الخروج من هذا الجهاز',
                    description:
                      'ستُرفع بياناتك إلى حسابك أولًا، ثم تُحذف من هذا الجهاز. تبقى بياناتك محفوظة في حسابك وتعود عند تسجيل الدخول مجددًا.',
                    confirmLabel: 'متابعة',
                    destructive: true,
                  });
                  if (!proceed) return;
                  setAccountActionBusy(true);
                  setAccountActionStatus('');
                  try {
                    const result = await onSignOut();
                    if (result !== 'upload-failed') return;
                    // The upload did not complete, so these rows are still on this device
                    // and signing out now would delete them without them ever reaching the
                    // account. That call belongs to the reader, with the cost spelled out —
                    // not to the app, which would otherwise take the data with it.
                    const anyway = await confirm({
                      title: 'تعذّرت رفع بياناتك',
                      description:
                        'لا يتاح الاتصال بالحساب الآن، فلم تصل بياناتك إلى حسابك بعد. إذا سجّلت الخروج ستُحذف من هذا الجهاز دون أن تُرفع. يمكنك البقاء مسجّلًا وستُرفع تلقائيًا عند عودة الاتصال.',
                      confirmLabel: 'تسجيل الخروج دون رفع',
                      cancelLabel: 'البقاء مسجّلًا',
                      destructive: true,
                    });
                    if (!anyway) {
                      setAccountActionStatus('لم يتم تسجيل الخروج. بياناتك ما زالت على هذا الجهاز وتُرفع تلقائيًا عند عودة الاتصال.');
                      return;
                    }
                    await onSignOut({ skipUpload: true });
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
            {onOpenAdmin && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onOpenAdmin}
                className="col-span-2 flex items-center justify-center gap-1.5 font-semibold text-xs"
              >
                <ShieldCheck size={15} /> لوحة الإدارة
              </Button>
            )}
            {accountActionStatus && (
              <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300 font-semibold">
                {accountActionStatus}
              </p>
            )}
          </Card>
        </section>
      )}
      {/* No account yet: the reader who entered as a guest and now wants their data
          on more than one device, offered where the account itself lives. */}
      {!accountEmail && onCreateAccount && (
        <section className="space-y-2">
          <SectionTitle icon={<Cloud size={20} />} title="الحساب والمزامنة السحابية" />
          <Card>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/60 dark:text-gold-300">
                <CloudUpload size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-primary-900 dark:text-primary-100">أنت تستخدم التطبيق بدون حساب</p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">بياناتك الحالية محفوظة على هذا الجهاز فقط</p>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
              أنشئ حسابًا لتُزامَن حفظك وخطتك ومفضّلاتك وبياناتك بين أجهزتك. لا يُحذف شيء من هذا
              الجهاز: كل ما عندك يُرفع إلى حسابك أولًا بعد إنشائه.
            </p>

            <Button
              variant="primary"
              onClick={onCreateAccount}
              className="mt-4 flex w-full items-center justify-center gap-1.5 font-semibold text-sm"
            >
              <LogIn size={16} /> إنشاء حساب أو تسجيل الدخول
            </Button>
            <p className="mt-2 text-center text-[0.6875rem] leading-relaxed text-primary-700/70 dark:text-primary-300/70">
              وإذا كان لديك حساب بالفعل، يمكنك تسجيل الدخول من نفس الشاشة.
            </p>
          </Card>
        </section>
      )}
      {dialog}
    </>
  );
}
