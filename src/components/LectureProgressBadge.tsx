import { useSyncExternalStore } from 'react';
import { CheckCircle2, CircleDashed, Clock3, Headphones, Loader2 } from 'lucide-react';
import { toArabicDigits } from '@/data/surahs';
import { formatDurationWords } from '@/utils/formatClock';
import {
  lectureInsight,
  lectureProgressRevision,
  subscribeLectureProgress,
  type LectureInsight,
  type LectureStatus,
} from '@/utils/lectureProgress';

/**
 * كيف يرى المستمع موضعه في محاضرة واحدة، داخل القائمة نفسها.
 *
 * The catalogue is the only place a listener actually browses six hundred lessons, so the
 * record of what has been heard belongs there rather than one screen away: a lesson that
 * was left half-heard should say so on its own row. This is that mark — a status chip, a
 * hairline progress bar, and the remaining time — drawn identically wherever a lecture
 * appears, so the same lesson never reads two different ways.
 *
 * It reads one lecture's record and nothing else. The catalogue passes only what it
 * already knows (the id and the duration), and every description — «تمّ», «أوشك», the
 * percentage — is derived from the same store the player writes, so the row and the
 * dashboard above it can never disagree.
 */

const STATUS_STYLE: Record<
  LectureStatus,
  { label: string; icon: typeof CheckCircle2; chip: string; bar: string }
> = {
  done: {
    label: 'تمّ',
    icon: CheckCircle2,
    chip: 'bg-success-100 text-success-700 dark:bg-success-900/50 dark:text-success-300',
    bar: 'from-success-400 to-success-600',
  },
  almost: {
    label: 'أوشك',
    icon: Clock3,
    chip: 'bg-warning-100 text-warning-700 dark:bg-warning-900/50 dark:text-warning-300',
    bar: 'from-warning-400 to-warning-600',
  },
  'in-progress': {
    label: 'جارٍ',
    icon: Loader2,
    chip: 'bg-primary-100 text-primary-700 dark:bg-primary-800/60 dark:text-primary-200',
    bar: 'from-primary-500 to-gold-400',
  },
  new: {
    label: 'جديدة',
    icon: CircleDashed,
    chip: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    bar: 'from-gray-300 to-gray-400',
  },
};

interface LectureProgressBadgeProps {
  insight: LectureInsight;
  /** `compact` is the inline mark a catalogue row carries; `full` adds the heard time. */
  variant?: 'compact' | 'full';
}

/** The mark for a lecture already reduced to an insight. */
export function LectureProgressBadge({ insight, variant = 'compact' }: LectureProgressBadgeProps) {
  const style = STATUS_STYLE[insight.status];
  const Icon = style.icon;
  const percent = Math.round(insight.fraction * 100);
  const showBar = insight.status === 'in-progress' || insight.status === 'almost';

  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem]">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${style.chip}`}
        >
          <Icon
            size={10}
            aria-hidden="true"
            className={insight.status === 'in-progress' ? 'animate-spin [animation-duration:2.5s]' : ''}
          />
          {style.label}
        </span>
        {insight.touched && <span className="tabular-nums text-gray-500 dark:text-gray-400">{toArabicDigits(percent)}٪</span>}
        {variant === 'full' && insight.heardSeconds > 0 && (
          <span className="inline-flex items-center gap-1 text-gray-500 dark:text-gray-400">
            <Headphones size={10} aria-hidden="true" />
            {formatDurationWords(insight.heardSeconds)}
          </span>
        )}
        {insight.remainingSeconds > 0 && (
          <span className="text-gray-500 dark:text-gray-400">باقي {formatDurationWords(insight.remainingSeconds)}</span>
        )}
      </div>
      {showBar && (
        <div className="h-1 w-full max-w-[10rem] overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900/60">
          <div
            className={`h-full rounded-full bg-linear-to-l ${style.bar} transition-all duration-500`}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

interface LectureProgressMarkProps {
  /** Lecture id, as it is keyed in the progress store. */
  id: string;
  /** Duration in milliseconds — `0` when the source never published one. */
  durationMs: number;
  variant?: 'compact' | 'full';
}

/**
 * The same mark, reading the record itself.
 *
 * A thin wrapper so a caller that has not already computed an insight — a row in the
 * middle of a long list, say — does not have to know the store's shape to draw one. It
 * subscribes to the progress store on its own, so a row redraws the moment the player
 * records a tick, without the catalogue above it having to thread a revision down.
 */
export function LectureProgressMark({ id, durationMs, variant = 'compact' }: LectureProgressMarkProps) {
  useSyncExternalStore(subscribeLectureProgress, lectureProgressRevision);
  const insight = lectureInsight(id, durationMs);
  if (!insight.touched) return null;
  return <LectureProgressBadge insight={insight} variant={variant} />;
}
