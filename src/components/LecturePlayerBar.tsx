import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { useLecturePlayer, useLectureProgress } from '@/hooks/useLecturePlayer';
import { formatClock } from '@/utils/formatClock';
import {
  canPlayNext,
  canPlayPrevious,
  playNext,
  playPrevious,
  seekLecture,
  setLectureRate,
  stopLecture,
  togglePlay,
} from '@/utils/lecturePlayer';

/**
 * The lecture, wherever the listener is.
 *
 * Mounted once beside the tab bar, and dormant — it renders nothing — until a lecture has
 * actually been started, exactly like the recitation bar. A lecture is long enough that
 * the listener will leave the page it was started from: the sound is kept by the engine,
 * and this is only its face.
 *
 * Tapping the title unfolds the controls that a forty-minute recording needs and a short
 * one does not: a real scrubber, a skip, and a speed. The folded row stays one line tall
 * so the tab bar underneath is never buried.
 */
export function LecturePlayerBar() {
  const state = useLecturePlayer();
  const progress = useLectureProgress();
  const [expanded, setExpanded] = useState(false);
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  if (!state.current) return null;

  const shownMs = scrubMs ?? progress.positionMs;
  const durationMs = Math.max(1, Math.round(progress.durationMs || state.current.lecture.seconds * 1000));
  const percent = Math.min(100, Math.max(0, (shownMs / durationMs) * 100));
  const nextAvailable = canPlayNext();
  const previousAvailable = canPlayPrevious();

  const commitScrub = () => {
    if (scrubMs === null) return;
    seekLecture(scrubMs);
    setScrubMs(null);
  };

  return (
    <div
      className="fixed z-40 left-1/2 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:bottom-6 md:left-[calc(50%-2.625rem)] md:w-[calc(100%-9rem)] md:max-w-2xl lg:left-[calc(50%-3rem)] xl:left-[calc(50%-4rem)]"
      dir="rtl"
    >
      <div className="relative overflow-hidden rounded-2xl border border-primary-200/80 bg-panel/95 shadow-[0_12px_36px_-12px_var(--brand-glow,rgba(31,115,78,0.28))] backdrop-blur-xl dark:border-primary-800/80 dark:bg-raised/95">
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-primary-100 dark:bg-primary-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="موضع المحاضرة"
        >
          <div
            className="h-full bg-primary-500 transition-[width] duration-200 dark:bg-gold-400"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex items-center gap-1 p-1.5">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'طيّ مشغل المحاضرة' : 'توسيع مشغل المحاضرة'}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-right transition-colors hover:bg-primary-50/80 dark:hover:bg-primary-800/50"
          >
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-primary-100">
              {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-primary-800 dark:text-primary-100">
                {state.current.lecture.title}
              </span>
              <span className="block truncate text-[0.6875rem] text-gray-500 dark:text-gray-400">
                {state.error
                  ? state.error
                  : state.loading
                    ? 'جار التجهيز…'
                    : state.isPlaying
                      ? `${formatClock(shownMs)} · يُشتغل الآن`
                      : `${formatClock(shownMs)} · متوقف مؤقتاً`}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => void playPrevious()}
            disabled={!previousAvailable}
            aria-label="المحاضرة السابقة"
            title="المحاضرة السابقة"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipBack size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => togglePlay()}
            disabled={state.loading}
            aria-label={state.isPlaying ? 'إيقاف مؤقت' : 'متابعة'}
            title={state.isPlaying ? 'إيقاف مؤقت' : 'متابعة'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          >
            {state.loading ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : state.isPlaying ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void playNext()}
            disabled={!nextAvailable}
            aria-label="المحاضرة التالية"
            title={nextAvailable ? 'المحاضرة التالية' : 'هذه آخر محاضرة في القائمة'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipForward size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          {/* The dismiss control. «إيقاف» on a bar that is already paused reads as a
              transport command; the letter of the request here is «إلغاء» — close it —
              so it is drawn as an ✕ and says so. */}
          <button
            type="button"
            onClick={() => stopLecture()}
            aria-label="إلغاء المحاضرة وإغلاق المشغل"
            title="إلغاء"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-error-50 hover:text-error-600 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-error-900/30 dark:hover:text-error-400"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {expanded && (
          <div className="border-t border-primary-100 px-3 pb-3 pt-2 dark:border-primary-800">
            <input
              type="range"
              min={0}
              max={durationMs}
              step={1000}
              value={Math.round(shownMs)}
              onChange={(event) => setScrubMs(Number(event.target.value))}
              onPointerUp={commitScrub}
              onPointerCancel={commitScrub}
              onKeyUp={commitScrub}
              onBlur={commitScrub}
              aria-label="موضع المحاضرة"
              aria-valuetext={`${formatClock(shownMs)} من ${formatClock(durationMs)}`}
              className="h-9 w-full accent-primary-600 dark:accent-gold-400"
            />
            <div className="flex items-center justify-between text-[0.6875rem] tabular-nums text-gray-500 dark:text-gray-400">
              <span>{formatClock(shownMs)}</span>
              <span>{formatClock(durationMs)}</span>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => seekLecture(Math.max(0, progress.positionMs - 15000))}
                  aria-label="رجوع ١٥ ثانية"
                  title="رجوع ١٥ ثانية"
                  className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-800"
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  ١٥
                </button>
                <button
                  type="button"
                  onClick={() => seekLecture(progress.positionMs + 15000)}
                  aria-label="تقدّم ١٥ ثانية"
                  title="تقدّم ١٥ ثانية"
                  className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-800"
                >
                  <RotateCw size={15} aria-hidden="true" />
                  ١٥
                </button>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-[0.6875rem] text-gray-500 dark:text-gray-400">السرعة</span>
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setLectureRate(rate)}
                    aria-pressed={state.rate === rate}
                    className={`inline-flex h-8 min-w-9 items-center justify-center rounded-lg px-1.5 text-[0.6875rem] font-semibold transition-colors ${
                      state.rate === rate
                        ? 'bg-primary-600 text-white'
                        : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
                    }`}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
