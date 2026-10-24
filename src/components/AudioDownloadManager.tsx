import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Check, Download, FileDown, Layers, Loader2, Music2, Pause, Play, Search, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { formatBytes } from '@/data/contentCatalog';
import { AUDIO_RECITERS, loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { JUZ_INFO, SURAHS, toArabicNumber } from '@/data/surahs';
import {
  audioStatusInStore,
  listAudioTrackInfo,
  readAudioTrack,
  removeAudioReciter,
  removeAudioSurah,
  subscribeToContent,
  type AudioTrackInfo,
} from '@/utils/contentStore';
import { exportAudioTrack } from '@/utils/audioFileExport';
import {
  getRecitationState,
  setTrack,
  stop,
  subscribeRecitation,
  toggleSurah,
} from '@/utils/recitationEngine';
import { useConfirm } from '@/hooks/useConfirm';
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
  const playback = useSyncExternalStore(subscribeRecitation, getRecitationState);
  const { confirm, dialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<'downloads' | 'saved'>('saved');
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  const [libraryReciter, setLibraryReciter] = useState('all');
  const [librarySearch, setLibrarySearch] = useState('');
  const [allTracks, setAllTracks] = useState<AudioTrackInfo[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState<string | null>(null);
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
  const [exportingTrack, setExportingTrack] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const tracks = await listAudioTrackInfo();
        if (active) {
          setAllTracks(tracks);
          setLibraryError(null);
        }
      } catch (cause) {
        if (active) setLibraryError(cause instanceof Error ? cause.message : 'تعذّر تحميل قائمة التلاوات.');
      } finally {
        if (active) setLibraryLoading(false);
      }
    };
    void refresh();
    const unsubscribe = subscribeToContent(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const complete = status.has(surahId);
  const reciterOrder = useMemo(() => new Map(AUDIO_RECITERS.map((item, index) => [item.id, index])), []);
  const filteredTracks = useMemo(() => {
    const query = librarySearch.trim().toLocaleLowerCase('ar');
    return allTracks
      .filter((track) => libraryReciter === 'all' || track.reciterId === libraryReciter)
      .filter((track) => {
        if (!query) return true;
        const surahName = SURAHS.find((item) => item.id === track.surah)?.name ?? '';
        const reciterName = AUDIO_RECITERS.find((item) => item.id === track.reciterId)?.name ?? '';
        return surahName.toLocaleLowerCase('ar').includes(query) || reciterName.toLocaleLowerCase('ar').includes(query);
      })
      .sort((a, b) =>
        (reciterOrder.get(a.reciterId) ?? Number.MAX_SAFE_INTEGER) -
          (reciterOrder.get(b.reciterId) ?? Number.MAX_SAFE_INTEGER) ||
        a.surah - b.surah,
      );
  }, [allTracks, libraryReciter, librarySearch, reciterOrder]);
  const groupedTracks = useMemo(() => {
    const groups = new Map<string, AudioTrackInfo[]>();
    for (const track of filteredTracks) {
      const group = groups.get(track.reciterId) ?? [];
      group.push(track);
      groups.set(track.reciterId, group);
    }
    return [...groups.entries()];
  }, [filteredTracks]);

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
      // the store or the status refresh, not one surah. An abort (the reader
      // cancelled the batch) is not a failure.
      if (cause instanceof Error && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : 'تعذّر تنزيل التلاوات');
    } finally {
      if (batchControllerRef.current === controller) batchControllerRef.current = null;
      setBatchRunning(false);
      setBatch(null);
    }
  };

  const removeSurah = async (trackReciterId: string, id: number) => {
    const surah = SURAHS.find((item) => item.id === id);
    if (!surah) return;
    const confirmed = await confirm({
      title: `حذف تلاوة سورة ${surah.name}`,
      description: 'ستُحذف ملفات التلاوة من هذا الجهاز، وتُستعاد بإعادة تنزيلها متى شئت.',
      confirmLabel: 'حذف',
      destructive: true,
    });
    if (!confirmed) return;
    await removeAudioSurah(trackReciterId, id);
    if (playback.reciterId === trackReciterId && playback.surahId === id) stop();
  };

  const exportSurah = async (trackReciterId: string, id: number) => {
    const surah = SURAHS.find((item) => item.id === id);
    const reciter = AUDIO_RECITERS.find((item) => item.id === trackReciterId);
    if (!surah || !reciter) return;
    const key = `${trackReciterId}:${id}`;
    setExportingTrack(key);
    setExportError(null);
    setExportNotice(null);
    try {
      const track = await readAudioTrack(trackReciterId, id);
      if (!track) throw new Error('ملف التلاوة غير موجود على الجهاز. حدّث القائمة وحاول مجددًا.');
      const outcome = await exportAudioTrack(track, reciter.name, surah.name);
      setExportNotice(
        outcome === 'shared'
          ? `اختَر «حفظ في الملفات» من قائمة المشاركة لحفظ سورة ${surah.name} خارج التطبيق.`
          : null,
      );
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : 'تعذّر تصدير ملف التلاوة.');
    } finally {
      setExportingTrack(null);
    }
  };

  const playDownloadedSurah = (trackReciterId: string, id: number) => {
    const surah = SURAHS.find((item) => item.id === id);
    const reciter = AUDIO_RECITERS.find((item) => item.id === trackReciterId);
    if (!surah || !reciter) return;
    setError(null);
    if (playback.surahId === id && playback.reciterId === trackReciterId && playback.isPlaying) {
      void toggleSurah();
      return;
    }
    setTrack({ surahId: id, surahName: surah.name, reciterId: trackReciterId });
    void toggleSurah();
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Music2 size={20} className="text-primary-600 dark:text-gold-400" />
        <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">إدارة تنزيلات التلاوة</h2>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-primary-50 p-1.5 dark:bg-primary-900/50" role="tablist" aria-label="أقسام إدارة التلاوات">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'saved'}
          onClick={() => setActiveTab('saved')}
          className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'saved' ? 'bg-white text-primary-800 shadow-sm dark:bg-primary-800 dark:text-primary-100' : 'text-gray-600 dark:text-gray-300'}`}
        >
          السور المحفوظة ({allTracks.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'downloads'}
          onClick={() => setActiveTab('downloads')}
          className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${activeTab === 'downloads' ? 'bg-white text-primary-800 shadow-sm dark:bg-primary-800 dark:text-primary-100' : 'text-gray-600 dark:text-gray-300'}`}
        >
          تنزيل تلاوات
        </button>
      </div>

      {activeTab === 'downloads' ? <Card>
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            اختر القارئ والسورة لتنزيل تلاوتها كاملة والاستماع إليها دون إنترنت. تُحفَظ كل سورة تحت اسم قارئها،
            ويمكنك تصديرها إلى تطبيق «الملفات» من قائمة المشاركة.
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

          {exportNotice && (
            <p role="status" className="text-xs leading-relaxed text-success-700 dark:text-success-300">
              {exportNotice}
            </p>
          )}
          {exportError && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-error-600 dark:text-error-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {exportError}
            </p>
          )}
        </div>
      </Card>
        : <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-48 flex-1 space-y-1">
                <span className="text-xs text-gray-600 dark:text-gray-300">عرض تلاوات القارئ</span>
                <select
                  value={libraryReciter}
                  onChange={(event) => setLibraryReciter(event.target.value)}
                  className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                >
                  <option value="all">كل القراء</option>
                  {AUDIO_RECITERS.map((reciter) => <option key={reciter.id} value={reciter.id}>{reciter.name}</option>)}
                </select>
              </label>
              <label className="min-w-48 flex-1 space-y-1">
                <span className="text-xs text-gray-600 dark:text-gray-300">بحث بالسورة أو القارئ</span>
                <span className="flex min-h-11 items-center gap-2 rounded-xl border border-primary-200 bg-white px-3 dark:border-primary-700 dark:bg-primary-900">
                  <Search size={16} className="shrink-0 text-gray-400" />
                  <input
                    value={librarySearch}
                    onChange={(event) => setLibrarySearch(event.target.value)}
                    placeholder="مثال: البقرة"
                    className="w-full bg-transparent text-sm text-primary-800 outline-none placeholder:text-gray-400 dark:text-primary-100"
                  />
                </span>
              </label>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="rounded-full bg-primary-50 px-3 py-1.5 dark:bg-primary-800">{toArabicNumber(filteredTracks.length)} سورة محفوظة</span>
              <span className="rounded-full bg-primary-50 px-3 py-1.5 dark:bg-primary-800">{formatBytes(filteredTracks.reduce((sum, track) => sum + track.bytes, 0))} مساحة التلاوات</span>
            </div>
            {libraryError && <p role="alert" className="flex items-center gap-2 text-sm text-error-600 dark:text-error-300"><AlertTriangle size={16} />{libraryError}</p>}
            {libraryLoading ? (
              <p role="status" className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 size={17} className="animate-spin" />جارٍ تحميل السور المحفوظة...</p>
            ) : groupedTracks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-primary-200 px-4 py-10 text-center dark:border-primary-700">
                <Music2 size={28} className="mx-auto mb-2 text-gray-400" />
                <p className="font-semibold text-primary-800 dark:text-primary-100">{allTracks.length ? 'لا توجد نتائج مطابقة' : 'لا توجد تلاوات محفوظة بعد'}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">انتقل إلى «تنزيل تلاوات» لإضافة سور تعمل دون إنترنت.</p>
                <button onClick={() => setActiveTab('downloads')} className="mt-3 min-h-10 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white">تنزيل تلاوات</button>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedTracks.map(([groupReciterId, tracks]) => {
                  const reciter = AUDIO_RECITERS.find((item) => item.id === groupReciterId);
                  if (!reciter) return null;
                  const groupBytes = tracks.reduce((sum, track) => sum + track.bytes, 0);
                  const activeInGroup = playback.reciterId === groupReciterId;
                  return (
                    <section key={groupReciterId} className="overflow-hidden rounded-2xl border border-primary-100 dark:border-primary-800">
                      <header className="flex flex-wrap items-center justify-between gap-2 bg-primary-50 px-3 py-3 dark:bg-primary-800/60">
                        <div>
                          <h3 className="font-bold text-primary-800 dark:text-primary-100">{reciter.name}</h3>
                          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{toArabicNumber(tracks.length)} سورة · {formatBytes(groupBytes)}</p>
                        </div>
                        <button
                          onClick={async () => {
                            const confirmed = await confirm({
                              title: `حذف كل تلاوات ${reciter.name}`,
                              description: `ستُحذف السور المحفوظة لهذا القارئ وعددها ${toArabicNumber(tracks.length)} من هذا الجهاز.`,
                              confirmLabel: 'حذف الكل',
                              destructive: true,
                            });
                            if (confirmed) {
                              await removeAudioReciter(groupReciterId);
                              if (activeInGroup) stop();
                            }
                          }}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-error-600 hover:bg-error-50 dark:text-error-300 dark:hover:bg-error-900/20"
                        >
                          <Trash2 size={14} /> حذف تلاوات القارئ
                        </button>
                      </header>
                      <div className="divide-y divide-primary-50 dark:divide-primary-800/70">
                        {tracks.map((track) => {
                          const surah = SURAHS.find((item) => item.id === track.surah);
                          if (!surah) return null;
                          const isActive = playback.reciterId === groupReciterId && playback.surahId === track.surah;
                          const exportKey = `${groupReciterId}:${track.surah}`;
                          return (
                            <div key={track.key} className="flex min-h-14 items-center gap-2 px-2 py-2 sm:px-3">
                              <button
                                onClick={() => playDownloadedSurah(groupReciterId, track.surah)}
                                disabled={playback.sourceLoading && isActive}
                                aria-label={isActive && playback.isPlaying ? `إيقاف سورة ${surah.name} مؤقتًا` : `استمع إلى سورة ${surah.name} بصوت ${reciter.name}`}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:bg-primary-800 dark:text-gold-300"
                              >
                                {playback.sourceLoading && isActive ? <Loader2 size={15} className="animate-spin" /> : isActive && playback.isPlaying ? <Pause size={15} /> : <Play size={15} />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-primary-800 dark:text-primary-100">سورة {surah.name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{formatBytes(track.bytes)} · {new Date(track.savedAt).toLocaleDateString('ar')}</p>
                              </div>
                              <button
                                onClick={() => void exportSurah(groupReciterId, track.surah)}
                                disabled={exportingTrack !== null}
                                aria-label={`تصدير سورة ${surah.name}`}
                                title="حفظ ملف السورة خارج التطبيق"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-gold-300 dark:hover:bg-primary-800"
                              >
                                {exportingTrack === exportKey ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                              </button>
                              <button
                                onClick={() => void removeSurah(groupReciterId, track.surah)}
                                aria-label={`حذف سورة ${surah.name} للقارئ ${reciter.name}`}
                                title="حذف من الجهاز"
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-error-50 hover:text-error-600 dark:hover:bg-error-900/30"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {activeInGroup && (
                        <p role="status" aria-live="polite" className="border-t border-primary-100 px-3 py-2 text-xs text-primary-700 dark:border-primary-800 dark:text-gold-300">
                          {playback.sourceLoading ? 'جارٍ تجهيز التلاوة...' : playback.error ?? (playback.isPlaying ? `تُتلى الآن بصوت ${reciter.name}` : playback.sessionOpen ? 'التلاوة متوقفة مؤقتًا' : '')}
                        </p>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
            {(exportNotice || exportError) && (
              <p role={exportError ? 'alert' : 'status'} className={`text-xs leading-relaxed ${exportError ? 'text-error-600 dark:text-error-300' : 'text-success-700 dark:text-success-300'}`}>
                {exportError ?? exportNotice}
              </p>
            )}
          </div>
        </Card>}
      {dialog}
    </section>
  );
}
