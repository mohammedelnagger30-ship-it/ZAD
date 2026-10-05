import { db, type HifzPlan, type DailyTask, type ProgressType } from '@/db/database';
import { todayKey, formatDateKey } from '@/utils/dateUtils';
import {
  getSurah,
  getAyahPage,
  getSurahEndPage,
  SURAHS,
  JUZ_INFO,
  TOTAL_QURAN_PAGES,
  type SurahMeta,
} from '@/data/surahs';

export function describePortion(portion: string): string {
  if (portion.startsWith('surah:')) {
    const parts = portion.split(':');
    const surahId = parseInt(parts[1]);
    const surah = getSurah(surahId);
    if (!surah) return portion;
    if (parts[2]) {
      const range = parts[2];
      if (range.includes('-')) {
        const [from, to] = range.split('-');
        return `سورة ${surah.name} (آية ${from}-${to})`;
      }
      return `سورة ${surah.name} (آية ${range})`;
    }
    return `سورة ${surah.name} كاملة`;
  }
  if (portion.startsWith('juz:')) {
    const juzId = parseInt(portion.split(':')[1]);
    return `الجزء ${juzId}`;
  }
  if (portion.startsWith('page:')) {
    const pageId = parseInt(portion.split(':')[1]);
    return `صفحة ${pageId}`;
  }
  return portion;
}

function getProgressRanges(portion: string): Array<{ surahId: number; ayahStart: number; ayahEnd: number }> {
  if (portion.startsWith('surah:')) {
    const [, surahIdText, range] = portion.split(':');
    const surahId = Number(surahIdText);
    const surah = getSurah(surahId);
    if (!surah) return [];
    if (!range) return [{ surahId, ayahStart: 1, ayahEnd: surah.ayahCount }];
    const [startText, endText = startText] = range.split('-');
    const ayahStart = Math.max(1, Math.min(surah.ayahCount, Number(startText)));
    const ayahEnd = Math.max(ayahStart, Math.min(surah.ayahCount, Number(endText)));
    return Number.isFinite(ayahStart) && Number.isFinite(ayahEnd)
      ? [{ surahId, ayahStart, ayahEnd }]
      : [];
  }

  let startPage: number;
  let endPage: number;
  if (portion.startsWith('page:')) {
    startPage = Number(portion.slice('page:'.length));
    endPage = startPage;
  } else if (portion.startsWith('juz:')) {
    const juz = JUZ_INFO.find((item) => item.id === Number(portion.slice('juz:'.length)));
    if (!juz) return [];
    startPage = juz.startPage;
    endPage = juz.endPage;
  } else {
    return [];
  }
  if (!Number.isInteger(startPage) || startPage < 1 || startPage > TOTAL_QURAN_PAGES) return [];

  const ranges: Array<{ surahId: number; ayahStart: number; ayahEnd: number }> = [];
  for (const surah of SURAHS) {
    if (getSurahEndPage(surah) < startPage || surah.pageStart > endPage) continue;
    let ayahStart = 0;
    let ayahEnd = 0;
    for (let ayah = 1; ayah <= surah.ayahCount; ayah++) {
      const page = getAyahPage(surah, ayah);
      if (page < startPage || page > endPage) continue;
      if (ayahStart === 0) ayahStart = ayah;
      ayahEnd = ayah;
    }
    if (ayahStart > 0) ranges.push({ surahId: surah.id, ayahStart, ayahEnd });
  }
  return ranges;
}

export async function generateDailyTasks(date: Date = new Date()): Promise<void> {
  const dateKey = formatDateKey(date);
  const dayOfWeek = date.getDay();

  await db.transaction('rw', db.plans, db.tasks, async () => {
    const allPlans = await db.plans.toArray();
    const activePlans = allPlans.filter((p) => p.active && p.daysOfWeek.includes(dayOfWeek) && p.id !== undefined);
    const existing = await db.tasks.where('date').equals(dateKey).toArray();
    const existingPlanIds = new Set(existing.map((task) => task.planId));
    const plansToAdd = activePlans.filter((plan) => !existingPlanIds.has(plan.id!));

    if (plansToAdd.length === 0) return;

    const priorTasksByPlan = new Map<number, DailyTask[]>();
    await Promise.all(plansToAdd.map(async (plan) => {
      priorTasksByPlan.set(plan.id!, await db.tasks.where('planId').equals(plan.id!).toArray());
    }));

    const tasksToAdd: DailyTask[] = [];
    for (const plan of plansToAdd) {
      let portion = plan.portion;
      if (plan.portionSequence?.length && plan.progressionId) {
        const siblingPlans = allPlans.filter((candidate) => candidate.progressionId === plan.progressionId);
        const hifzPlan = siblingPlans.find((candidate) => candidate.type === 'hifz');
        if (plan.type === 'hifz') {
          const previousTasks = priorTasksByPlan.get(plan.id!) ?? [];
          const completed = new Set(previousTasks.filter((task) => task.status === 'done').map((task) => task.portion));
          const nextPortion = plan.portionSequence.find((item) => !completed.has(item));
          if (!nextPortion) continue;
          portion = nextPortion;
        } else if (hifzPlan?.id !== undefined) {
          const learnedTasks = await db.tasks.where('planId').equals(hifzPlan.id).toArray();
          const learned = new Set(learnedTasks.filter((task) => task.status === 'done').map((task) => task.portion));
          const reviewTasks = priorTasksByPlan.get(plan.id!) ?? [];
          const lastReviewed = new Map<string, string>();
          for (const task of reviewTasks) {
            if (task.status !== 'done') continue;
            const reviewedOn = lastReviewed.get(task.portion);
            if (!reviewedOn || task.date > reviewedOn) lastReviewed.set(task.portion, task.date);
          }
          const duePortion = plan.portionSequence
            .filter((item) => learned.has(item))
            .sort((a, b) => (lastReviewed.get(a) ?? '').localeCompare(lastReviewed.get(b) ?? ''))[0];
          if (!duePortion) continue;
          portion = duePortion;
        }
      }

      tasksToAdd.push({
        planId: plan.id!,
        planSyncId: plan.syncId,
        date: dateKey,
        type: plan.type,
        portion,
        scheduledTime: plan.time,
        status: 'pending',
        createdAt: Date.now(),
      });
    }
    if (tasksToAdd.length > 0) await db.tasks.bulkAdd(tasksToAdd);
  });
}

export async function getTodayTasks(): Promise<DailyTask[]> {
  const dateKey = todayKey();
  const tasks = await db.tasks.where('date').equals(dateKey).toArray();
  return tasks.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

export async function confirmTask(
  taskId: number,
  status: 'done' | 'missed',
  strength?: 'weak' | 'medium' | 'strong'
): Promise<void> {
  const patch: Partial<DailyTask> = {
    status,
    confirmedAt: Date.now(),
  };
  if (strength) patch.strength = strength;
  await db.tasks.update(taskId, patch);

  // Record progress if done with strength
  if (status === 'done' && strength) {
    const task = await db.tasks.get(taskId);
    if (task) {
      const progressStatus: ProgressType = task.type === 'hifz'
        ? 'memorized'
        : strength === 'strong' ? 'strong' : strength === 'medium' ? 'reviewing' : 'weak';
      const ranges = getProgressRanges(task.portion);
      if (ranges.length > 0) {
        const ratedAt = Date.now();
        await db.hifzProgress.bulkAdd(ranges.map((range) => ({ ...range, status: progressStatus, ratedAt })));
      }
    }
  }
}

export async function snoozeTask(taskId: number, minutes: number): Promise<void> {
  await db.tasks.update(taskId, {
    status: 'snoozed',
    snoozedUntil: Date.now() + minutes * 60000,
  });
}

export async function unsnoozeTask(taskId: number): Promise<void> {
  await db.tasks.update(taskId, {
    status: 'pending',
    snoozedUntil: undefined,
  });
}

export async function markMissedTasks(): Promise<void> {
  const dateKey = todayKey();
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 0, 0);
  const isEndOfDay = now >= endOfDay.getTime();

  // An expired snooze becomes actionable again; unfinished tasks become missed at day end.
  const pending = await db.tasks.where('date').equals(dateKey).toArray();
  for (const task of pending) {
    if (task.status === 'snoozed') {
      if (isEndOfDay) {
        await db.tasks.update(task.id!, { status: 'missed' });
      } else if (task.snoozedUntil && task.snoozedUntil <= now) {
        await db.tasks.update(task.id!, { status: 'pending', snoozedUntil: undefined });
      }
    } else if (task.status === 'pending' && isEndOfDay) {
      await db.tasks.update(task.id!, { status: 'missed' });
    }
  }

  // Also mark yesterday's pending tasks as missed
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatDateKey(yesterday);
  const yesterdayTasks = await db.tasks.where('date').equals(yesterdayKey).toArray();
  for (const task of yesterdayTasks) {
    if (task.status === 'pending' || task.status === 'snoozed') {
      await db.tasks.update(task.id!, { status: 'missed' });
    }
  }
}

/**
 * Consecutive days (ending today or yesterday) on which every scheduled task was done.
 *
 * Loads the whole lookback window in one query rather than one query per day.
 */
export async function getStreakCount(): Promise<number> {
  const MAX_LOOKBACK_DAYS = 365;
  const today = new Date();

  const dateKeys: string[] = [];
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dateKeys.push(formatDateKey(date));
  }

  const tasks = await db.tasks.where('date').anyOf(dateKeys).toArray();
  const byDate = new Map<string, DailyTask[]>();
  for (const task of tasks) {
    const bucket = byDate.get(task.date);
    if (bucket) bucket.push(task);
    else byDate.set(task.date, [task]);
  }

  let streak = 0;
  for (let i = 0; i < dateKeys.length; i++) {
    const dayTasks = byDate.get(dateKeys[i]);
    if (!dayTasks || dayTasks.length === 0) {
      if (i === 0) continue; // Today might not have tasks yet
      break;
    }
    if (dayTasks.every((t) => t.status === 'done')) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Arabic harakat, tatweel and Quranic annotation marks.
 *
 * Written as explicit escapes on purpose: the marks are NOT one contiguous block —
 * U+064B-U+065F are the harakat, U+0660-U+0669 are the Arabic-Indic *digits*, and only
 * U+0670 plus U+06D6-U+06ED belong here. A single `U+064B-U+0670` range silently deletes
 * every digit in the goal.
 */
// eslint-disable-next-line no-misleading-character-class -- deliberate harakat range (U+064B-U+065F etc.)
const ARABIC_MARKS = /[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/**
 * Prepare a typed goal for matching: ASCII digits, no harakat.
 *
 * Users type "جُزء عَمّ" and "جزء عم"; without stripping the marks the two never match.
 * Arabic-Indic digits (٠-٩) are mapped to ASCII so `parseInt` handles both in one regex.
 */
function normalizeGoal(goal: string): string {
  return goal
    .replace(ARABIC_MARKS, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** Resolve "الملك" / "سورة 67" / "Al-Mulk" to a surah. */
function findSurahInGoal(goal: string): SurahMeta | undefined {
  const q = normalizeGoal(goal);
  const lower = q.toLowerCase();

  const byName =
    SURAHS.find((s) => q.includes(s.name)) ??
    SURAHS.find((s) => lower.includes(s.nameLatin.toLowerCase())) ??
    SURAHS.find((s) => lower.includes(s.englishName.toLowerCase()));
  if (byName) return byName;

  // "سورة 67" / "سورة ١١٤" — an explicit number wins over nothing, so try it last.
  const numbered = q.match(/(?:سورة|surah)\s*(\d{1,3})/i);
  if (numbered) {
    const id = parseInt(numbered[1], 10);
    return SURAHS.find((s) => s.id === id);
  }
  return undefined;
}

/** Juz 1-30 named after the surah each opens with, plus the traditional short names. */
const JUZ_NAME_ARABIC: { id: number; label: string; aliases: string[] }[] = [
  { id: 1, label: 'الفاتحة', aliases: [] }, { id: 2, label: 'البقرة', aliases: [] },
  { id: 3, label: 'عمران', aliases: ['آل عمران'] }, { id: 4, label: 'النساء', aliases: [] },
  { id: 5, label: 'المائدة', aliases: [] }, { id: 6, label: 'الأنعام', aliases: [] },
  { id: 7, label: 'الأعراف', aliases: [] }, { id: 8, label: 'الأنفال', aliases: [] },
  { id: 9, label: 'التوبة', aliases: [] }, { id: 10, label: 'يونس', aliases: [] },
  { id: 11, label: 'هود', aliases: [] }, { id: 12, label: 'يوسف', aliases: [] },
  { id: 13, label: 'الرعد', aliases: [] }, { id: 14, label: 'إبراهيم', aliases: ['ابراهيم'] },
  { id: 15, label: 'الحجر', aliases: [] }, { id: 16, label: 'النحل', aliases: [] },
  { id: 17, label: 'الإسراء', aliases: ['الاسراء'] }, { id: 18, label: 'الكهف', aliases: [] },
  { id: 19, label: 'مريم', aliases: [] }, { id: 20, label: 'طه', aliases: ['ته'] },
  { id: 21, label: 'الأنبياء', aliases: ['الانبياء'] }, { id: 22, label: 'الحج', aliases: [] },
  { id: 23, label: 'المؤمنون', aliases: ['المومنون'] }, { id: 24, label: 'النور', aliases: [] },
  { id: 25, label: 'الفرقان', aliases: [] }, { id: 26, label: 'الشعراء', aliases: [] },
  { id: 27, label: 'النمل', aliases: [] }, { id: 28, label: 'القصص', aliases: [] },
  { id: 29, label: 'تبارك', aliases: [] },
  // Juz 30 is conventionally "عمّ". Al-Mulk is NOT a good label here despite being a common
  // nickname: by this app's own page table Al-Mulk starts on page 562, which is in juz 29,
  // and juz 30 opens with An-Naba on page 582. Both familiar names stay as aliases so
  // user input like "حفظ جزء الملك" or "جزء عمّ" still resolves.
  { id: 30, label: 'النبأ', aliases: ['عم', 'الملك', 'إنا أعطيناك الكوثر', 'عمّ'] },
];

/**
 * Arabic ordinals for 1-30, checked longest-first so "الثالث عشر" wins over "الثالث".
 *
 * The multi-word forms must precede the bare ones: a naive scan would read
 * "الجزء الثالث عشر" as 3 instead of 13.
 */
const JUZ_ORDINALS: [string, number][] = ([
  ['الحادي والعشرون', 21], ['الثاني والعشرون', 22], ['الثالث والعشرون', 23],
  ['الرابع والعشرون', 24], ['الخامس والعشرون', 25], ['السادس والعشرون', 26],
  ['السابع والعشرون', 27], ['الثامن والعشرون', 28], ['التاسع والعشرون', 29],
  ['الحادية والعشرون', 21], ['الثانية والعشرون', 22], ['الثالثة والعشرون', 23],
  ['الرابعة والعشرون', 24], ['الخامسة والعشرون', 25], ['السادسة والعشرون', 26],
  ['السابعة والعشرون', 27], ['الثامنة والعشرون', 28], ['التاسعة والعشرون', 29],
  ['الثاني عشر', 12], ['الثالث عشر', 13], ['الرابع عشر', 14], ['الخامس عشر', 15],
  ['السادس عشر', 16], ['السابع عشر', 17], ['الثامن عشر', 18], ['التاسع عشر', 19],
  ['الثانية عشرة', 12], ['الثالثة عشرة', 13], ['الرابعة عشرة', 14], ['الخامسة عشرة', 15],
  ['السادسة عشرة', 16], ['السابعة عشرة', 17], ['الثامنة عشرة', 18], ['التاسعة عشرة', 19],
  ['الاول', 1], ['الأول', 1], ['الأولى', 1], ['الواحد', 1],
  ['الثانى', 2], ['الثاني', 2], ['الثانية', 2], ['الثنان', 2],
  ['الثالث', 3], ['الثالثة', 3], ['الثلاث', 3],
  ['الرابع', 4], ['الرابعة', 4], ['الأربعة', 4],
  ['الخامس', 5], ['الخامسة', 5], ['الخمسة', 5],
  ['السادس', 6], ['السادسة', 6], ['الستة', 6],
  ['السابع', 7], ['السابعة', 7], ['السبعة', 7],
  ['الثامن', 8], ['الثامنة', 8], ['الثمانية', 8],
  ['التاسع', 9], ['التاسعة', 9], ['التسعة', 9],
  ['العاشر', 10], ['العاشرة', 10], ['العشرة', 10],
  ['العشرون', 20], ['العشرين', 20], ['عشرين', 20],
  ['الثلاثون', 30], ['الثلاثين', 30], ['ثلاثين', 30],
] as [string, number][]).sort((a, b) => b[0].length - a[0].length);

/** Words that signal the goal is about a juz rather than a surah. */
const JUZ_KEYWORDS = /(?:الجزء|جزء|جzzle|\bjuz\b|\bpart\b)/i;

/** Resolve "جزء عمّ" / "الجزء الثلاثين" / "juz 30" / "جزء ١٨" to a juz id. */
function findJuzInGoal(goal: string): number | undefined {
  const q = normalizeGoal(goal);
  if (!JUZ_KEYWORDS.test(q)) return undefined;

  // "جزء عمّ" / "جزء الملك" — matched by the surah the juz opens with.
  for (const juz of JUZ_NAME_ARABIC) {
    if ([juz.label, ...juz.aliases].some((w) => q.includes(w))) return juz.id;
  }

  for (const [word, id] of JUZ_ORDINALS) {
    if (q.includes(word)) return id;
  }

  const digits = q.match(/(?:الجزء|جزء|جzzle|\bjuz\b|\bpart\b)\s*(\d{1,2})/i);
  if (digits) {
    const id = parseInt(digits[1], 10);
    if (id >= 1 && id <= 30) return id;
  }
  return undefined;
}

function buildPortionSequence(startPage: number, endPage: number): string[] {
  const ayahsByPage = new Map<number, Map<number, number[]>>();
  for (const surah of SURAHS) {
    for (let ayah = 1; ayah <= surah.ayahCount; ayah++) {
      const page = getAyahPage(surah, ayah);
      if (page < startPage || page > endPage) continue;
      let surahsOnPage = ayahsByPage.get(page);
      if (!surahsOnPage) {
        surahsOnPage = new Map();
        ayahsByPage.set(page, surahsOnPage);
      }
      const ayahs = surahsOnPage.get(surah.id);
      if (ayahs) ayahs.push(ayah);
      else surahsOnPage.set(surah.id, [ayah]);
    }
  }

  const sequence: string[] = [];
  for (let page = startPage; page <= endPage; page++) {
    const surahsOnPage = ayahsByPage.get(page);
    if (!surahsOnPage) continue;
    for (const [surahId, ayahs] of surahsOnPage) {
      const splitAt = Math.ceil(ayahs.length / 2);
      for (const part of [ayahs.slice(0, splitAt), ayahs.slice(splitAt)]) {
        if (part.length === 0) continue;
        sequence.push(`surah:${surahId}:${part[0]}-${part[part.length - 1]}`);
      }
    }
  }
  return sequence;
}

function formatRecommendedDuration(sessions: number): string {
  const weeks = Math.max(1, Math.ceil(sessions / 5));
  if (weeks === 1) return 'أسبوع تقريباً';
  if (weeks <= 10) return `${weeks} أسابيع تقريباً`;
  return `${Math.ceil(weeks / 4.345)} أشهر تقريباً`;
}

/**
 * Turn a free-text goal into a concrete memorization plan.
 *
 * Understands both numeric and named references ("حفظ سورة الملك", "حفظ جزء عمّ",
 * "حفظ سورة ٢") plus Arabic-Indic digits. Anything it cannot identify falls
 * back to a half-page-a-day plan and says so in the description.
 */
export function suggestPlan(goal: string): { plans: Omit<HifzPlan, 'id' | 'createdAt'>[]; description: string } {
  const juzId = findJuzInGoal(goal);

  if (juzId) {
    const juz = JUZ_INFO.find((item) => item.id === juzId);
    if (!juz) {
      throw new Error(`Missing page range for juz ${juzId}`);
    }
    const portionSequence = buildPortionSequence(juz.startPage, juz.endPage);
    const targetDuration = formatRecommendedDuration(portionSequence.length);
    const juzTitle = JUZ_NAME_ARABIC.find((j) => j.id === juzId);
    const juzName = juzTitle
      ? `الجزء ${juzId} (${juzTitle.label})`
      : `الجزء ${juzId}`;

    return {
      description: `خطة لحفظ ${juzName} خلال ${targetDuration}، بمعدل نصف صفحة في جلسة الحفظ (٥ جلسات جديدة أسبوعياً)، مع استرجاع ومراجعة متباعدة لما تم حفظه.`,
      plans: [
        {
          name: `حفظ ${juzName}`,
          type: 'hifz',
          portion: `juz:${juzId}`,
          portionSequence,
          daysOfWeek: [0, 1, 2, 3, 4],
          time: '06:00',
          active: true,
        },
        {
          name: 'مراجعة متباعدة',
          type: 'muraja',
          portion: `juz:${juzId}`,
          portionSequence,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          time: '17:00',
          active: true,
        },
      ],
    };
  }

  const surah = findSurahInGoal(goal);
  if (surah) {
    const portionSequence = buildPortionSequence(surah.pageStart, getSurahEndPage(surah));
    const targetDuration = formatRecommendedDuration(portionSequence.length);

    return {
      description: `خطة لحفظ سورة ${surah.name} (${surah.ayahCount} آية) خلال ${targetDuration}، بمعدل نصف صفحة في جلسة الحفظ (٥ جلسات جديدة أسبوعياً)، مع استرجاع ومراجعة متباعدة لما تم حفظه.`,
      plans: [
        {
          name: `حفظ سورة ${surah.name}`,
          type: 'hifz',
          portion: `surah:${surah.id}`,
          portionSequence,
          daysOfWeek: [0, 1, 2, 3, 4],
          time: '06:00',
          active: true,
        },
        {
          name: 'مراجعة متباعدة',
          type: 'muraja',
          portion: `surah:${surah.id}`,
          portionSequence,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          time: '17:00',
          active: true,
        },
      ],
    };
  }

  const fallbackPage = TOTAL_QURAN_PAGES;
  return {
    description: `لم يتضح الهدف، فهذه خطة افتراضية: حفظ نصف صفحة يومياً من صفحة ${fallbackPage} مع مراجعة`,
    plans: [
      {
        name: 'حفظ جديد',
        type: 'hifz',
        portion: `page:${fallbackPage}`,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        time: '06:00',
        active: true,
      },
      {
        name: 'مراجعة',
        type: 'muraja',
        portion: `page:${fallbackPage}`,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        time: '17:00',
        active: true,
      },
    ],
  };
}
