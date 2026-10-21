import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, Pause, Play, SkipBack, SkipForward, Square, X } from 'lucide-react';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { toArabicDigits } from '@/data/surahs';
import { formatClock } from '@/utils/formatClock';
import { useDialogBehavior } from '@/hooks/useDialogBehavior';
import {
  useRecitation,
  useRecitationProgress,
  useRecitationSheetOpen,
  useRecitationVisible,
} from '@/hooks/useRecitation';
import {
  canPlayNextSurah,
  canPlayPreviousSurah,
  playNextSurah,
  playPreviousSurah,
  seekTo,
  stop,
  toggleSurah,
  updatePlaybackRate,
  updateRepeatCount,
} from '@/utils/recitationEngine';
import { setRecitationSheetOpen } from '@/utils/recitationPlayerUi';

/**
 * The recitation, wherever the listener happens to be.
 *
 * A recitation started in the reader keeps sounding after the reader is left behind —
 * the engine is module-scoped precisely so that it does — but until now the only way
 * back to it was to walk back to the reader and find the surah again. This pairs the
 * mini bar (always there, above the tab bar, on every screen) with the expanded
 * player (a bottom sheet with the scrubber, the speed and the repeat), so the
 * recitation is a first-class thing in the app rather than a control inside one screen.
 *
 * Both surfaces are the same engine the reader drives, so there is no second player to
 * keep in step: pausing here pauses the lock-screen card, and the surah that walks on
 * by itself at the end updates both.
 */

const ARTWORK = '/icons/icon-512.png';

// Module-level so the dismissed state survives the bar unmounting.
let miniBarDismissed = false;
export function dismissMiniBar(): void {
  miniBarDismissed = true;
}
export function resetMiniBarDismissed(): void {
  miniBarDismissed = false;
}

const SPEED_OPTIONS = [
  { value: 0.75, label: '٠٫٧٥×' },
  { value: 1, label: '١×' },
  { value: 1.25, label: '١٫٢٥×' },
  { value: 1.5, label: '١٫٥×' },
];

const REPEAT_OPTIONS = [
  { value: 1, label: 'مرة' },
  { value: 3, label: '٣ مرات' },
  { value: 5, label: '٥ مرات' },
  { value: 10, label: '١٠ مرات' },
  { value: 0, label: 'مستمر' },
];

/** `3:05` in Arabic-Indic digits — a clock, not an ayah number. */

function useReciterName(reciterId: string | null): string {
  return AUDIO_RECITERS.find((item) => item.id === reciterId)?.name ?? 'قارئ';
}

/**
 * Mounted once, next to the tab bar. Renders nothing at all until a recitation has
 * been started — the whole component is dormant otherwise, so a learner who only
 * reads is never given a player bar to ignore.
 */
export function RecitationPlayer() {
  const visible = useRecitationVisible();
  const sheetOpen = useRecitationSheetOpen();

  if (!visible) return null;

  return (
    <>
      {/* The mini bar steps aside while the expanded player is up: the sheet *is* the
          player, and two sets of transport controls on one screen invite mis-taps. */}
      {!sheetOpen && <RecitationMiniBar />}
      {sheetOpen && <RecitationSheet onClose={() => setRecitationSheetOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The mini bar
// ---------------------------------------------------------------------------

function RecitationMiniBar() {
  const state = useRecitation();
  const progress = useRecitationProgress();
  const reciterName = useReciterName(state.reciterId);
  const [, force] = useState(0);

  // Reset dismissal when a new surah starts playing.
  useEffect(() => {
    resetMiniBarDismissed();
    force((n) => n + 1);
  }, [state.surahId]);

  if (miniBarDismissed) return null;

  const percent =
    progress.durationMs > 0
      ? Math.min(100, (progress.positionMs / progress.durationMs) * 100)
      : 0;
  const nextAvailable = canPlayNextSurah();
  // At الفاتحة there is no surah before this one, so the button means «start this one
  // again» — the same wording the expanded player uses for it.
  const previousHint = canPlayPreviousSurah() ? 'السورة السابقة' : 'إعادة السورة من أولها';

  return (
    <div
      className="fixed z-40 left-1/2 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:bottom-6 md:left-[calc(50%-2.625rem)] md:w-[calc(100%-9rem)] md:max-w-2xl lg:left-[calc(50%-3rem)] xl:left-[calc(50%-4rem)]"
      dir="rtl"
    >
      <div className="relative overflow-hidden rounded-2xl border border-primary-200/80 bg-panel/95 shadow-[0_12px_36px_-12px_var(--brand-glow,rgba(31,115,78,0.28))] backdrop-blur-xl dark:border-primary-800/80 dark:bg-raised/95">
        {/* The progress hairline: enough to see how far the surah has come without
            making the bar taller than the tab bar it sits above. */}
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-primary-100 dark:bg-primary-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="موضع التلاوة"
        >
          <div
            className="h-full bg-primary-500 transition-[width] duration-200 dark:bg-gold-400"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div className="flex items-center gap-1 p-1.5">
          <button
            type="button"
            onClick={() => setRecitationSheetOpen(true)}
            aria-label={`فتح مشغل التلاوة — سورة ${state.surahName ?? ''}`}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-right transition-colors hover:bg-primary-50/80 dark:hover:bg-primary-800/50"
          >
            <img src={ARTWORK} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-primary-800 dark:text-primary-100">
                {state.surahName ? `سورة ${state.surahName}` : 'تلاوة قرآنية'}
              </span>
              <span className="block truncate text-[0.6875rem] text-gray-500 dark:text-gray-400">
                {state.sourceLoading ? 'جار تجهيز التلاوة…' : reciterName}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              dismissMiniBar();
              force((n) => n + 1);
            }}
            aria-label="إخفاء المشغل"
            title="إخفاء"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-primary-800"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void playPreviousSurah()}
            aria-label={previousHint}
            title={previousHint}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipBack size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void toggleSurah()}
            disabled={state.sourceLoading}
            aria-label={state.isPlaying ? 'إيقاف مؤقت' : 'متابعة التلاوة'}
            title={state.isPlaying ? 'إيقاف مؤقت' : 'متابعة التلاوة'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          >
            {state.sourceLoading ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : state.isPlaying ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void playNextSurah()}
            disabled={!nextAvailable}
            aria-label="السورة التالية"
            title={nextAvailable ? 'السورة التالية' : 'هذه آخر سورة في المصحف'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipForward size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={stop}
            aria-label="إيقاف التلاوة وإغلاق المشغل"
            title="إيقاف التلاوة"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-primary-800"
          >
            <Square size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The expanded player
// ---------------------------------------------------------------------------

interface RecitationSheetProps {
  onClose: () => void;
}

function RecitationSheet({ onClose }: RecitationSheetProps) {
  const state = useRecitation();
  const progress = useRecitationProgress();
  const reciterName = useReciterName(state.reciterId);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Mounted only while open: back, Escape and Tab all stay inside the sheet instead
  // of reaching the screen underneath it.
  useDialogBehavior(true, onClose, panelRef);

  /**
   * The scrubber follows the finger, not the audio, while it is being dragged —
   * a needle that fights back under the thumb is unusable. The engine is only told
   * where the listener landed, on release.
   */
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const shownMs = scrubMs ?? progress.positionMs;
  const durationMs = Math.max(1, Math.round(progress.durationMs));
  const commitScrub = () => {
    if (scrubMs === null) return;
    seekTo(scrubMs);
    setScrubMs(null);
  };

  // Drag the sheet down to dismiss — the gesture every bottom sheet in this app
  // answers to, applied to the handle only so it cannot fight the scrubber.
  const dragStartRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const onDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current === null) return;
    setDragOffset(Math.max(0, event.clientY - dragStartRef.current));
  };
  const onDragEnd = () => {
    if (dragStartRef.current === null) return;
    const offset = dragOffset;
    dragStartRef.current = null;
    setDragOffset(0);
    if (offset > 90) onClose();
  };

  const nextAvailable = canPlayNextSurah();
  const previousHint = canPlayPreviousSurah() ? 'السورة السابقة' : 'إعادة السورة من أولها';

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col justify-end md:items-center md:justify-center md:p-6"
      dir="rtl"
    >
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="مشغل التلاوة"
        tabIndex={-1}
        style={dragOffset ? { transform: `translateY(${dragOffset}px)` } : undefined}
        className="relative flex max-h-[88vh] w-full flex-col rounded-t-3xl bg-white outline-none animate-slide-up md:max-w-lg md:rounded-3xl md:border md:shadow-2xl dark:bg-primary-900"
      >
        <div
          className="flex touch-none justify-center pt-3 pb-1"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="h-1.5 w-12 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div className="flex items-start gap-3 px-5 pt-2 pb-4">
          <img src={ARTWORK} alt="" className="h-16 w-16 shrink-0 rounded-2xl shadow-sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-primary-800 dark:text-primary-100">
              {state.surahName ? `سورة ${state.surahName}` : 'تلاوة قرآنية'}
            </p>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{reciterName}</p>
            <p aria-live="polite" className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              {state.error
                ? state.error
                : state.sourceLoading
                  ? 'جار تجهيز التلاوة…'
                  : state.isPlaying
                    ? state.activeAyah
                      ? `تُتلى الآن — الآية ${toArabicDigits(state.activeAyah)}`
                      : 'تُتلى الآن'
                    : 'متوقف مؤقتاً'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق المشغل"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-gray-300"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-1 px-5">
          <input
            type="range"
            min={0}
            max={durationMs}
            step={500}
            value={Math.round(shownMs)}
            onChange={(event) => setScrubMs(Number(event.target.value))}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label="موضع التلاوة داخل السورة"
            aria-valuetext={`${formatClock(shownMs)} من ${formatClock(progress.durationMs)}`}
            className="h-11 w-full accent-primary-600 dark:accent-gold-400"
          />
          <div className="flex items-center justify-between text-[0.6875rem] tabular-nums text-gray-500 dark:text-gray-400">
            <span>{formatClock(shownMs)}</span>
            <span>{formatClock(progress.durationMs)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-3 px-5 py-4">
          <button
            type="button"
            onClick={() => void playPreviousSurah()}
            aria-label={previousHint}
            title={previousHint}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
          >
            <SkipBack size={20} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => void toggleSurah()}
            disabled={state.sourceLoading}
            aria-label={state.isPlaying ? 'إيقاف مؤقت' : 'متابعة التلاوة'}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-white shadow-md transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          >
            {state.sourceLoading ? (
              <Loader2 size={26} className="animate-spin" aria-hidden="true" />
            ) : state.isPlaying ? (
              <Pause size={26} aria-hidden="true" />
            ) : (
              <Play size={26} className="ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void playNextSurah()}
            disabled={!nextAvailable}
            aria-label="السورة التالية"
            title={nextAvailable ? 'السورة التالية' : 'هذه آخر سورة في المصحف'}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
          >
            <SkipForward size={20} className="scale-x-[-1]" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 pb-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">سرعة التلاوة</p>
            <div className="flex flex-wrap gap-1.5">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updatePlaybackRate(option.value)}
                  aria-pressed={state.playbackRate === option.value}
                  className={`min-h-10 rounded-xl px-3 text-xs font-semibold transition-colors ${
                    state.playbackRate === option.value
                      ? 'bg-gold-500 text-gray-950'
                      : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Only meaningful for a single ayah — see «استمع للآية» in the reader — but
              keeping it here means the setting is reachable without leaving the player. */}
          {!state.wholeFile && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                تكرار الآية عند الاستماع لها
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REPEAT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateRepeatCount(option.value)}
                    aria-pressed={state.repeatCount === option.value}
                    className={`min-h-10 rounded-xl px-3 text-xs font-semibold transition-colors ${
                      state.repeatCount === option.value
                        ? 'bg-gold-500 text-gray-950'
                        : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-primary-100 px-5 py-3 md:rounded-b-3xl dark:border-primary-800">
          <button
            type="button"
            onClick={stop}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Square size={16} aria-hidden="true" />
            إيقاف التلاوة
          </button>
        </div>
      </div>
    </div>
  );
}
