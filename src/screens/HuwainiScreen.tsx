import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  GraduationCap,
  HardDrive,
  Library,
  ListMusic,
  Loader2,
  Mic,
  Mic2,
  Pause,
  Play,
  Search,
  Share2,
  Smartphone,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge, Card, EmptyState, type BadgeProps } from '@/components/ui';
import { toArabicDigits } from '@/data/surahs';
import {
  HUWAINI_COURSES,
  HUWAINI_LECTURES,
  HUWAINI_LIBRARY_ITEM,
  HUWAINI_PROFILE,
  HUWAINI_SERIES,
  HUWAINI_STATS,
  huwayniLectureById,
  huwayniQualityLabel,
  huwayniQualityTier,
  type HuwainiLecture,
  type HuwainiSeries,
} from '@/data/scholarHuwaini';
import { useLectureDownloads, useLecturePlayer } from '@/hooks/useLecturePlayer';
import type { ScreenName } from '@/hooks/useApp';
import { HuwainiProgress } from '@/components/HuwainiProgress';
import { LectureProgressMark } from '@/components/LectureProgressBadge';
import { formatBytes, formatClock, formatDurationWords } from '@/utils/formatClock';
import {
  cancelLectureDownload,
  deleteAllLectureDownloads,
  deleteAllPhoneLectures,
  deleteLectureDownload,
  dismissLectureError,
  enqueueLectureDownloads,
  ensureLectureStoreLoaded,
  requestLecturePhoneSave,
  shareLecture,
  type LectureSource,
} from '@/utils/lectureStore';
import { playLecture, togglePlay, type LectureQueueItem } from '@/utils/lecturePlayer';
import { collectionProgress, lectureProgressRevision, subscribeLectureProgress } from '@/utils/lectureProgress';

interface HuwainiScreenProps {
  navigate: (screen: ScreenName) => void;
}

type Filter = 'all' | 'courses' | 'series' | 'singles' | 'best' | 'downloaded';

const FILTERS: { id: Filter; label: string; icon: LucideIcon }[] = [
  { id: 'all', label: 'الكل', icon: Sparkles },
  { id: 'courses', label: 'الدورات', icon: GraduationCap },
  { id: 'series', label: 'السلاسل', icon: Library },
  { id: 'singles', label: 'المفردة', icon: Mic },
  { id: 'best', label: 'الأجود صوتًا', icon: Sparkles },
  { id: 'downloaded', label: 'المُنزَّل', icon: HardDrive },
];

/**
 * Search that survives the way Arabic is actually written on archive.org: diacritics,
 * tatweel and the alef/ya/ta-marbuta spellings all differ between two titles for the
 * same lecture, and a search box that missed them would look broken.
 */
function normalizeText(value: string): string {
  return value
    .replace(/\u0640+/g, '')
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function qualityVariant(kbps: number): BadgeProps['variant'] {
  const tier = huwayniQualityTier(kbps);
  if (tier === 'high') return 'success';
  if (tier === 'medium') return 'gold';
  return 'neutral';
}

/**
 * The cover a collection gets.
 *
 * Chosen from the id with a small hash rather than at random, so a course keeps the same
 * colour on every visit and on every device — a library where «سلسلة النبلاء» was green
 * yesterday and orange today would read as a bug. Six pairings, all built from the theme's
 * own palette, so the covers follow whichever colour the reader picked.
 */
function coverClass(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  const letters = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
  return `collection-cover--${letters[hash % letters.length]}`;
}

function lectureDuration(lecture: HuwainiLecture): string {
  return lecture.seconds > 0 ? formatClock(lecture.seconds * 1000) : 'مدة غير معلومة';
}

function queueFor(lectures: HuwainiLecture[], item: string, album: string): LectureQueueItem[] {
  return lectures.map((lecture) => ({ lecture, item, album }));
}

// ---------------------------------------------------------------------------
// One recording
// ---------------------------------------------------------------------------

interface LectureRowProps {
  lecture: HuwainiLecture;
  item: string;
  album: string;
  queue: LectureQueueItem[];
}

/**
 * A single lesson: play it, or keep it.
 *
 * The row is the whole of a lecture's life in the app — idle, fetching with its size
 * counting up, kept, or failed with the reason — and the whole of its way out of the app,
 * which is what the single «تنزيل» button is for: one tap fetches the lecture, puts a copy
 * in the phone's own downloads folder where a file manager and a music player can find it,
 * and opens the share sheet so it can be sent to WhatsApp, Telegram or anywhere else. Once
 * it has left the app the button becomes «مشاركة», so sharing again never means downloading
 * again. Both halves report themselves here, so the listener never has to go somewhere else
 * to find out what happened.
 */
function LectureRow({ lecture, item, album, queue }: LectureRowProps) {
  const player = useLecturePlayer();
  const { downloaded, downloads, phoneSaved, phoneSaving, phoneErrors } = useLectureDownloads();
  const download = downloads.get(lecture.id);
  const isKept = downloaded.has(lecture.id);
  const isOnPhone = phoneSaved.has(lecture.id);
  const isSavingToPhone = phoneSaving.has(lecture.id);
  const phoneError = phoneErrors.get(lecture.id);
  const isCurrent = player.current?.lecture.id === lecture.id;
  const isPlaying = isCurrent && player.isPlaying;

  const percent = download && download.total > 0 ? Math.min(100, (download.received / download.total) * 100) : 0;

  return (
    <li className="flex items-center gap-2.5 rounded-2xl border border-primary-100/80 bg-white/70 px-3 py-2.5 dark:border-primary-800/60 dark:bg-primary-950/40">
      <button
        type="button"
        onClick={() => (isCurrent ? togglePlay() : playLecture(lecture, item, queue, album))}
        aria-label={isPlaying ? `إيقاف ${lecture.title}` : `تشغيل ${lecture.title}`}
        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 ${
          isCurrent
            ? 'bg-primary-600 text-white hover:bg-primary-700'
            : 'bg-primary-100 text-primary-700 hover:bg-primary-200 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
        }`}
      >
        {isCurrent && player.loading ? (
          <Loader2 size={17} className="animate-spin" aria-hidden="true" />
        ) : isPlaying ? (
          <Pause size={17} aria-hidden="true" />
        ) : (
          <Play size={17} aria-hidden="true" />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-primary-900 dark:text-primary-100" title={lecture.title}>
          {lecture.title}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Clock size={11} aria-hidden="true" />
            {lectureDuration(lecture)}
          </span>
          {lecture.bytes > 0 && <span>{formatBytes(lecture.bytes)}</span>}
          {isKept && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-success-600 dark:text-success-400">
              <Check size={11} aria-hidden="true" />
              محفوظة
            </span>
          )}
          {isOnPhone && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-primary-700 dark:text-primary-300">
              <Smartphone size={11} aria-hidden="true" />
              على الهاتف
            </span>
          )}
        </p>
        <LectureProgressMark id={lecture.id} durationMs={lecture.seconds * 1000} />
        {download?.status === 'downloading' && (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-primary-100 dark:bg-primary-800">
            <div className="h-full bg-primary-500 transition-[width] dark:bg-gold-400" style={{ width: `${percent}%` }} />
          </div>
        )}
        {download?.status === 'error' && (
          <p className="mt-1 text-[0.6875rem] text-error-600 dark:text-error-400">{download.error}</p>
        )}
      </div>

      {download?.status === 'downloading' ? (
        <button
          type="button"
          onClick={() => cancelLectureDownload(lecture.id)}
          aria-label="إلغاء التنزيل"
          title="إلغاء التنزيل"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-primary-800"
        >
          <X size={15} aria-hidden="true" />
          {toArabicDigits(Math.round(percent))}٪
        </button>
      ) : isSavingToPhone ? (
        <span
          aria-live="polite"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary-50 px-2.5 text-xs font-semibold text-primary-700 dark:bg-primary-800 dark:text-primary-200"
        >
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          جارٍ التنزيل
        </span>
      ) : isKept || isOnPhone ? (
        // The file has already left the app once. The button stays useful — sharing a
        // lecture again should not mean downloading it again — so it opens the share
        // sheet, which is what «تنزيل» was leading to all along.
        <button
          type="button"
          onClick={() => void shareLecture({ lecture, item }, album)}
          aria-label={`مشاركة ${lecture.title}`}
          title="مشاركة المحاضرة على أي تطبيق"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-600"
        >
          <Share2 size={15} aria-hidden="true" />
          مشاركة
        </button>
      ) : phoneError ? (
        <button
          type="button"
          onClick={() => void requestLecturePhoneSave({ lecture, item }, album)}
          aria-label={`إعادة محاولة التنزيل ${lecture.title}`}
          title={phoneError}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-error-50 px-2.5 text-xs font-semibold text-error-600 transition-colors hover:bg-error-100 dark:bg-error-900/30 dark:text-error-400 dark:hover:bg-error-900/50"
        >
          <Download size={15} aria-hidden="true" />
          إعادة
        </button>
      ) : download?.status === 'error' ? (
        <button
          type="button"
          onClick={() => {
            dismissLectureError(lecture.id);
            enqueueLectureDownloads([{ lecture, item }]);
          }}
          aria-label={`إعادة محاولة تنزيل ${lecture.title}`}
          title="إعادة المحاولة"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-error-50 px-2.5 text-xs font-semibold text-error-600 transition-colors hover:bg-error-100 dark:bg-error-900/30 dark:text-error-400 dark:hover:bg-error-900/50"
        >
          <Download size={15} aria-hidden="true" />
          إعادة
        </button>
      ) : (
        // One button, named for the one thing the listener asked for: «تنزيل». It fetches
        // the lecture, drops a copy in the phone's own downloads folder, and opens the
        // share sheet on the same tap — so it can go straight to WhatsApp or anywhere.
        <button
          type="button"
          onClick={() => void requestLecturePhoneSave({ lecture, item }, album)}
          aria-label={`تنزيل ${lecture.title}`}
          title="تنزيل ومشاركة المحاضرة"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Download size={15} aria-hidden="true" />
          تنزيل
        </button>
      )}

      {isKept && (
        <button
          type="button"
          onClick={() => void deleteLectureDownload(lecture.id)}
          aria-label={`حذف ${lecture.title} من التطبيق`}
          title="حذف من التطبيق"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-gray-500 transition-colors hover:bg-error-50 hover:text-error-600 dark:text-gray-300 dark:hover:bg-error-900/30 dark:hover:text-error-400"
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// A card: a course or a series
// ---------------------------------------------------------------------------

interface CollectionCardProps {
  id: string;
  title: string;
  blurb?: string;
  item: string;
  lectures: HuwainiLecture[];
  /** A course's own bitrate; the library's series share the library's. */
  kbps: number;
  source?: string;
  icon: LucideIcon;
}

/**
 * A course or a series, bound like a volume.
 *
 * The card opens with a cover — a coloured tile drawn from the collection's id — beside
 * the title, then a rule showing how much of it has been heard, then the controls. The
 * progress rule is the one thing on the card that is not decoration: it is what turns a
 * catalogue entry into something the listener can see themselves partway through.
 */
function CollectionCard({ id, title, blurb, item, lectures, kbps, source, icon: Icon }: CollectionCardProps) {
  const [open, setOpen] = useState(false);
  const { downloaded, downloads } = useLectureDownloads();
  useSyncExternalStore(subscribeLectureProgress, lectureProgressRevision);

  const queue = useMemo(() => queueFor(lectures, item, title), [lectures, item, title]);
  const seconds = lectures.reduce((total, lecture) => total + lecture.seconds, 0);
  const bytes = lectures.reduce((total, lecture) => total + lecture.bytes, 0);
  const keptCount = lectures.filter((lecture) => downloaded.has(lecture.id)).length;
  const fetchingCount = lectures.filter((lecture) => downloads.get(lecture.id)?.status === 'downloading').length;
  const allKept = keptCount === lectures.length;
  const progress = collectionProgress(lectures);
  const missing: LectureSource[] = lectures
    .filter((lecture) => !downloaded.has(lecture.id))
    .map((lecture) => ({ lecture, item }));

  return (
    <Card className="collection-card" noPadding>
      <div className="p-4">
        <div className="flex items-start gap-3.5">
          <div className={`collection-card__cover ${coverClass(id)}`}>
            {progress.complete ? <CheckCircle2 size={22} aria-hidden="true" /> : <Icon size={22} aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-primary-900 dark:text-primary-50">{title}</h3>
              {progress.total > 0 && (progress.started > 0 || progress.finished > 0) && (
                <span className="shrink-0 text-xs font-bold tabular-nums text-primary-700 dark:text-gold-300">
                  {toArabicDigits(Math.round(progress.fraction * 100))}٪
                </span>
              )}
            </div>
            {blurb && <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{blurb}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={qualityVariant(kbps)}>{huwayniQualityLabel(kbps)}</Badge>
              <Badge variant="primary">{toArabicDigits(lectures.length)} درسًا</Badge>
              {seconds > 0 && <Badge variant="neutral">{formatDurationWords(seconds)}</Badge>}
              {bytes > 0 && <Badge variant="neutral">{formatBytes(bytes)}</Badge>}
              {progress.complete && <Badge variant="success">مكتملة</Badge>}
            </div>
          </div>
        </div>

        {(progress.finished > 0 || progress.started > 0) && (
          <div className="mt-3">
            <div className="collection-card__progress">
              <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-gray-500 dark:text-gray-400">
              أتممت {toArabicDigits(progress.finished)} من {toArabicDigits(progress.total)} درسًا
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => playLecture(lectures[0], item, queue, title)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Play size={14} aria-hidden="true" />
            استمع من الأول
          </button>

          {allKept ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-xl bg-success-100 px-3 py-2 text-xs font-semibold text-success-700 dark:bg-success-900/40 dark:text-success-300">
                <Check size={14} aria-hidden="true" />
                محفوظة كاملة
              </span>
              <button
                type="button"
                onClick={() => void Promise.all(lectures.map((lecture) => deleteLectureDownload(lecture.id)))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-error-50 hover:text-error-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-error-900/30 dark:hover:text-error-400"
              >
                <Trash2 size={14} aria-hidden="true" />
                حذف من الجهاز
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => enqueueLectureDownloads(missing)}
              disabled={missing.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary-100 px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-200 disabled:opacity-50 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
            >
              {fetchingCount > 0 ? (
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              {keptCount > 0 ? `تنزيل الباقي (${toArabicDigits(missing.length)})` : 'تنزيل الكل'}
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:text-primary-200 dark:hover:bg-primary-800"
          >
            {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {open ? 'إخفاء الدروس' : `عرض الدروس (${toArabicDigits(lectures.length)})`}
          </button>

          {source && (
            <a
              href={source}
              target="_blank"
              rel="noreferrer"
              className="ms-auto text-[0.6875rem] text-gray-400 underline-offset-2 hover:underline dark:text-gray-500"
            >
              المصدر
            </a>
          )}
        </div>
      </div>

      {open && (
        <ul className="space-y-1.5 border-t border-primary-100/80 bg-primary-50/40 p-2.5 dark:border-primary-800/60 dark:bg-primary-900/30">
          {lectures.map((lecture) => (
            <LectureRow key={lecture.id} lecture={lecture} item={item} album={title} queue={queue} />
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/**
 * صفحة الشيخ أبي إسحاق الحويني — everything he left behind, in one place.
 *
 * The order of the page is the order of the promise it makes. The courses come first
 * because they are the recordings worth an hour of anyone's time, and each one carries
 * its own bitrate, so «أجود الأصوات» is a fact about the file rather than a claim. The
 * library below it is everything else — seven hundred-odd sermons and lessons, most of
 * them cassette transfers, honest about the quality they were preserved at.
 */
export function HuwainiScreen({ navigate }: HuwainiScreenProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [visibleSingles, setVisibleSingles] = useState(40);
  const [bioOpen, setBioOpen] = useState(false);
  const { downloaded, phoneSaved } = useLectureDownloads();

  useEffect(() => {
    void ensureLectureStoreLoaded();
  }, []);

  // A new search or filter starts the list over; keeping the old count would leave the
  // reader three screens down a list they never scrolled.
  useEffect(() => {
    setVisibleSingles(40);
  }, [query, filter]);

  const needle = normalizeText(query);

  const courses = useMemo(() => {
    const matched = HUWAINI_COURSES.filter(
      (course) =>
        !needle ||
        normalizeText(course.title).includes(needle) ||
        normalizeText(course.blurb).includes(needle) ||
        course.lectures.some((lecture) => normalizeText(lecture.title).includes(needle)),
    );
    const withDownloads = matched.filter(
      (course) =>
        filter !== 'downloaded' ||
        course.lectures.some(
          (lecture) => downloaded.has(lecture.id) || phoneSaved.has(lecture.id),
        ),
    );
    // «الأجود صوتًا» is the whole point of the page: best first, always.
    return [...withDownloads].sort((a, b) => b.kbps - a.kbps);
  }, [needle, filter, downloaded, phoneSaved]);

  const series = useMemo(() => {
    return HUWAINI_SERIES.filter((entry) => {
      // «المُنزَّل» means kept somewhere the listener can reach without a connection — in
      // the app, or out in the phone's own folder.
      if (
        filter === 'downloaded' &&
        !entry.lectures.some((lecture) => downloaded.has(lecture.id) || phoneSaved.has(lecture.id))
      )
        return false;
      if (!needle) return true;
      return (
        normalizeText(entry.title).includes(needle) ||
        entry.lectures.some((lecture) => normalizeText(lecture.title).includes(needle))
      );
    });
  }, [needle, filter, downloaded, phoneSaved]);

  const singles = useMemo(() => {
    return HUWAINI_LECTURES.filter((lecture) => {
      if (filter === 'downloaded' && !(downloaded.has(lecture.id) || phoneSaved.has(lecture.id))) return false;
      if (!needle) return true;
      return normalizeText(lecture.title).includes(needle);
    });
  }, [needle, filter, downloaded, phoneSaved]);

  const showCourses = filter === 'all' || filter === 'courses' || filter === 'best' || filter === 'downloaded';
  const showSeries = filter === 'all' || filter === 'series' || filter === 'downloaded';
  const showSingles = filter === 'all' || filter === 'singles' || filter === 'downloaded';

  const keptCount = downloaded.size;
  const phoneCount = phoneSaved.size;
  const keptBytes = useMemo(() => {
    let total = 0;
    for (const id of downloaded) total += huwayniLectureById(id)?.lecture.bytes ?? 0;
    return total;
  }, [downloaded]);

  const hours = HUWAINI_STATS.seconds / 3600;
  const visibleList = singles.slice(0, visibleSingles);
  const singleQueue = useMemo(
    () => queueFor(visibleList, HUWAINI_LIBRARY_ITEM, 'محاضرات ودروس مفردة'),
    [visibleList],
  );

  return (
    <div className="space-y-5 pb-8" dir="rtl">
      <button
        type="button"
        onClick={() => navigate('more')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 transition-colors hover:text-primary-900 dark:text-primary-300 dark:hover:text-primary-100"
      >
        <ArrowRight size={16} aria-hidden="true" />
        رجوع إلى المزيد
      </button>

      {/* Hero — the frontispiece. A patterned panel names the الشيخ the way a cover
          names its author, then a row of counters states the scale of what he left,
          then the biography. Everything on it is drawn in CSS, so it opens instantly. */}
      <section className="scholar-hero p-6 text-center sm:p-8">
        <div className="scholar-hero__medallion">
          <Mic2 size={32} aria-hidden="true" />
        </div>

        <h1 className="scholar-hero__name mt-4 text-primary-900 dark:text-primary-50">
          {HUWAINI_PROFILE.name}
        </h1>

        <div className="scholar-hero__rule mt-1.5 text-sm font-semibold">
          <span className="text-gold-700 dark:text-gold-300">{HUWAINI_PROFILE.honorific}</span>
        </div>

        <p className="mt-2.5 text-xs text-gray-500 dark:text-gray-400">{HUWAINI_PROFILE.fullName}</p>
        <p className="mt-1 text-[0.6875rem] text-gray-500 dark:text-gray-400">
          {HUWAINI_PROFILE.born}
          <span className="mx-1.5 text-gold-500">◈</span>
          توفي {HUWAINI_PROFILE.died}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[
            { label: 'دورة علمية', value: toArabicDigits(HUWAINI_STATS.courses), icon: GraduationCap },
            { label: 'سلسلة', value: toArabicDigits(HUWAINI_STATS.series), icon: ListMusic },
            { label: 'درسًا ومحاضرة', value: toArabicDigits(HUWAINI_STATS.lectures), icon: Mic },
            { label: 'ساعة صوتية', value: toArabicDigits(Math.round(hours)), icon: Clock },
          ].map((stat) => {
            const StatIcon = stat.icon;
            return (
              <div key={stat.label} className="scholar-stat">
                <StatIcon size={15} className="mx-auto mb-1 text-gold-600 dark:text-gold-400" aria-hidden="true" />
                <p className="scholar-stat__value">{stat.value}</p>
                <p className="mt-0.5 text-[0.625rem] text-gray-500 dark:text-gray-400">{stat.label}</p>
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-5 max-w-2xl space-y-2 text-right text-xs leading-relaxed text-gray-600 dark:text-gray-300">
          {(bioOpen ? HUWAINI_PROFILE.bio : HUWAINI_PROFILE.bio.slice(0, 2)).map((paragraph) => (
            <p key={paragraph.slice(0, 24)}>{paragraph}</p>
          ))}
          {HUWAINI_PROFILE.bio.length > 2 && (
            <button
              type="button"
              onClick={() => setBioOpen((value) => !value)}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 underline-offset-2 hover:underline dark:text-gold-300"
            >
              {bioOpen ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
              {bioOpen ? 'إخفاء' : 'اقرأ السيرة كاملة'}
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-gray-400 dark:text-gray-500">
            <Sparkles size={11} aria-hidden="true" />
            تتلمذ على
          </span>
          {HUWAINI_PROFILE.teachers.slice(0, 4).map((teacher) => (
            <Badge key={teacher} variant="gold">
              {teacher}
            </Badge>
          ))}
        </div>

        <a
          href={HUWAINI_PROFILE.source}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-[0.6875rem] text-gray-400 underline-offset-2 hover:underline dark:text-gray-500"
        >
          السيرة من ويكيبيديا
        </a>
      </section>

      {/* Search + filters */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-primary-100/80 bg-white/90 px-4 py-2.5 backdrop-blur-xs dark:border-primary-800/70 dark:bg-primary-950/90 md:mx-0 md:px-0">
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث في الدورات والسلاسل والدروس…"
            aria-label="البحث في مكتبة الشيخ"
            className="w-full rounded-2xl border border-primary-200 bg-white py-2.5 pe-9 ps-3 text-sm text-primary-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-hidden focus:ring-2 focus:ring-primary-500/30 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-50"
          />
        </div>
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map((entry) => {
            const Icon = entry.icon;
            const active = filter === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setFilter(entry.id)}
                aria-pressed={active}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-primary-600 text-white'
                    : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700'
                }`}
              >
                <Icon size={13} aria-hidden="true" />
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Storage */}
      {(keptCount > 0 || phoneCount > 0) && (
        <Card className="border border-primary-100 dark:border-primary-800/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 dark:bg-primary-800 dark:text-primary-100">
                <HardDrive size={18} aria-hidden="true" />
              </div>
              <div>
                {keptCount > 0 && (
                  <>
                    <p className="text-sm font-bold text-primary-900 dark:text-primary-100">
                      {toArabicDigits(keptCount)} درسًا محفوظة على جهازك
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatBytes(keptBytes)} — تعمل بلا إنترنت داخل التطبيق
                    </p>
                  </>
                )}
                {phoneCount > 0 && (
                  <p
                    className={`text-xs font-semibold text-primary-700 dark:text-primary-300 ${
                      keptCount > 0 ? 'mt-1.5' : ''
                    }`}
                  >
                    {toArabicDigits(phoneCount)} درسًا في مجلد التنزيلات (Download/قُرّة) — يراها كل تطبيق على الهاتف
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {keptCount > 0 && (
                <button
                  type="button"
                  onClick={() => void deleteAllLectureDownloads()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-600 transition-colors hover:bg-error-50 hover:text-error-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-error-900/30 dark:hover:text-error-400"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  حذف كل التنزيلات
                </button>
              )}
              {phoneCount > 0 && (
                <button
                  type="button"
                  onClick={() => void deleteAllPhoneLectures()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary-100 px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-error-50 hover:text-error-600 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-error-900/30 dark:hover:text-error-400"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  حذف المحفوظ على الهاتف
                </button>
              )}
            </div>
          </div>
        </Card>
      )}

      {filter === 'best' && (
        <p className="rounded-2xl bg-gold-50 px-4 py-3 text-xs leading-relaxed text-gold-800 dark:bg-gold-900/20 dark:text-gold-200">
          هذه أفضل النسخ المتاحة من حيث جودة الصوت الحقيقية (معدّل البتّ المُقاس من الملف نفسه).
          أما مكتبة الدروس فمعظمها نسخ أشرطة قديمة حُفظت على ٦٤ كيلوبِت، ولا يوجد لها تسجيل أجود رُفع إلى الأرشيف.
        </p>
      )}

      {/* متابعة التقدم — the listener's own standing in the library, shown only where the
          full catalogue is, so it never competes with a search result or a filtered list. */}
      {filter === 'all' && !query && <HuwainiProgress />}

      {showCourses && courses.length > 0 && (
        <section className="space-y-3">
          <SectionHeading icon={GraduationCap} title="الدورات العلمية" subtitle="أجود النسخ، مرتّبة من الأعلى جودة" />
          {courses.map((course) => (
            <CollectionCard
              key={course.id}
              id={course.id}
              title={course.title}
              blurb={course.blurb}
              item={course.item}
              lectures={course.lectures}
              kbps={course.kbps}
              source={course.source}
              icon={BookOpen}
            />
          ))}
        </section>
      )}

      {showSeries && series.length > 0 && (
        <section className="space-y-3">
          <SectionHeading icon={Library} title="السلاسل" subtitle="الدروس المتسلسلة كما ألقاها الشيخ" />
          {series.map((entry: HuwainiSeries) => (
            <CollectionCard
              key={entry.id}
              id={entry.id}
              title={entry.title}
              item={HUWAINI_LIBRARY_ITEM}
              lectures={entry.lectures}
              kbps={64}
              icon={ListMusic}
            />
          ))}
        </section>
      )}

      {showSingles && singles.length > 0 && (
        <section className="space-y-3">
          <SectionHeading
            icon={Mic}
            title="محاضرات ودروس مفردة"
            subtitle={`${toArabicDigits(singles.length)} درسًا مستقلًا`}
          />
          <ul className="space-y-1.5">
            {visibleList.map((lecture) => (
              <LectureRow
                key={lecture.id}
                lecture={lecture}
                item={HUWAINI_LIBRARY_ITEM}
                album="محاضرات ودروس مفردة"
                queue={singleQueue}
              />
            ))}
          </ul>
          {visibleSingles < singles.length && (
            <button
              type="button"
              onClick={() => setVisibleSingles((count) => count + 60)}
              className="w-full rounded-2xl bg-primary-50 py-3 text-sm font-semibold text-primary-700 transition-colors hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
            >
              عرض المزيد ({toArabicDigits(singles.length - visibleSingles)} متبقٍ)
            </button>
          )}
        </section>
      )}

      {(courses.length === 0 && series.length === 0 && singles.length === 0) && (
        <EmptyState
          icon={<Search size={40} aria-hidden="true" />}
          title="لا نتائج"
          description={
            filter === 'downloaded'
              ? 'لم تنزّل أي درس بعد. اضغط زر التنزيل بجانب أي محاضرة للاحتفاظ بها على جهازك.'
              : 'جرّب كلمة أخرى، أو ابحث في اسم السلسلة أو الدرس.'
          }
        />
      )}

      <p className="pt-2 text-center text-[0.6875rem] leading-relaxed text-gray-400 dark:text-gray-500">
        المصدر: أرشيف الإنترنت —{' '}
        <a
          href="https://archive.org/details/Al-Alheweny"
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          مجموعة الشيخ الصوتية
        </a>
        . البثّ والتنزيل مباشرةً من الأرشيف، ولا يُخزَّن شيء على جهازك ولا يخرج منه إلا ما طلبت حفظه.
      </p>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-300">
        <Icon size={19} aria-hidden="true" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">{title}</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>
    </div>
  );
}
