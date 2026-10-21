import { useMemo } from 'react';
import {
  Award,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  Clock,
  Flame,
  GraduationCap,
  Headphones,
  Library,
  ListMusic,
  Play,
  RotateCcw,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Card, SectionHeader } from '@/components/ui';
import { toArabicDigits, toArabicNumber } from '@/data/surahs';
import {
  HUWAINI_COURSES,
  HUWAINI_LECTURES,
  HUWAINI_LIBRARY_ITEM,
  HUWAINI_SERIES,
  huwayniLectureById,
  type HuwainiLecture,
} from '@/data/scholarHuwaini';
import { useLectureProgressStats } from '@/hooks/useLecturePlayer';
import { formatDurationWords } from '@/utils/formatClock';
import {
  clearLectureProgress,
  collectionProgress,
  lectureStatus,
  listeningJournal,
  mostListened,
  type LectureRecord,
  type LectureStatus,
} from '@/utils/lectureProgress';
import { playLecture, type LectureQueueItem } from '@/utils/lecturePlayer';

/**
 * متابعة التقدم — where the listener stands in the الشيخ's library.
 *
 * The page above it is a catalogue; this is the answer to the only question that matters
 * once somebody has started listening: *how far have I got?* So it is built around the
 * three things a that question actually means — how much has been heard (in real hours,
 * not percentages), which collection is mid-flight and what comes next in it, and the
 * streak of days on which anything was heard at all.
 *
 * It reads one store — the record the player writes as it plays — and derives everything
 * else from it, so there is no second source of truth that could disagree with the player
 * about what has been listened to.
 */

// ---------------------------------------------------------------------------
// Status as the eye sees it
// ---------------------------------------------------------------------------

const STATUS_META: Record<LectureStatus, { label: string; className: string }> = {
  new: { label: 'لم يبدأ', className: 'text-gray-500 dark:text-gray-400' },
  'in-progress': { label: 'جارٍ', className: 'text-primary-700 dark:text-gold-300' },
  almost: { label: 'أوشك', className: 'text-warning-600 dark:text-warning-400' },
  done: { label: 'تمّ', className: 'text-success-600 dark:text-success-400' },
};

/** A thin progress bar, in the page's own colours, with the label left to the caller. */
function ProgressBar({ fraction, tone = 'primary' }: { fraction: number; tone?: 'primary' | 'gold' | 'success' }) {
  const fill =
    tone === 'success'
      ? 'from-success-400 to-success-600'
      : tone === 'gold'
        ? 'from-gold-400 to-gold-600'
        : 'from-primary-500 to-gold-400';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900/60">
      <div
        className={`h-full rounded-full bg-linear-to-l ${fill} transition-all duration-500`}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One collection's progress
// ---------------------------------------------------------------------------

interface CollectionProgressCardProps {
  title: string;
  icon: LucideIcon;
  lectures: HuwainiLecture[];
  item: string;
  album: string;
  kbps?: number;
}

/**
 * A course or series, measured against how much of it has been heard.
 *
 * The «أكمل» button is the whole point: it resumes at the first lesson that is not done,
 * so working through a fifteen-part dورة is a matter of tapping one button each time
 * rather than remembering where the gap is.
 */
function CollectionProgressCard({ title, icon: Icon, lectures, item, album, kbps }: CollectionProgressCardProps) {
  const progress = useMemo(() => collectionProgress(lectures), [lectures]);
  const queue = useMemo<LectureQueueItem[]>(
    () => lectures.map((lecture) => ({ lecture, item, album })),
    [lectures, item, album],
  );
  const resumeAt = progress.nextId ? lectures.findIndex((lecture) => lecture.id === progress.nextId) : -1;
  const resumeLecture = resumeAt >= 0 ? lectures[resumeAt] : lectures[0];

  const finishedSeconds = useMemo(
    () => progress.listenedSeconds,
    [progress.listenedSeconds],
  );

  return (
    <li className="rounded-2xl border border-primary-100/80 bg-white/70 p-3.5 dark:border-primary-800/60 dark:bg-primary-950/40">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm ${
            progress.complete
              ? 'bg-gradient-to-br from-success-500 to-success-700'
              : 'bg-gradient-to-br from-primary-600 to-primary-800'
          }`}
        >
          {progress.complete ? <CheckCircle2 size={19} aria-hidden="true" /> : <Icon size={19} aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-sm font-bold text-primary-900 dark:text-primary-50">{title}</h3>
            <span className="shrink-0 text-xs font-bold tabular-nums text-primary-700 dark:text-gold-300">
              {toArabicDigits(Math.round(progress.fraction * 100))}٪
            </span>
          </div>

          <div className="mt-2">
            <ProgressBar fraction={progress.fraction} tone={progress.complete ? 'success' : 'primary'} />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-gray-500 dark:text-gray-400">
            <span className="inline-flex items-center gap-1">
              <BookOpenCheck size={11} aria-hidden="true" />
              {toArabicDigits(progress.finished)} من {toArabicDigits(progress.total)} درسًا
            </span>
            {finishedSeconds > 0 && (
              <span className="inline-flex items-center gap-1">
                <Headphones size={11} aria-hidden="true" />
                استمعت {formatDurationWords(finishedSeconds)}
              </span>
            )}
            {kbps !== undefined && progress.complete && <Badge variant="success">مكتملة</Badge>}
          </div>

          <div className="mt-2.5">
            {progress.complete ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-success-100 px-3 py-1.5 text-xs font-semibold text-success-700 dark:bg-success-900/40 dark:text-success-300">
                <CheckCircle2 size={13} aria-hidden="true" />
                أتممت هذه المجموعة
              </span>
            ) : (
              <button
                type="button"
                onClick={() => playLecture(resumeLecture, item, queue, album)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <Play size={13} aria-hidden="true" />
                {progress.finished > 0 || progress.started > 0 ? 'أكمل الاستماع' : 'ابدأ الآن'}
                {progress.nextId && (
                  <span className="font-normal text-white/80">
                    · الدرس {toArabicDigits(resumeAt + 1)}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* What actually comes next, named — the whole point of standing progress is that
              resuming is a single tap on the right lesson, not a scroll to find the gap. */}
          {!progress.complete && resumeLecture && (
            <p className="mt-2 truncate text-[0.6875rem] text-gray-500 dark:text-gray-400" title={resumeLecture.title}>
              التالي: <span className="font-medium text-primary-700 dark:text-gold-300">{resumeLecture.title}</span>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Continue listening
// ---------------------------------------------------------------------------

/**
 * The last few lessons touched but not finished, newest first.
 *
 * Reconstructed from the progress records and the catalogue index, so it reflects what the
 * listener actually played rather than what the app thinks they should play. Each entry
 * carries the collection it came from, so resuming also queues what follows it.
 */
function useContinueListening(records: Record<string, LectureRecord>) {
  return useMemo(() => {
    return Object.entries(records)
      .map(([id, record]) => ({ record, ref: huwayniLectureById(id) }))
      .filter(
        (entry): entry is { record: LectureRecord; ref: NonNullable<ReturnType<typeof huwayniLectureById>> } =>
          entry.ref !== null &&
          !entry.record.completed &&
          (entry.record.furthest > 0 || entry.record.listened > 0),
      )
      .sort((a, b) => b.record.updatedAt - a.record.updatedAt)
      .slice(0, 4)
      .map((entry) => ({ ...entry, collection: collectionOf(entry.ref.lecture.id) }));
  }, [records]);
}

/** The course or series a lecture belongs to, with what to queue alongside it. */
function collectionOf(id: string): { item: string; album: string; lectures: HuwainiLecture[] } | null {
  for (const course of HUWAINI_COURSES) {
    if (course.lectures.some((lecture) => lecture.id === id)) {
      return { item: course.item, album: course.title, lectures: course.lectures };
    }
  }
  for (const series of HUWAINI_SERIES) {
    if (series.lectures.some((lecture) => lecture.id === id)) {
      return { item: HUWAINI_LIBRARY_ITEM, album: series.title, lectures: series.lectures };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The weekly journal
// ---------------------------------------------------------------------------

/**
 * The last week of listening, as bars.
 *
 * A single total — «٣ ساعات» — says how much was heard; it does not say *when*, and for a
 * habit that is the figure that matters. Seven bars, tallest in the middle of the scale,
 * give the shape of the week at a glance: a gap is visible as a gap.
 */
function ListeningJournal() {
  const journal = useMemo(() => listeningJournal(7), []);
  const peak = Math.max(60, ...journal.map((day) => day.seconds));
  const weekSeconds = journal.reduce((sum, day) => sum + day.seconds, 0);
  const activeDays = journal.filter((day) => day.seconds > 0).length;
  const average = activeDays > 0 ? Math.round(weekSeconds / activeDays) : 0;

  return (
    <Card>
      <SectionHeader title="سجلّ الأسبوع" icon={<CalendarDays size={20} />} />
      <div className="flex items-end justify-between gap-1.5 pt-1" dir="rtl">
        {[...journal].reverse().map((day) => {
          const height = peak > 0 ? Math.max(4, Math.round((day.seconds / peak) * 100)) : 4;
          const active = day.seconds > 0;
          return (
            <div key={day.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className="flex h-20 w-full items-end overflow-hidden rounded-lg bg-primary-100/70 dark:bg-primary-900/50"
                title={active ? `${formatDurationWords(day.seconds)} · ${toArabicDigits(day.lectures)} درسًا` : 'لا استماع'}
              >
                <div
                  className={`w-full rounded-lg bg-linear-to-t transition-all duration-500 ${
                    active ? 'from-primary-600 to-gold-400' : 'from-gray-200 to-gray-300 dark:from-gray-700 dark:to-gray-700'
                  }`}
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="truncate text-[0.625rem] text-gray-500 dark:text-gray-400">
                {weekdayLabel(day.day)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-primary-100/70 pt-2.5 text-[0.6875rem] text-gray-500 dark:border-primary-800/60 dark:text-gray-400">
        <span className="inline-flex items-center gap-1">
          <Headphones size={11} aria-hidden="true" />
          هذا الأسبوع: <span className="font-semibold text-primary-700 dark:text-gold-300">{formatDurationWords(weekSeconds)}</span>
        </span>
        <span>في {toArabicDigits(activeDays)} من ٧ أيام</span>
        {average > 0 && <span>بمعدّل {formatDurationWords(average)} يوميًّا</span>}
      </div>
    </Card>
  );
}

const ARABIC_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** «الجمعة» for a `YYYY-MM-DD` key — the day a listener remembers, not a date. */
function weekdayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return ARABIC_WEEKDAYS[date.getDay()] ?? day;
}

// ---------------------------------------------------------------------------
// The lessons most returned to
// ---------------------------------------------------------------------------

/**
 * The handful of lessons with the most real seconds against them.
 *
 * «أكثر ما استمعت إليه» is the one figure that reflects taste rather than coverage: which
 * of the الشيخ's recordings this listener actually returns to. It is drawn from the same
 * records as everything else, and each entry plays from where it was left.
 */
function MostListened({ records }: { records: Record<string, LectureRecord> }) {
  const top = useMemo(
    () =>
      mostListened(5, records)
        .map((entry) => ({ ...entry, ref: huwayniLectureById(entry.id) }))
        .filter((entry): entry is typeof entry & { ref: NonNullable<ReturnType<typeof huwayniLectureById>> } => entry.ref !== null),
    [records],
  );
  if (top.length === 0) return null;
  const peak = Math.max(...top.map((entry) => entry.listenedSeconds));

  return (
    <Card>
      <SectionHeader title="أكثر ما استمعت إليه" icon={<TrendingUp size={20} />} />
      <ol className="space-y-2.5">
        {top.map((entry, index) => {
          const lecture = entry.ref.lecture;
          const collection = collectionOf(lecture.id);
          const album = collection?.album ?? 'محاضرات ودروس مفردة';
          const queue: LectureQueueItem[] =
            collection?.lectures.map((item) => ({ lecture: item, item: collection.item, album })) ?? [
              { lecture, item: entry.ref.item, album },
            ];
          return (
            <li key={lecture.id} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gold-100 text-[0.6875rem] font-bold text-gold-700 dark:bg-gold-900/40 dark:text-gold-300">
                {toArabicDigits(index + 1)}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => playLecture(lecture, collection?.item ?? entry.ref.item, queue, album)}
                  className="block w-full truncate text-start text-sm font-semibold text-primary-900 hover:text-primary-700 dark:text-primary-100 dark:hover:text-gold-300"
                  title={`استمع ${lecture.title}`}
                >
                  {lecture.title}
                </button>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary-100 dark:bg-primary-900/60">
                    <div
                      className="h-full rounded-full bg-linear-to-l from-primary-500 to-gold-400"
                      style={{ width: `${Math.round((entry.listenedSeconds / peak) * 100)}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-gray-500 dark:text-gray-400">
                    {formatDurationWords(entry.listenedSeconds)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => playLecture(lecture, collection?.item ?? entry.ref.item, queue, album)}
                aria-label={`استمع ${lecture.title}`}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 transition-colors hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
              >
                <Play size={14} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/**
 * The progress dashboard, rendered inside the página of the الشيخ.
 *
 * It shows itself only once something has been heard: a wall of zeroes over a library
 * nobody has opened is a worse welcome than a nudge to press play.
 */
export function HuwainiProgress() {
  const { stats, records } = useLectureProgressStats();
  const continued = useContinueListening(records);

  const totals = useMemo(() => {
    let totalLectures = 0;
    let totalSeconds = 0;
    for (const course of HUWAINI_COURSES) {
      totalLectures += course.lectures.length;
      totalSeconds += course.seconds;
    }
    for (const series of HUWAINI_SERIES) {
      totalLectures += series.lectures.length;
      totalSeconds += series.lectures.reduce((sum, lecture) => sum + lecture.seconds, 0);
    }
    // The standalone sermons are part of the library too — a listener's progress has to be
    // measured against everything the الشيخ left, not only the collections.
    totalLectures += HUWAINI_LECTURES.length;
    totalSeconds += HUWAINI_LECTURES.reduce((sum, lecture) => sum + lecture.seconds, 0);
    return { totalLectures, totalSeconds };
  }, []);

  const overallFraction = totals.totalLectures > 0 ? stats.finished / totals.totalLectures : 0;
  const listenShare = totals.totalSeconds > 0 ? stats.listenedSeconds / totals.totalSeconds : 0;

  // Nothing heard yet: the catalogue above is the invitation, and a dashboard of zeroes
  // adds nothing to it.
  if (stats.started === 0) return null;

  const coursesInProgress = HUWAINI_COURSES.map((course) => ({
    course,
    progress: collectionProgress(course.lectures, records),
  }))
    .filter((entry) => entry.progress.started > 0 || entry.progress.finished > 0)
    .sort((a, b) => {
      // Mid-flight first, and within that the one closest to done — the thing a listener
      // is most likely to want to finish.
      if (a.progress.complete !== b.progress.complete) return a.progress.complete ? 1 : -1;
      return b.progress.fraction - a.progress.fraction;
    });

  const seriesInProgress = HUWAINI_SERIES.map((series) => ({
    series,
    progress: collectionProgress(series.lectures, records),
  }))
    .filter((entry) => entry.progress.started > 0 || entry.progress.finished > 0)
    .sort((a, b) => b.progress.fraction - a.progress.fraction)
    .slice(0, 12);

  const heroStats = [
    {
      icon: Flame,
      value: toArabicNumber(stats.streakDays),
      unit: 'يوم',
      label: 'سلسلة الاستماع',
      accent: 'from-accent-500 to-accent-700',
    },
    {
      icon: Headphones,
      value: formatDurationWords(stats.listenedSeconds),
      unit: '',
      label: 'وقت الاستماع',
      accent: 'from-primary-600 to-primary-800',
    },
    {
      icon: BookOpenCheck,
      value: toArabicNumber(stats.finished),
      unit: 'درسًا',
      label: 'أتممت',
      accent: 'from-success-500 to-success-700',
    },
    {
      icon: Sparkles,
      value: toArabicNumber(stats.activeDays),
      unit: 'يومًا',
      label: 'أيام الاستماع',
      accent: 'from-gold-500 to-gold-700',
    },
  ];

  return (
    <section className="space-y-4" aria-labelledby="huwaini-progress-heading">
      <SectionHeading id="huwaini-progress-heading" icon={Award} title="متابعة تقدمي" subtitle="ما استمعت إليه حتى الآن" />

      {/* Hero figures. Four counters that read as one instrument panel rather than four
          generic cards: each is a filled gradient tile, a circular medallion holding the
          glyph, then the figure and its label. The fill carries its own accent per tile,
          so the row is legible at a glance without any tile needing a border to separate
          it from the page. */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {heroStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`huwaini-stat bg-linear-to-br ${stat.accent}`}
            >
              <span className="huwaini-stat__glow" aria-hidden="true" />
              <span className="huwaini-stat__icon">
                <Icon size={18} aria-hidden="true" />
              </span>
              <p className="huwaini-stat__value">
                {stat.value}{' '}
                {stat.unit && <span className="huwaini-stat__unit">{stat.unit}</span>}
              </p>
              <p className="huwaini-stat__label">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Overall progress across the whole library */}
      <Card className="border-gold-300/60 bg-linear-to-bl from-gold-50/60 via-white to-primary-50/30 dark:border-gold-800/40 dark:from-gold-950/20 dark:via-primary-950/40 dark:to-primary-900/40">
        <SectionHeader title="من المكتبة كلها" icon={<Library size={20} />} />
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">الدروس المكتملة</span>
              <span className="text-xs font-bold tabular-nums text-primary-700 dark:text-gold-300">
                {toArabicDigits(stats.finished)} / {toArabicDigits(totals.totalLectures)}
              </span>
            </div>
            <ProgressBar fraction={overallFraction} />
          </div>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">من إجمالي ساعات الشيخ</span>
              <span className="text-xs font-bold tabular-nums text-primary-700 dark:text-gold-300">
                {toArabicDigits(Math.round(listenShare * 100))}٪
              </span>
            </div>
            <ProgressBar fraction={listenShare} tone="gold" />
            <p className="mt-1.5 text-[0.6875rem] text-gray-500 dark:text-gray-400">
              استمعت {formatDurationWords(stats.listenedSeconds)} من نحو {formatDurationWords(totals.totalSeconds)}
            </p>
          </div>
        </div>
      </Card>

      {/* The week, day by day */}
      <ListeningJournal />

      {/* Continue listening */}
      {continued.length > 0 && (
        <Card>
          <SectionHeader title="أكمل من حيث توقفت" icon={<Clock size={20} />} />
          <ul className="space-y-1.5">
            {continued.map(({ record, ref, collection }) => {
              const lecture = ref.lecture;
              const durationMs = lecture.seconds * 1000;
              const fraction = durationMs > 0 ? Math.min(1, record.furthest / durationMs) : 0;
              const meta = STATUS_META[lectureStatus(lecture.id, durationMs)];
              const remaining = Math.max(0, lecture.seconds - Math.round(record.furthest / 1000));
              const album = collection?.album ?? 'متابعة الاستماع';
              const queue: LectureQueueItem[] =
                collection?.lectures.map((entry) => ({
                  lecture: entry,
                  item: collection.item,
                  album,
                })) ?? [{ lecture, item: ref.item, album }];
              return (
                <li
                  key={lecture.id}
                  className="flex items-center gap-2.5 rounded-2xl border border-primary-100/80 bg-white/70 px-3 py-2.5 dark:border-primary-800/60 dark:bg-primary-950/40"
                >
                  <button
                    type="button"
                    onClick={() => playLecture(lecture, collection?.item ?? ref.item, queue, album)}
                    aria-label={`أكمل ${lecture.title}`}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <Play size={16} aria-hidden="true" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-primary-900 dark:text-primary-100" title={lecture.title}>
                      {lecture.title}
                    </p>
                    {collection && (
                      <p className="truncate text-[0.6875rem] text-gray-400 dark:text-gray-500">{collection.album}</p>
                    )}
                    <div className="mt-1.5">
                      <ProgressBar fraction={fraction} />
                    </div>
                    <p className="mt-1 flex items-center gap-2 text-[0.6875rem] text-gray-500 dark:text-gray-400">
                      <span className={`font-semibold ${meta.className}`}>{meta.label}</span>
                      <span className="tabular-nums">{toArabicDigits(Math.round(fraction * 100))}٪</span>
                      {remaining > 0 && <span>باقي {formatDurationWords(remaining)}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* Courses in flight */}
      {coursesInProgress.length > 0 && (
        <Card>
          <SectionHeader title="دورات في الطريق" icon={<GraduationCap size={20} />} />
          <ul className="space-y-2.5">
            {coursesInProgress.map(({ course }) => (
              <CollectionProgressCard
                key={course.id}
                title={course.title}
                icon={GraduationCap}
                lectures={course.lectures}
                item={course.item}
                album={course.title}
                kbps={course.kbps}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* Series in flight */}
      {seriesInProgress.length > 0 && (
        <Card>
          <SectionHeader title="سلاسل في الطريق" icon={<ListMusic size={20} />} />
          <ul className="space-y-2.5">
            {seriesInProgress.map(({ series }) => (
              <CollectionProgressCard
                key={series.id}
                title={series.title}
                icon={ListMusic}
                lectures={series.lectures}
                item={HUWAINI_LIBRARY_ITEM}
                album={series.title}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* The lessons this listener returns to most */}
      <MostListened records={records} />

      {/* Reset — offered quietly, because it is destructive and rarely wanted. */}
      <ResetProgressButton recordCount={Object.keys(records).length} />
    </section>
  );
}

function ResetProgressButton({ recordCount }: { recordCount: number }) {
  return (
    <div className="flex items-center justify-center pt-1">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && !window.confirm('سيُحذف سجلّ استماعك كله من الشيخ. متابعة؟')) return;
          const map = JSON.parse(
            (globalThis.localStorage?.getItem('huwaini-progress-v1') || '{}') as string,
          ) as Record<string, unknown>;
          for (const id of Object.keys(map)) clearLectureProgress(id);
        }}
        aria-label={`تصفير سجل الاستماع (${recordCount} درسًا)`}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[0.6875rem] font-medium text-gray-400 transition-colors hover:bg-error-50 hover:text-error-600 dark:text-gray-500 dark:hover:bg-error-900/20 dark:hover:text-error-400"
      >
        <RotateCcw size={13} aria-hidden="true" />
        تصفير سجل الاستماع
      </button>
    </div>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  subtitle,
}: {
  id?: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-300">
        <Icon size={19} aria-hidden="true" />
      </div>
      <div>
        <h2 id={id} className="text-lg font-bold text-primary-800 dark:text-primary-100">
          {title}
        </h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}
