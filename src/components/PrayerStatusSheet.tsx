import { useEffect, useState } from 'react';
import { Check, Clock, X, RotateCcw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  PRAYER_LABELS_AR,
  prayerEditTimeRemaining,
  type PrayerKey,
  type PrayerStatus,
} from '@/utils/prayerTracker';

interface PrayerStatusSheetProps {
  prayer: PrayerKey;
  /** e.g. `٤:٥٢ ص`. Shown as context so the right prayer is obvious. */
  timeLabel?: string;
  status: PrayerStatus | null;
  onPick: (status: PrayerStatus) => void;
  onClear: () => void;
  onClose: () => void;
  /** True when the record being edited is for a day other than today. */
  isHistorical?: boolean;
  editable?: boolean;
  confirmedAt?: number | null;
  dateLabel?: string;
}

const OPTIONS: { status: PrayerStatus; label: string; icon: typeof Check; variant: 'success' | 'warning' | 'error'; active: string }[] = [
  { status: 'ontime', label: 'صلّيتها في وقتها', icon: Check, variant: 'success', active: 'bg-success-500 text-white border-success-500' },
  { status: 'late', label: 'صلّتها قضاء', icon: Clock, variant: 'warning', active: 'bg-warning-500 text-white border-warning-500' },
  { status: 'missed', label: 'ما صليتهاش', icon: X, variant: 'error', active: 'bg-error-500 text-white border-error-500' },
];

/**
 * One place to answer "did I pray this?".
 *
 * This replaced three 24×24 icon buttons crammed into a 3-column tile on the home
 * screen. Measured, those were 576 px² against the 44×44 (1,936 px²) that a finger
 * reliably hits — and one of them was a grey ✕ sitting right next to a red ✕, so a
 * mistap was likely. Here every action is a full-width button with a text label, so
 * there is nothing to misread and nothing to miss.
 */
export function PrayerStatusSheet({
  prayer,
  timeLabel,
  status,
  onPick,
  onClear,
  onClose,
  isHistorical,
  editable = true,
  confirmedAt,
  dateLabel,
}: PrayerStatusSheetProps) {
  const [now, setNow] = useState(Date.now());
  const [actionError, setActionError] = useState('');
  const [historicalEditStartedAt, setHistoricalEditStartedAt] = useState<number | null>(null);
  const activeConfirmationTime = historicalEditStartedAt ?? confirmedAt ?? undefined;
  const remaining = status ? prayerEditTimeRemaining(activeConfirmationTime, now) : 10_000;
  const historicalCorrectionAvailable =
    isHistorical && historicalEditStartedAt === null && remaining <= 0;
  const canChange = editable && (!status || remaining > 0 || historicalCorrectionAvailable);

  // A sheet that cannot be dismissed with the keyboard traps focus on a phone with a
  // hardware keyboard, and it leaves the page scrollable behind it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  useEffect(() => {
    if (!status || prayerEditTimeRemaining(confirmedAt ?? undefined) <= 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, [status, confirmedAt]);

  const submit = async (action: () => void | Promise<void>, startsHistoricalWindow = false) => {
    setActionError('');
    const timestamp = startsHistoricalWindow && isHistorical ? Date.now() : null;
    if (timestamp !== null) {
      setHistoricalEditStartedAt(timestamp);
      setNow(timestamp);
    }
    try {
      await action();
    } catch (error) {
      if (timestamp !== null) setHistoricalEditStartedAt(null);
      setActionError(error instanceof Error ? error.message : 'تعذّر حفظ حالة الصلاة.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`تأكيد صلاة ${PRAYER_LABELS_AR[prayer]}`}
        className="w-full max-w-md bg-white dark:bg-primary-900 rounded-t-3xl sm:rounded-3xl shadow-2xl animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 className="text-xl font-bold text-primary-800 dark:text-primary-100">
              صلاة {PRAYER_LABELS_AR[prayer]}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {isHistorical ? (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} /> {dateLabel}
                </span>
              ) : (
                'هل صليتها؟'
              )}
              {timeLabel && <span aria-hidden="true">&nbsp;·&nbsp;</span>}
              {timeLabel}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-11 h-11 shrink-0 rounded-full bg-gray-100 dark:bg-primary-800 flex items-center justify-center text-gray-500 dark:text-primary-200 hover:bg-gray-200 dark:hover:bg-primary-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* The three answers. Full width, 56px tall, icon + text — nothing to misread. */}
        {!editable && (
          <p className="mx-5 mb-3 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-600 dark:bg-primary-800/50 dark:text-gray-300">
            يمكنك تسجيل صلوات اليوم وأمس فقط. هذا اليوم محفوظ للعرض ولا يمكن تعديله.
          </p>
        )}
        {editable && status && remaining > 0 && (
          <div className="px-5 pb-3" aria-live="polite">
            <p className="text-sm font-semibold text-primary-700 dark:text-gold-300">
              يمكنك تعديل التأكيد لمدة {Math.ceil(remaining / 1000)} ثوانٍ
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-primary-800">
              <div
                className="h-full rounded-full bg-gold-500 transition-[width] duration-100"
                style={{ width: `${(remaining / 10_000) * 100}%` }}
              />
            </div>
          </div>
        )}
        {editable && status && remaining <= 0 && (
          <p className="mx-5 mb-3 rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-900/20 dark:text-warning-200">
            {historicalCorrectionAvailable
              ? 'يمكنك تصحيح تسجيل أمس. بعد التعديل تبدأ مهلة جديدة مدتها ١٠ ثوانٍ.'
              : 'انتهت مهلة التعديل. لا يمكن تغيير هذا التأكيد بعد الآن.'}
          </p>
        )}
        {actionError && (
          <p role="alert" className="mx-5 mb-3 rounded-xl bg-error-50 px-3 py-2 text-sm text-error-700 dark:bg-error-900/20 dark:text-error-300">
            {actionError}
          </p>
        )}

        <div className="px-5 space-y-2.5">
          {OPTIONS.map(({ status: value, label, icon: Icon, active }) => {
            const selected = status === value;
            return (
              <button
                key={value}
                onClick={() => void submit(() => onPick(value), isHistorical)}
                aria-pressed={selected}
                disabled={!canChange}
                className={`w-full min-h-14 px-4 py-3 rounded-2xl border-2 flex items-center gap-3 text-right transition-smooth active:scale-[0.99] ${
                  selected
                    ? active
                    : 'bg-gray-50 dark:bg-primary-800/40 border-transparent text-primary-800 dark:text-primary-100 hover:border-primary-200 dark:hover:border-primary-600'
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <span
                  className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                    selected ? 'bg-white/20' : 'bg-gray-100 dark:bg-primary-800'
                  }`}
                >
                  <Icon size={20} className={selected ? '' : 'text-gray-500 dark:text-primary-300'} />
                </span>
                <span className="flex-1 font-semibold">{label}</span>
                {selected && <Check size={18} />}
              </button>
            );
          })}
        </div>

        {/* Undo. Always present once something is recorded, never a tiny icon. */}
        {status && canChange && (
          <div className="px-5 pt-3">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => void submit(onClear, isHistorical)}
              className="!text-error-600 dark:!text-error-400"
            >
              <RotateCcw size={18} />
              تراجع — امسح التأكيد وابدأ من جديد
            </Button>
          </div>
        )}

        <div className="px-5 pb-5 pt-3">
          <Button variant="ghost" size="md" fullWidth onClick={onClose}>
            {status ? 'إغلاق' : 'لاحقاً'}
          </Button>
        </div>
      </div>
    </div>
  );
}
