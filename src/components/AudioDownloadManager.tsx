import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, Music2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatBytes } from '@/data/contentCatalog';
import { AUDIO_RECITERS, loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { SURAHS, toArabicNumber } from '@/data/surahs';
import { audioStatusInStore, removeAudioReciter, removeAudioSurah, subscribeToContent } from '@/utils/contentStore';
import { downloadSurahAudio } from '@/utils/quranAudio';

export function AudioDownloadManager() {
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  const [surahId, setSurahId] = useState(1);
  const [status, setStatus] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

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
          <label className="block space-y-1">
            <span className="text-xs text-gray-600 dark:text-gray-300">القارئ</span>
            <select
              value={reciterId}
              onChange={(event) => changeReciter(event.target.value)}
              disabled={progress !== null}
              className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
            >
              {AUDIO_RECITERS.map((reciter) => (
                <option key={reciter.id} value={reciter.id}>{reciter.name}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600 dark:text-gray-300">السورة</span>
            <select
              value={surahId}
              onChange={(event) => setSurahId(Number(event.target.value))}
              disabled={progress !== null}
              className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
            >
              {SURAHS.map((surah) => (
                <option key={surah.id} value={surah.id}>سورة {surah.name} — {toArabicNumber(surah.ayahCount)} آية</option>
              ))}
            </select>
          </label>

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
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
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
