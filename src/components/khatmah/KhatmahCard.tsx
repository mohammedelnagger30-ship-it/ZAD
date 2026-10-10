import { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, Button } from '@/components/ui';
import { toArabicNumber, TOTAL_QURAN_PAGES } from '@/data/surahs';
import { todayKey } from '@/utils/dateUtils';
import { clearKhatmah, createKhatmahPlan, describeKhatmah, loadKhatmah, saveKhatmah } from '@/utils/khatmah';
import type { KhatmahPlan } from '@/db/database';

/**
 * The completion plan, whole: it loads its own row, keeps its own daily
 * arithmetic and writes itself back — nothing the rest of the Quran screen
 * reads is here, so the card can mount, retry after a failed load, and finish
 * a plan without the screen around it knowing any of it.
 */
export function KhatmahCard() {
  const [khatmah, setKhatmah] = useState<KhatmahPlan | null>(null);
  const [khatmahPickerOpen, setKhatmahPickerOpen] = useState(false);

  // The khatmah plan loads once; the card mutates it through saveKhatmah.
  useEffect(() => {
    let cancelled = false;
    loadKhatmah()
      .then((plan) => {
        if (!cancelled) setKhatmah(plan);
      })
      .catch(() => {
        // A database failure must not take the Quran screen down with it — the
        // card falls back to the start CTA and the next mount retries the load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const khatmahStatus = useMemo(
    () => (khatmah ? describeKhatmah(khatmah, todayKey()) : null),
    [khatmah]
  );

  const startKhatmah = useCallback(async (targetDays: number | null) => {
    const plan = await saveKhatmah(createKhatmahPlan(todayKey(), targetDays));
    setKhatmah(plan);
    setKhatmahPickerOpen(false);
  }, []);

  const advanceKhatmah = useCallback(
    async (delta: number) => {
      if (!khatmah) return;
      const plan = await saveKhatmah({
        ...khatmah,
        currentPage: Math.min(Math.max(khatmah.currentPage + delta, 0), TOTAL_QURAN_PAGES),
        updatedAt: Date.now(),
      });
      setKhatmah(plan);
    },
    [khatmah]
  );

  const finishKhatmah = useCallback(async () => {
    await clearKhatmah();
    setKhatmah(null);
    setKhatmahPickerOpen(false);
  }, []);

  return (
    <section>
      <Card className="space-y-3 border border-primary-200/80 shadow-md dark:border-primary-800/80">
        {khatmah && khatmahStatus && !khatmahStatus.finished ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-100">ختمة القرآن</p>
              <Button variant="ghost" size="sm" onClick={() => { void finishKhatmah(); }}>
                إنهاء
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-primary-50/70 py-2 dark:bg-primary-900/30">
                <p className="text-lg font-bold text-primary-800 dark:text-gold-400">{toArabicNumber(khatmahStatus.completed)}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">صفحة مقروءة</p>
              </div>
              <div className="rounded-2xl bg-primary-50/70 py-2 dark:bg-primary-900/30">
                <p className="text-lg font-bold text-primary-800 dark:text-gold-400">{toArabicNumber(khatmahStatus.remaining)}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">صفحة متبقية</p>
              </div>
              <div className="rounded-2xl bg-primary-50/70 py-2 dark:bg-primary-900/30">
                <p className="text-lg font-bold text-primary-800 dark:text-gold-400">
                  {khatmahStatus.pagesPerDay !== null ? toArabicNumber(khatmahStatus.pagesPerDay) : '—'}
                </p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">صفحة اليوم</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-primary-100 dark:bg-primary-800/50">
                <div
                  className="h-full rounded-full bg-linear-to-r from-primary-500 to-primary-600 transition-all"
                  style={{ width: `${khatmahStatus.percent}%` }}
                />
              </div>
              <span className="text-xs font-bold text-primary-700 dark:text-primary-200">
                {toArabicNumber(khatmahStatus.percent)}٪
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {khatmah.targetDate
                  ? khatmahStatus.daysLeft !== null && khatmahStatus.daysLeft > 0
                    ? `باقٍ ${toArabicNumber(khatmahStatus.daysLeft)} يومًا على هدف ${khatmah.targetDate}`
                    : 'تجاوز هدف الوقت'
                  : 'بلا هدف وقت'}
              </p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { void advanceKhatmah(-1); }}
                  aria-label="إنقاص صفحة من التقدّم"
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary-200 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                >
                  −
                </button>
                <span className="min-w-[7.5rem] text-center text-xs font-bold text-primary-800 dark:text-primary-100">
                  حتى صفحة {toArabicNumber(khatmahStatus.completed)}
                </span>
                <button
                  type="button"
                  onClick={() => { void advanceKhatmah(1); }}
                  aria-label="زيادة صفحة في التقدّم"
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary-200 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-700 dark:text-primary-200 dark:hover:bg-primary-800/40"
                >
                  +
                </button>
              </div>
            </div>
          </>
        ) : khatmah && khatmahStatus ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-100">تمّت الختمة</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">قرأت جميع صفحات المصحف.</p>
            </div>
            <Button
              variant="gold"
              size="sm"
              onClick={() => {
                void finishKhatmah().then(() => setKhatmahPickerOpen(true));
              }}
            >
              ختمة جديدة
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-primary-900 dark:text-primary-100">ختمة القرآن</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                خطة بهدف وتقدّم يومي بالصفحات.
              </p>
            </div>
            <Button
              variant={khatmahPickerOpen ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setKhatmahPickerOpen((open) => !open)}
            >
              {khatmahPickerOpen ? 'لاحقًا' : 'ابدأ خطة'}
            </Button>
          </div>
        )}
        {khatmahPickerOpen && !khatmah && (
          <div className="flex flex-wrap gap-2 border-t border-primary-100 pt-3 dark:border-primary-800/60">
            {[30, 60, 90].map((days) => (
              <Button key={days} variant="secondary" size="sm" onClick={() => { void startKhatmah(days); }}>
                {days} يومًا
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => { void startKhatmah(null); }}>
              بلا هدف وقت
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}
