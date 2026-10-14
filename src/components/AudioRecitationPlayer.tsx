import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, Check, Download, Pause, Play, RotateCcw, Square, Volume2, X } from 'lucide-react';
import { Card } from '@/components/ui';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import type { SurahMeta } from '@/data/surahs';
import { downloadSurahAudio } from '@/utils/quranAudio';
import { audioStatusInStore } from '@/utils/contentStore';
import { toArabicNumber } from '@/data/surahs';
import {
  getRecitationState,
  replayAyah,
  selectAyah,
  setTrack,
  startSelectedAyah,
  stop,
  subscribeRecitation,
  toggleSurah,
  updatePlaybackRate,
  updateRepeatCount,
  playAyahEnsured,
} from '@/utils/recitationEngine';

export interface AyahPlaybackControls {
  selectedAyah: number | null;
  activeAyah: number | null;
  isPlaying: boolean;
  selectAyah: (ayah: number) => void;
  playSelectedAyah: () => void;
  /** Take up any ayah of the surah and hear it from where it stands. */
  playAyah: (ayah: number) => void;
}

interface AudioRecitationPlayerProps {
  surah: SurahMeta;
  reciterId: string;
  onReciterChange: (reciterId: string) => void;
  onShowTafsir: (ayah: number) => void;
  children: (controls: AyahPlaybackControls) => ReactNode;
}

/**
 * The reader's recitation panel — a view over `@/utils/recitationEngine`.
 *
 * All playback lives in the engine so that leaving this screen does not stop
 * it: the reader unmounting tears down *this component* only, while the audio
 * element, the prepared source and the Media Session carry on (and the
 * memoriser keeps listening from the home screen or with the phone locked).
 * The one thing that must not survive is a *different track* — hence `setTrack`
 * in a layout effect, which runs before the first paint so a surah change can
 * never flash the previous surah's playing state, and is a no-op when the
 * engine already holds this track.
 */
export function AudioRecitationPlayer({
  surah,
  reciterId,
  onReciterChange,
  onShowTafsir,
  children,
}: AudioRecitationPlayerProps) {
  const engine = useSyncExternalStore(subscribeRecitation, getRecitationState);

  // Layout, not effect: a remount over a playing engine would otherwise paint
  // one frame of the old surah's state inside the new surah's reader.
  useLayoutEffect(() => {
    setTrack({ surahId: surah.id, surahName: surah.name, reciterId });
    // Deliberately no cleanup — that absence is what keeps playback alive.
  }, [surah.id, surah.name, reciterId]);

  // Offline download of this surah for this reciter — the memoriser's most
  // common ask after hearing a surah: keep it on the device. State mirrors the
  // store so the button reflects what is actually saved, not what was clicked.
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [downloadProgress, setDownloadProgress] = useState<{ received: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsDownloaded(false);
    setDownloadState('idle');
    setDownloadProgress(null);
    setDownloadError(null);
    audioStatusInStore(reciterId)
      .then((surahs) => {
        if (!cancelled) setIsDownloaded(surahs.has(surah.id));
      })
      .catch(() => {
        // The store check is best-effort — the download button still works.
      });
    return () => {
      cancelled = true;
      // Leaving the surah/reciter abandons any download in flight for it.
      downloadControllerRef.current?.abort();
      downloadControllerRef.current = null;
    };
  }, [reciterId, surah.id]);
  const startDownload = async (): Promise<void> => {
    const controller = new AbortController();
    downloadControllerRef.current = controller;
    setDownloadState('downloading');
    setDownloadError(null);
    setDownloadProgress(null);
    try {
      await downloadSurahAudio(reciterId, surah.id, (progress) => {
        setDownloadProgress({ received: progress.received, total: progress.total });
      }, controller.signal);
      if (downloadControllerRef.current === controller) {
        setIsDownloaded(true);
        setDownloadState('idle');
        setDownloadProgress(null);
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (downloadControllerRef.current === controller) {
        setDownloadState('error');
        setDownloadError(cause instanceof Error ? cause.message : 'تعذّر تنزيل التلاوة');
      }
    } finally {
      if (downloadControllerRef.current === controller) {
        downloadControllerRef.current = null;
      }
    }
  };

  const cancelDownload = (): void => {
    downloadControllerRef.current?.abort();
    downloadControllerRef.current = null;
    setDownloadState('idle');
    setDownloadProgress(null);
  };

  const {
    activeAyah,
    selectedAyah,
    isPlaying,
    sourceLoading,
    wholeFile,
    error,
    playbackRate,
    repeatCount,
  } = engine;

  return (
    <>
      <Card className="bg-primary-50 dark:bg-primary-900/30">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Volume2 size={19} className="text-primary-600 dark:text-gold-400" />
            <h3 className="font-bold text-primary-800 dark:text-primary-100">تلاوة صوتية</h3>
          </div>
          <div className="md:grid md:grid-cols-2 md:gap-4">
            <label className="block space-y-1 md:max-w-none">
              <span className="text-xs text-gray-600 dark:text-gray-300">القارئ</span>
              <select
                value={reciterId}
                onChange={(event) => onReciterChange(event.target.value)}
                className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
              >
                {AUDIO_RECITERS.map((reciter) => (
                  <option key={reciter.id} value={reciter.id}>
                    {reciter.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 md:max-w-none">
              <span className="text-xs text-gray-600 dark:text-gray-300">سرعة التلاوة</span>
              <select
                value={playbackRate}
                onChange={(event) => updatePlaybackRate(Number(event.target.value))}
                className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-hidden focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
              >
                <option value={0.75}>بطيئة — ٠٫٧٥×</option>
                <option value={1}>عادية — ١×</option>
                <option value={1.25}>أسرع قليلًا — ١٫٢٥×</option>
                <option value={1.5}>سريعة — ١٫٥×</option>
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void toggleSurah()}
              disabled={sourceLoading}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              {sourceLoading
                ? 'جار تجهيز التلاوة...'
                : isPlaying
                  ? 'إيقاف مؤقت'
                  : activeAyah
                    ? 'متابعة التلاوة'
                    : 'تشغيل السورة كاملة'}
            </button>
            {activeAyah !== null && (
              <button
                onClick={stop}
                title="إيقاف التلاوة"
                aria-label="إيقاف التلاوة"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white text-gray-600 hover:bg-gray-100 dark:bg-primary-800 dark:text-gray-200 dark:hover:bg-primary-700"
              >
                <Square size={17} />
              </button>
            )}
          </div>
          {/* Offline download — "keep this surah on my phone" used to be buried in
              ContentLibrary, three screens away from the moment someone wants it. */}
          <div
            aria-live="polite"
            className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-primary-200 bg-white/60 px-3 py-2 dark:border-primary-700 dark:bg-primary-900/40"
          >
            {isDownloaded ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-700 dark:text-success-400">
                <Check size={15} aria-hidden="true" />
                محفوظة للاستماع دون إنترنت
              </span>
            ) : downloadState === 'downloading' ? (
              <>
                <span className="text-xs font-semibold text-primary-700 dark:text-primary-200">
                  {downloadProgress?.total
                    ? `جارٍ التنزيل… ${Math.round(
                        (downloadProgress.received / downloadProgress.total) * 100,
                      )}٪`
                    : 'جارٍ التنزيل…'}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={cancelDownload}
                  className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-white px-2.5 text-xs font-bold text-gray-600 shadow-sm hover:bg-gray-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-gray-200 dark:hover:bg-primary-700"
                >
                  <X size={13} aria-hidden="true" />
                  إيقاف
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void startDownload()}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-100 px-3 text-xs font-bold text-primary-700 transition-colors hover:bg-primary-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
                >
                  <Download size={14} aria-hidden="true" />
                  تنزيل سورة {surah.name} للعمل دون إنترنت
                </button>
                {downloadState === 'error' && (
                  <span className="text-[11px] font-medium text-error-600 dark:text-error-400">
                    {downloadError ?? 'تعذّر التنزيل'}
                  </span>
                )}
              </>
            )}
          </div>
          {activeAyah !== null && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isPlaying ? 'تُتلى الآن' : 'متوقف مؤقتاً'} — الآية {toArabicNumber(activeAyah)}
              </p>
              <button
                onClick={() => void replayAyah()}
                disabled={sourceLoading}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:text-gold-300 dark:hover:bg-primary-800"
              >
                <RotateCcw size={14} /> إعادة الآية
              </button>
            </div>
          )}
          <div className="space-y-2 rounded-xl border border-primary-100 bg-white/80 p-3 dark:border-primary-800 dark:bg-primary-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">
                {selectedAyah === null
                  ? 'اختر آية من المصحف'
                  : `الآية المحددة: ${toArabicNumber(selectedAyah)}`}
              </p>
              {selectedAyah !== null && (
                <button
                  onClick={() => onShowTafsir(selectedAyah)}
                  className="min-h-10 rounded-lg px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:text-gold-300 dark:hover:bg-primary-800"
                >
                  التفسير
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ml-1 text-xs text-gray-600 dark:text-gray-400">تكرار الآية:</span>
              {wholeFile ? (
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  تلاوة ترديد الأطفال تُشغَّل سورةً كاملة — الشيخ يقرأ والأطفال يعيدون وراءه،
                  ردّد معهم.
                </p>
              ) : (
                <>
                  {[
                    { value: 1, label: 'مرة' },
                    { value: 3, label: '٣ مرات' },
                    { value: 5, label: '٥ مرات' },
                    { value: 10, label: '١٠ مرات' },
                    { value: 0, label: 'مستمر' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => updateRepeatCount(option.value)}
                      aria-pressed={repeatCount === option.value}
                      className={`min-h-10 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                        repeatCount === option.value
                          ? 'bg-gold-500 text-white'
                          : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                  <button
                    onClick={() => void startSelectedAyah()}
                    disabled={selectedAyah === null || sourceLoading}
                    className="mr-auto inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {activeAyah === selectedAyah && isPlaying ? <Pause size={15} /> : <Play size={15} />}
                    {activeAyah === selectedAyah && isPlaying ? 'إيقاف مؤقت' : 'استمع للآية'}
                  </button>
                </>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-error-600 dark:text-error-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </Card>
      {children({
        activeAyah,
        isPlaying,
        selectedAyah,
        selectAyah,
        playSelectedAyah: () => void startSelectedAyah(),
        playAyah: (ayah: number) => void playAyahEnsured(ayah),
      })}
    </>
  );
}
