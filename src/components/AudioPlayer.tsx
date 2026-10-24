import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Loader2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Square, X } from 'lucide-react';
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
import { useLecturePlayer, useLectureProgress } from '@/hooks/useLecturePlayer';
import { hasAudioFocus } from '@/utils/audioFocus';
import {
  canPlayNextSurah,
  canPlayPreviousSurah,
  playNextSurah,
  playPreviousSurah,
  seekTo,
  stop as stopRecitation,
  toggleSurah,
  updatePlaybackRate,
  updateRepeatCount,
} from '@/utils/recitationEngine';
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
import { setRecitationSheetOpen } from '@/utils/recitationPlayerUi';

/**
 * The one player.
 *
 * The Qur'an and the lectures are two engines, and have to be: ayah timings, repeat and
 * a track queue are not the same job as a fifty-minute recording, and folding them into
 * one module would only mean a state machine that answers questions neither engine asks.
 * But they are one *thing to listen to*, and a listener should never meet two different
 * faces for the same act — play, pause, drag the needle, change the speed. This is that
 * one face: the same bar above the tab bar on every screen, the same sheet behind it,
 * for either engine.
 *
 * Nothing here knows how either engine works. {@link usePlayerSource} is the single
 * place that translates, and it hands over plain values and thunks only. Which of the
 * two is on screen follows {@link hasAudioFocus} — the same arbitration that stops the
 * two of them ever sounding at once — and the media-session card in the notification
 * bar was shared between them from the start, so the lock screen already reads this as
 * one player too.
 */

const ARTWORK = '/icons/icon-512.png';

/**
 * One speed ladder for both, even though each engine keeps its own history here:
 * `audio.playbackRate` takes any of these, so a listener who has learned where 1.75×
 * sits finds it in the same place whichever of the two they are holding.
 */
const SPEED_OPTIONS = [
  { value: 0.75, label: '٠٫٧٥×' },
  { value: 1, label: '١×' },
  { value: 1.25, label: '١٫٢٥×' },
  { value: 1.5, label: '١٫٥×' },
  { value: 1.75, label: '١٫٧٥×' },
  { value: 2, label: '٢×' },
];

const REPEAT_OPTIONS = [
  { value: 1, label: 'مرة' },
  { value: 3, label: '٣ مرات' },
  { value: 5, label: '٥ مرات' },
  { value: 10, label: '١٠ مرات' },
  { value: 0, label: 'مستمر' },
];

/** How far «١٥» on either side of the play button throws the needle. */
const SKIP_MS = 15_000;

// Module-level so a dismissal survives the bar unmounting — and so it can be forgotten
// when the thing being played changes, which is what stops hiding the recitation from
// hiding the lecture that takes the floor after it.
let barDismissed = false;

/**
 * One engine, described in the terms the player draws.
 *
 * Every field is a value or a thunk: the player reads them, the adapter closes over the
 * engine. Nothing here reaches back into either engine, so a third source — a radio
 * stream, a downloaded talk — would be added by writing another adapter and no markup.
 */
interface PlayerSource {
  /** Identifies what is playing; changing it brings a dismissed bar back. */
  key: string;
  /** What the sheet calls itself to assistive tech. */
  sheetLabel: string;
  title: string;
  /** Who or what collection this is — the reciter, or the lecture's series. */
  subtitle: string;
  /**
   * The present tense of the sound, ending in whatever noun belongs to it: a surah is
   * «تُتلى», a lecture is «يُشتغل». The player appends the clock to it, so both read
   * the same way on screen while still naming the right thing.
   */
  nowLabel: string;
  positionMs: number;
  durationMs: number;
  loading: boolean;
  error: string | null;
  isPlaying: boolean;
  rate: number;
  /** Under the progress line, and in `aria-label`. */
  progressLabel: string;
  /** On the bar's title button. */
  openLabel: string;
  previousHint: string;
  nextHint: string;
  /** Whether the previous button does anything but restart. */
  canGoPrevious: boolean;
  canGoNext: boolean;
  stopLabel: string;
  repeat: {
    options: readonly { value: number; label: string }[];
    value: number;
    set: (count: number) => void;
  } | null;
  toggle: () => void;
  previous: () => void;
  next: () => void;
  stop: () => void;
  seek: (positionMs: number) => void;
  setRate: (rate: number) => void;
}

function reciterNameOf(reciterId: string | null): string {
  return AUDIO_RECITERS.find((item) => item.id === reciterId)?.name ?? 'قارئ';
}

/**
 * Which engine is on the floor, and how to speak it.
 *
 * Every hook below runs on every render — the choice between the engines is a value,
 * not a branch, which is what keeps this inside the rules for hooks while the engines
 * themselves stay unaware of each other.
 *
 * The rule for *which* one owns the screen is "whichever last held the floor, unless it
 * has since released it". A lecture that was silenced by a recitation does not come back
 * on screen merely because its item is still loaded, and a recitation that has been
 * stopped does not hold the lecture's bar hostage.
 */
function usePlayerSource(): PlayerSource | null {
  const recitationVisible = useRecitationVisible();
  const recitation = useRecitation();
  const recitationProgress = useRecitationProgress();
  const lecture = useLecturePlayer();
  const lectureProgress = useLectureProgress();

  const recitationOwns =
    recitationVisible && !hasAudioFocus('lecture');
  const active = recitationOwns ? 'recitation' : lecture.current ? 'lecture' : recitationVisible ? 'recitation' : null;

  if (active === 'lecture' && lecture.current) {
    const { lecture: item, album } = lecture.current;
    return {
      key: `lecture:${item.id}`,
      sheetLabel: 'مشغل المحاضرة',
      title: item.title,
      subtitle: album ?? 'الشيخ أبو إسحاق الحويني',
      nowLabel: 'يُشتغل الآن',
      positionMs: lectureProgress.positionMs,
      // The catalogue's own figure until metadata has loaded — a bar that draws a zero
      // length for a lecture it is already playing is worse than one that is a little
      // early.
      durationMs: Math.max(1, Math.round(lectureProgress.durationMs || item.seconds * 1000)),
      loading: lecture.loading,
      error: lecture.error,
      isPlaying: lecture.isPlaying,
      rate: lecture.rate,
      progressLabel: 'موضع المحاضرة',
      openLabel: 'فتح مشغل المحاضرة',
      // With nothing before it, «السابقة» on a queue means *this* one again — which is
      // exactly what it means on a surah at الفاتحة, so both engines say so in the same
      // words and both buttons stay live.
      previousHint: canPlayPrevious() ? 'المحاضرة السابقة' : 'إعادة المحاضرة من أولها',
      nextHint: canPlayNext() ? 'المحاضرة التالية' : 'هذه آخر محاضرة في القائمة',
      canGoPrevious: true,
      canGoNext: canPlayNext(),
      stopLabel: 'إلغاء المحاضرة',
      repeat: null,
      toggle: () => togglePlay(),
      previous: () => {
        if (canPlayPrevious()) void playPrevious();
        else seekLecture(0);
      },
      next: () => void playNext(),
      stop: () => stopLecture(),
      seek: (positionMs) => seekLecture(positionMs),
      setRate: (rate) => setLectureRate(rate),
    };
  }

  if (active === 'recitation') {
    return {
      key: `recitation:${recitation.surahId ?? 0}`,
      sheetLabel: 'مشغل التلاوة',
      title: recitation.surahName ? `سورة ${recitation.surahName}` : 'تلاوة قرآنية',
      subtitle: reciterNameOf(recitation.reciterId),
      nowLabel: recitation.activeAyah
        ? `تُتلى الآن — الآية ${toArabicDigits(recitation.activeAyah)}`
        : 'تُتلى الآن',
      positionMs: recitationProgress.positionMs,
      durationMs: Math.max(1, Math.round(recitationProgress.durationMs)),
      loading: recitation.sourceLoading,
      error: recitation.error,
      isPlaying: recitation.isPlaying,
      rate: recitation.playbackRate,
      progressLabel: 'موضع التلاوة',
      openLabel: `فتح مشغل التلاوة — سورة ${recitation.surahName ?? ''}`,
      previousHint: canPlayPreviousSurah() ? 'السورة السابقة' : 'إعادة السورة من أولها',
      nextHint: canPlayNextSurah() ? 'السورة التالية' : 'هذه آخر سورة في المصحف',
      canGoPrevious: true,
      canGoNext: canPlayNextSurah(),
      stopLabel: 'إيقاف التلاوة',
      // Repetition only means anything against a verse with timings behind it: on a
      // recording that runs as one file there is no boundary to return to.
      repeat: recitation.wholeFile
        ? null
        : {
            options: REPEAT_OPTIONS,
            value: recitation.repeatCount,
            set: (count) => updateRepeatCount(count),
          },
      toggle: () => void toggleSurah(),
      previous: () => void playPreviousSurah(),
      next: () => void playNextSurah(),
      stop: () => stopRecitation(),
      seek: (positionMs) => seekTo(positionMs),
      setRate: (rate) => updatePlaybackRate(rate),
    };
  }

  return null;
}

/** The line under the title, for both engines: what is happening, and where. */
function statusLineOf(source: PlayerSource, shownMs: number): string {
  if (source.error) return source.error;
  if (source.loading) return 'جار التجهيز…';
  return `${source.isPlaying ? source.nowLabel : 'متوقف مؤقتاً'} · ${formatClock(shownMs)}`;
}

/**
 * Mounted once, beside the tab bar. Renders nothing at all until something has actually
 * been started, so a reader who only reads is never given a player bar to ignore.
 */
export function AudioPlayer() {
  const source = usePlayerSource();
  const sheetOpen = useRecitationSheetOpen();
  const [, bump] = useState(0);

  const sourceKey = source?.key ?? null;
  useEffect(() => {
    if (sourceKey === null) return;
    // Whatever was dismissed belonged to the thing that came before.
    barDismissed = false;
    bump((n) => n + 1);
  }, [sourceKey]);

  if (!source) return null;
  // Dismissing hides the bar, not the sound: the sheet is still one notification away,
  // and the transport comes back the moment something else starts.
  if (barDismissed && !sheetOpen) return null;

  return (
    <>
      {/* The bar steps aside while the sheet is up: the sheet *is* the player, and two
          sets of transport controls on one screen invite mis-taps. */}
      {!sheetOpen && (
        <PlayerMiniBar
          source={source}
          onDismiss={() => {
            barDismissed = true;
            bump((n) => n + 1);
          }}
        />
      )}
      {sheetOpen && <PlayerSheet source={source} onClose={() => setRecitationSheetOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/**
 * Reads a pointer's place along the progress line as a place in the recording.
 *
 * The bar reads right to left and so does the line above it: the fill grows from the
 * right edge, so the right edge is the beginning and the left edge the end. Measured on
 * the running bar rather than assumed — a 39% fill sat flush against the right edge of a
 * track running from x=746 to x=484.
 *
 * `onlyWhilePressed` is what separates a drag from a tap: moves only seek while a finger
 * or button is down, and they are throttled because each seek on a stream is a range
 * request that aborts the last. The release always seeks exactly, so nothing the
 * throttle drops is ever lost.
 */
function seekFromLine(
  event: ReactPointerEvent<HTMLDivElement>,
  durationMs: number,
  seek: (positionMs: number) => void,
  throttleRef: { current: number },
  onlyWhilePressed = false,
): void {
  if (onlyWhilePressed && event.buttons === 0) return;
  const box = event.currentTarget.getBoundingClientRect();
  if (box.width <= 0) return;
  const ratio = Math.min(1, Math.max(0, (box.right - event.clientX) / box.width));
  const target = Math.round(ratio * durationMs);
  if (onlyWhilePressed) {
    const now = Date.now();
    if (now - throttleRef.current < 120) return;
    throttleRef.current = now;
  }
  seek(target);
}

function PlayerMiniBar({ source, onDismiss }: { source: PlayerSource; onDismiss: () => void }) {
  const durationMs = source.durationMs;
  const percent = Math.min(100, Math.max(0, (source.positionMs / durationMs) * 100));
  /** When the line last sought — see {@link seekFromLine}. */
  const lineSeekAt = useRef(0);
  const seek = source.seek;

  return (
    <div
      className="fixed z-40 left-1/2 w-[calc(100%-1.5rem)] max-w-lg -translate-x-1/2 bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] md:bottom-6 md:left-[calc(50%-2.625rem)] md:w-[calc(100%-9rem)] md:max-w-2xl lg:left-[calc(50%-3rem)] xl:left-[calc(50%-4rem)]"
      dir="rtl"
    >
      <div className="relative overflow-hidden rounded-2xl border border-primary-200/80 bg-panel/95 shadow-[0_12px_36px_-12px_var(--brand-glow,rgba(31,115,78,0.28))] backdrop-blur-xl dark:border-primary-800/80 dark:bg-raised/95">
        {/* The progress hairline, and the only place on the bar to scrub: enough to see
            how far the thing has come, and a tap anywhere along it moves the needle. */}
        <div
          className="absolute inset-x-0 top-0 h-0.5 bg-primary-100 dark:bg-primary-800"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label={source.progressLabel}
          onPointerDown={(event) => {
            // A painted line two pixels tall is not something a thumb can land on, so the
            // hit area lives in the invisible strip below it and its events bubble up to
            // here. Capture keeps the drag coming back to the line even once the finger
            // has wandered off it — the alternative is a scrub that stops half way.
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // A platform that refuses the capture still seeks on pointerdown.
            }
            seekFromLine(event, durationMs, seek, lineSeekAt);
          }}
          onPointerMove={(event) => seekFromLine(event, durationMs, seek, lineSeekAt, true)}
          onPointerUp={(event) => seekFromLine(event, durationMs, seek, lineSeekAt)}
        >
          <div
            className="h-full bg-primary-500 transition-[width] duration-200 dark:bg-gold-400"
            style={{ width: `${percent}%` }}
          />
          {/* The part you can actually touch. It reaches down through the card's top
              padding — it stops where the row's own button ink begins, so the artwork
              keeps every pixel it draws. Positioned siblings paint above the plain block
              below, so this strip wins the overlap rather than losing it. */}
          <div className="absolute inset-x-0 top-0 h-3 touch-none" />
        </div>

        <div className="flex items-center gap-1 p-1.5">
          <button
            type="button"
            onClick={() => setRecitationSheetOpen(true)}
            aria-label={source.openLabel}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-1.5 text-right transition-colors hover:bg-primary-50/80 dark:hover:bg-primary-800/50"
          >
            <img src={ARTWORK} alt="" className="h-9 w-9 shrink-0 rounded-lg" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-primary-800 dark:text-primary-100">
                {source.title}
              </span>
              <span className="block truncate text-[0.6875rem] text-gray-500 dark:text-gray-400">
                {statusLineOf(source, source.positionMs)}
              </span>
            </span>
          </button>

          {/* The dismiss control. «إيقاف» on a bar that is already paused reads as a
              transport command; the letter of the request is «إخفاء» — put it away — so
              it is drawn as an ✕ and says so. Stopping lives in the sheet, where it is
              the same button for either engine. */}
          <button
            type="button"
            onClick={onDismiss}
            aria-label="إخفاء المشغل"
            title="إخفاء"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-primary-800"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={source.previous}
            aria-label={source.previousHint}
            title={source.previousHint}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipBack size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={source.toggle}
            disabled={source.loading}
            aria-label={source.isPlaying ? 'إيقاف مؤقت' : source.title}
            title={source.isPlaying ? 'إيقاف مؤقت' : 'متابعة'}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          >
            {source.loading ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : source.isPlaying ? (
              <Pause size={18} aria-hidden="true" />
            ) : (
              <Play size={18} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={source.next}
            disabled={!source.canGoNext}
            aria-label={source.nextHint}
            title={source.nextHint}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <SkipForward size={18} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={source.stop}
            aria-label={source.stopLabel}
            title={source.stopLabel}
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
// The sheet
// ---------------------------------------------------------------------------

function PlayerSheet({ source, onClose }: { source: PlayerSource; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Mounted only while open: back, Escape and Tab all stay inside the sheet instead
  // of reaching the screen underneath it.
  useDialogBehavior(true, onClose, panelRef);

  /**
   * The scrubber follows the finger, not the audio, while it is being dragged — a needle
   * that fights back under the thumb is unusable. The engine is only told where the
   * listener landed, on release.
   *
   * The release reads a ref rather than the state beside it. A tap fires `input` and
   * `pointerup` a few milliseconds apart, and nothing promises React will have drawn
   * from the first by the time the second runs — reading the state there could then see
   * `null`, do nothing, and leave the thumb and the clock resting on a moment the
   * recording was never sent to: the clock counts, the audio never moves. The ref is
   * written inside the very event that produced the value, so the commit always reads
   * the right number whatever React has had a chance to draw.
   */
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);
  const shownMs = scrubMs ?? source.positionMs;
  const durationMs = source.durationMs;
  // Held in a local: narrowing a property does not survive into the callbacks below,
  // and the row must be able to read `value` and `set` from a source it knows is there.
  const repeat = source.repeat;

  const commitScrub = () => {
    const target = scrubRef.current;
    if (target === null) return;
    scrubRef.current = null;
    source.seek(target);
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
        aria-label={source.sheetLabel}
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
              {source.title}
            </p>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{source.subtitle}</p>
            <p aria-live="polite" className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
              {statusLineOf(source, shownMs)}
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
            onChange={(event) => {
              const next = Number(event.target.value);
              scrubRef.current = next;
              setScrubMs(next);
            }}
            onPointerDown={(event) => {
              // Hold the pointer so the release always comes back to this slider. A
              // finger that lifts a few pixels past the edge would otherwise carry the
              // commit away with it — the thumb moves, the clock follows, the recording
              // stays put.
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // A platform that refuses the capture still commits on pointerup.
              }
            }}
            onPointerUp={commitScrub}
            onPointerCancel={commitScrub}
            onKeyUp={commitScrub}
            onBlur={commitScrub}
            aria-label={source.progressLabel}
            aria-valuetext={`${formatClock(shownMs)} من ${formatClock(durationMs)}`}
            // `touch-none` keeps the page from claiming the gesture as a scroll. That
            // claim is what ends a scrub as a `pointercancel` before the slider has seen
            // a single step of it: the thumb twitches and the audio never hears about it.
            className="h-11 w-full touch-none accent-primary-600 dark:accent-gold-400"
          />
          <div className="flex items-center justify-between text-[0.6875rem] tabular-nums text-gray-500 dark:text-gray-400">
            <span>{formatClock(shownMs)}</span>
            <span>{formatClock(durationMs)}</span>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2.5 px-5 py-4">
          <button
            type="button"
            onClick={source.previous}
            aria-label={source.previousHint}
            title={source.previousHint}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
          >
            <SkipBack size={20} className="scale-x-[-1]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => source.seek(Math.max(0, source.positionMs - SKIP_MS))}
            aria-label="رجوع ١٥ ثانية"
            title="رجوع ١٥ ثانية"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <RotateCcw size={19} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={source.toggle}
            disabled={source.loading}
            aria-label={source.isPlaying ? 'إيقاف مؤقت' : 'متابعة'}
            className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-600 text-white shadow-md transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60"
          >
            {source.loading ? (
              <Loader2 size={26} className="animate-spin" aria-hidden="true" />
            ) : source.isPlaying ? (
              <Pause size={26} aria-hidden="true" />
            ) : (
              <Play size={26} className="ml-0.5" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={() => source.seek(Math.min(durationMs, source.positionMs + SKIP_MS))}
            aria-label="تقدّم ١٥ ثانية"
            title="تقدّم ١٥ ثانية"
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            <RotateCw size={19} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={source.next}
            disabled={!source.canGoNext}
            aria-label={source.nextHint}
            title={source.nextHint}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-35 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
          >
            <SkipForward size={20} className="scale-x-[-1]" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-5 pb-4">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">السرعة</p>
            <div className="flex flex-wrap gap-1.5">
              {SPEED_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => source.setRate(option.value)}
                  aria-pressed={source.rate === option.value}
                  className={`min-h-10 rounded-xl px-3 text-xs font-semibold transition-colors ${
                    source.rate === option.value
                      ? 'bg-gold-500 text-gray-950'
                      : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Only offered by a source that has verse boundaries to return to — see
              «استمع للآية» in the reader. The row is part of the same sheet either way,
              so the player never changes shape; only an option with nothing behind it is
              left out. */}
          {repeat && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                تكرار الآية عند الاستماع لها
              </p>
              <div className="flex flex-wrap gap-1.5">
                {repeat.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => repeat.set(option.value)}
                    aria-pressed={repeat.value === option.value}
                    className={`min-h-10 rounded-xl px-3 text-xs font-semibold transition-colors ${
                      repeat.value === option.value
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
            onClick={source.stop}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-100 text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <Square size={16} aria-hidden="true" />
            {source.stopLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
