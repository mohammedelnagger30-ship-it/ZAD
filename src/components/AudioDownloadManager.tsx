import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Layers, Loader2, Music2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatBytes } from '@/data/contentCatalog';
import { AUDIO_RECITERS, loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { JUZ_INFO, SURAHS, toArabicNumber } from '@/data/surahs';
import { audioStatusInStore, removeAudioReciter, removeAudioSurah, subscribeToContent } from '@/utils/contentStore';
import { downloadSurahAudio } from '@/utils/quranAudio';
import {
  allSurahIds,
  countSurahs,
  describeBatchResult,
  runBatchDownload,
  surahsInJuz,
  type BatchProgress,
} from '@/utils/batchDownload';

export function AudioDownloadManager() {
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  const [surahId, setSurahId] = useState(1);
  const [status, setStatus] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [juzId, setJuzId] = useState(1);
  /** The batch run in progress — null before one starts and once it ends. */
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  /** The last batch run's outcome, kept as the one line it was written as. */
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const batchControllerRef = useRef<AbortController | null>(null);

  const reloadStatus = useCallback(async () => {
    setStatus(await audioStatusInStore(reciterId));
  }, [reciterId]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await audioStatusInStore(reciterId);
      if (active) setStatus(next);
    };
    void refresh();
    const unsubscribe = subscribeToContent(() => {
      void refresh();
    });
    return () => {
      active = false;
      unsubscribe();
      controllerRef.current?.abort();
      // A batch is a hundred fetches long; leaving the screen must stop it,
      // not orphan it behind a component that no longer renders.
      batchControllerRef.current?.abort();
    };
  }, [reciterId]);

  const complete = status.has(surahId);
  const downloadedSurahs = [...status].sort((a, b) => a - b);

  const changeReciter = (id: string) => {
    setReciterId(id);
    savePreferredReciter(id);
    setError(null);
  };

  const startDownload = async () => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    setProgress({ received: 0, total: 0 });
    try {
      await downloadSurahAudio(
        reciterId,
        surahId,
        ({ received, total }) => setProgress({ received, total }),
        controller.signal,
      );
      await reloadStatus();
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'تعذّر تنزيل التلاوة');
      await reloadStatus();
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setProgress(null);
    }
  };

  /** The scope each batch button covers, and what it would still have to fetch. */
  const juzSurahIds = useMemo(() => surahsInJuz(juzId), [juzId]);
  const wholeQuran = useMemo(allSurahIds, []);
  const pendingOf = useCallback(
    (ids: readonly number[]) => ids.filter((id) => !status.has(id)).length,
    [status],
  );
  const pendingJuz = pendingOf(juzSurahIds);
  const pendingQuran = pendingOf(wholeQuran);
  const busy = batchRunning || progress !== null;

  /**
   * One bar for the whole run: the surahs already behind us counted whole,
   * plus the fraction of the one in hand — so it advances continuously instead
   * of stepping once per surah, which on a hundred and fourteen files would
   * look stuck for minutes at a time.
   */
  const batchProgress =
    batch && batch.surahCount > 0
      ? Math.min(
          1,
          ((batch.surahIndex - 1) +
            (batch.bytesTotal > 0 ? Math.min(1, batch.received / batch.bytesTotal) : 0)) /
            batch.surahCount,
        )
      : 0;

  /**
   * Fetches a scope — one juz, or the whole Quran — one surah at a time.
   *
   * The queue lives in `runBatchDownload`, which skips what is already stored,
   * carries on past a single missing recitation, and stops early when the
   * connection is the thing that went. All this does is hand over the store's
   * snapshot, keep the screen's progress in step, and make sure leaving the
   * screen actually ends the run instead of orphaning it.
   */
  const startBatch = async (ids: readonly number[]) => {
    const controller = new AbortController();
    batchControllerRef.current = controller;
    setBatchRunning(true);
    setBatchNotice(null);
    setBatch(null);
    setError(null);
    try {
      const existing = await audioStatusInStore(reciterId);
      const result = await runBatchDownload(
        ids,
        {
          existing,
          download: (surahId, onProgress, signal) =>
            downloadSurahAudio(reciterId, surahId, onProgress, signal),
        },
        setBatch,
        controller.signal,
      );
      setBatchNotice(describeBatchResult(result));
      await reloadStatus();
    } catch (cause) {
      // The queue collects its own failures, so anything that reaches here is
      // the store or the status refresh, not one surah.
      setError(cause instanceof Error ? cause.message : 'تعذّر تنزيل التلاوات');
    } finally {
      if (batchControllerRef.current === controller) batchControllerRef.current = null;
      setBatchRunning(false);
      setBatch(null);
    }
  };

  const removeSurah = async (id: number) => {
    const surah = SURAHS.find((item) => item.id === id);
    if (!surah || !confirm(`حذف تلاوة سورة ${surah.name} للقارئ المحدد من الجهاز؟`)) return;
    await removeAudioSurah(reciterId, id);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Music2 size={20} className="text-primary-600 dark:text-gold-400" />
        <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">تلاوات القرآن</h2>
      </div>

      <Card>
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            اختر القارئ والسورة لتنزيل تلاوتها كاملة والاستماع إليها دون إنترنت. يمكنك تنزيل السور التي تحتاجها فقط.
          </p>
          <div className="md:grid md:grid-cols-2 md:gap-4">
            <label className="block space-y-1 md:max-w-none">
              <span className="text-xs text-gray-600 dark:text-gray-300">القارئ</span>
              <select
                value={reciterId}
                onChange={(event) => changeReciter(event.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
              >
                {AUDIO_RECITERS.map((reciter) => (
                  <option key={reciter.id} value={reciter.id}>{reciter.name}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 md:max-w-none">
              <span className="text-xs text-gray-600 dark:text-gray-300">السورة</span>
              <select
                value={surahId}
                onChange={(event) => setSurahId(Number(event.target.value))}
                disabled={busy}
                className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
              >
                {SURAHS.map((surah) => (
                  <option key={surah.id} value={surah.id}>سورة {surah.name} — {toArabicNumber(surah.ayahCount)} آية</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {complete
                ? 'السورة محفوظة على الجهاز'
                : 'غير محفوظة على الجهاز'}
            </p>
            {progress ? (
              <button
                onClick={() => controllerRef.current?.abort()}
                className="min-h-10 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                إيقاف
              </button>
            ) : complete ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-success-50 px-3 py-2 text-sm font-semibold text-success-700 dark:bg-success-900/30 dark:text-success-300">
                <Check size={16} /> محفوظة
              </span>
            ) : (
              <button
                onClick={() => void startDownload()}
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={16} /> تنزيل السورة
              </button>
            )}
          </div>

          {progress && (
            <div role="status">
              <div
                className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                role="progressbar"
                aria-label="تقدم تنزيل التلاوة"
                aria-valuemin={0}
                aria-valuemax={progress.total || undefined}
                aria-valuenow={progress.received}
              >
                <div
                  className="h-full bg-primary-500 transition-all"
                  style={{ width: `${progress.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 10}%` }}
                />
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-primary-700 dark:text-gold-300">
                <Loader2 size={13} className="animate-spin" />
                {progress.total
                  ? `${formatBytes(progress.received)} من ${formatBytes(progress.total)}`
                  : `تم تنزيل ${formatBytes(progress.received)}`}
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-error-600 dark:text-error-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {/* The scopes a person actually thinks in — a juz, or everything —
              instead of one surah chosen at a time. Both buttons carry their
              own cost in the label, so neither needs a dialog in front of it. */}
          <div className="space-y-3 border-t border-primary-100 pt-3 dark:border-primary-800">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-primary-600 dark:text-gold-400" />
              <h3 className="text-sm font-semibold text-primary-800 dark:text-primary-100">
                تنزيل دفعي
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              بدل تنزيل سورة سورة: نزّل جزءًا كاملًا أو القرآن كلّه لهذا القارئ. تُنزَّل
              السور كاملةً لأن ملفات التلاوة صُنعت سورةً سورةً، ولا يمكن قطع ملف عند حدّ
              الجزء.
            </p>

            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-40 space-y-1">
                <span className="text-xs text-gray-600 dark:text-gray-300">الجزء</span>
                <select
                  value={juzId}
                  onChange={(event) => setJuzId(Number(event.target.value))}
                  disabled={busy}
                  className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                >
                  {JUZ_INFO.map((juz) => (
                    <option key={juz.id} value={juz.id}>
                      {juz.name} — ص {toArabicNumber(juz.startPage)}
                      {'-'}
                      {toArabicNumber(juz.endPage)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => void startBatch(juzSurahIds)}
                disabled={busy || pendingJuz === 0}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Download size={16} />
                {pendingJuz === 0 ? 'الجزء محفوظ كاملًا' : `تنزيل الجزء — ${countSurahs(pendingJuz)}`}
              </button>
            </div>

            <button
              onClick={() => void startBatch(wholeQuran)}
              disabled={busy || pendingQuran === 0}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-primary-300 px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-700 dark:text-gold-300 dark:hover:bg-primary-800/60"
            >
              <Download size={16} />
              {pendingQuran === 0
                ? 'القرآن كلّه محفوظ'
                : `تنزيل القرآن كلّه — ${countSurahs(pendingQuran)}`}
            </button>

            {batch && (
              <div role="status" aria-live="polite">
                <div
                  className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  role="progressbar"
                  aria-label="تقدم التنزيل الدفعي"
                  aria-valuemin={0}
                  aria-valuemax={batch.surahCount}
                  aria-valuenow={batch.surahIndex}
                >
                  <div
                    className="h-full bg-primary-500 transition-all"
                    style={{ width: `${Math.round(batchProgress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-primary-700 dark:text-gold-300">
                  <Loader2 size={13} className="shrink-0 animate-spin" />
                  <span>
                    سورة {toArabicNumber(batch.surahIndex)} من {toArabicNumber(batch.surahCount)} —{' '}
                    {SURAHS.find((item) => item.id === batch.surahId)?.name}
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">
                    {batch.bytesTotal > 0
                      ? `${formatBytes(batch.received)} من ${formatBytes(batch.bytesTotal)}`
                      : formatBytes(batch.received)}
                  </span>
                </p>
                <button
                  onClick={() => batchControllerRef.current?.abort()}
                  className="mt-1 min-h-9 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  إيقاف
                </button>
              </div>
            )}

            {batchNotice && (
              <p role="status" className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                {batchNotice}
              </p>
            )}
          </div>

          {downloadedSurahs.length > 0 && (
            <div className="space-y-2 border-t border-primary-100 pt-3 dark:border-primary-800">
              <h3 className="text-sm font-semibold text-primary-800 dark:text-primary-100">
                السور المحفوظة لهذا القارئ
              </h3>
              <div className="flex flex-wrap gap-2">
                {downloadedSurahs.map((id) => {
                  const surah = SURAHS.find((item) => item.id === id)!;
                  return (
                    <div
                      key={id}
                      className="inline-flex items-center gap-1 rounded-lg bg-primary-50 px-2 py-1 text-xs text-primary-800 dark:bg-primary-800 dark:text-primary-100"
                    >
                      <button onClick={() => setSurahId(id)} className="py-1">
                        {surah.name}
                      </button>
                      <button
                        onClick={() => void removeSurah(id)}
                        aria-label={`حذف تلاوة سورة ${surah.name}`}
                        title="حذف من الجهاز"
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-gray-500 hover:bg-error-100 hover:text-error-600 dark:hover:bg-error-900/40"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={async () => {
                  const reciter = AUDIO_RECITERS.find((item) => item.id === reciterId)!;
                  if (confirm(`حذف كل التلاوات المحفوظة للقارئ ${reciter.name}؟`)) {
                    await removeAudioReciter(reciterId);
                  }
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-error-600 hover:bg-error-50 dark:text-error-300 dark:hover:bg-error-900/20"
              >
                <Trash2 size={14} /> حذف كل تلاوات هذا القارئ
              </button>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}
