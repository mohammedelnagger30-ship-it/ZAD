import { Capacitor, registerPlugin } from '@capacitor/core';
import { db, type Settings } from '@/db/database';
import {
  addCalendarDays,
  calculatePrayerTimes,
  calculatePrayerTimesForDay,
  calendarDayInZone,
  formatTime12h,
  getPrayerTimeZone,
} from '@/utils/prayerTimes';
import { trustedNow } from '@/utils/clock';
import { formatDateKey } from '@/utils/dateUtils';
import { describePortion } from '@/utils/taskManager';
import { countNoun, type ArabicCountForms } from '@/utils/arabicCount';

/**
 * The home-screen widget's data.
 *
 * A widget is not the app running small: it is a `RemoteViews` layout the
 * launcher draws from whatever the app last left on disk, on a schedule the
 * launcher owns — never more than once every half hour, and not even then
 * while the device is dozing. The app's whole job is therefore to leave
 * behind something that stays true *on its own*.
 *
 * Which is why what gets left behind is not «الصلاة القادمة» but the day's
 * times: the widget picks the first one still ahead of its own clock, so it
 * walks from الظهر to العصر at العصر without the app being opened, and stays
 * right through the evening for a snapshot taken at breakfast. Sunrise is
 * left out — it is not a prayer to answer, and `getNextPrayer` leaves it out
 * for the same reason.
 */

export interface WirdWidgetPrayer {
  /** The prayer in Arabic — already a label, not a key to look up. */
  name: string;
  timeMillis: number;
  /** Formatted for the city's own zone while the app was there to do it. */
  timeLabel: string;
}

export interface WirdWidgetSnapshot {
  /** The device-local day this describes. A widget showing yesterday's tasks would be lying. */
  date: string;
  /** Prayers still ahead when it was built, ascending. */
  prayers: WirdWidgetPrayer[];
  /** The whole task block, joined and ready — the widget sets one text. */
  tasksText: string;
  builtAt: number;
}

/** How many task lines fit before the rest are counted in one word. */
export const WIRD_TASK_LINES = 3;

const TASK_FORMS: ArabicCountForms = {
  one: 'مهمة واحدة',
  two: 'مهمتان',
  few: 'مهام',
  many: 'مهمة',
};

export interface WirdTaskRow {
  type: 'hifz' | 'muraja';
  portion: string;
  status: string;
}

/**
 * Renders today's tasks into the one text the widget shows.
 *
 * The lines are ordered undone-first rather than by time. A plan that
 * generates four portions a day would otherwise show three ticked boxes and
 * hide the one thing still to do — and a widget that reports the past while
 * hiding the present is worse than no widget.
 */
export function composeWirdTasks(tasks: WirdTaskRow[]): string {
  if (tasks.length === 0) return 'لا واجبات اليوم';

  const doneCount = tasks.filter((task) => task.status === 'done').length;
  // Both ends are worth saying in words: an empty list means there is no
  // plan, a fully ticked one means the day is finished, and neither should
  // be rendered as three ticked boxes that read like a bug.
  if (doneCount === tasks.length) return 'أتممت ورد اليوم';

  const undone = tasks.filter((task) => task.status !== 'done');
  const done = tasks.filter((task) => task.status === 'done');
  const shown = [...undone, ...done].slice(0, WIRD_TASK_LINES);

  const lines = shown.map((task) => {
    const kind = task.type === 'hifz' ? 'حفظ' : 'مراجعة';
    return `${task.status === 'done' ? '✓' : '○'} ${kind} — ${describePortion(task.portion)}`;
  });

  const rest = tasks.length - shown.length;
  if (rest > 0) lines.push(`و${countNoun(rest, TASK_FORMS)}`);
  return lines.join('\n');
}

/** Sunrise is a marker in the day, not a prayer — `getNextPrayer` skips it too. */
const isPrayer = (prayer: { name: string }) => prayer.name !== 'sunrise';

export function composeWirdPrayers(input: {
  today: { name: string; arabicName: string; time: Date }[];
  tomorrow: { name: string; arabicName: string; time: Date }[];
  nowMs: number;
  timeZone: string;
}): WirdWidgetPrayer[] {
  const remaining = input.today.filter(
    (prayer) => isPrayer(prayer) && prayer.time.getTime() > input.nowMs,
  );
  // Tomorrow's fajr goes in with them, so the list still holds a prayer at
  // «العشاء». Without it the widget would go blank for the very hours it is
  // most likely to be glanced at, and stay blank until the app was opened.
  const nextFajr = input.tomorrow.find(isPrayer);

  return [...remaining, ...(nextFajr ? [nextFajr] : [])].map((prayer) => ({
    name: prayer.arabicName,
    timeMillis: prayer.time.getTime(),
    timeLabel: formatTime12h(prayer.time, input.timeZone),
  }));
}

interface WirdWidgetPlugin {
  setSnapshot(options: { json: string }): Promise<void>;
}

const WirdWidget = registerPlugin<WirdWidgetPlugin>('WirdWidget');

export function isWirdWidgetAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('WirdWidget');
}

function upcomingPrayers(settings: Settings, now: Date): WirdWidgetPrayer[] {
  const {
    latitude, longitude, calcMethod, asrMadhab, timeZone, cityName, prayerTimeAdjustments,
  } = settings;
  if (latitude == null || longitude == null) return [];

  const zone = getPrayerTimeZone(timeZone, cityName);
  const today = calculatePrayerTimes(
    latitude, longitude, now, calcMethod, asrMadhab, zone, prayerTimeAdjustments,
  );
  const tomorrow = calculatePrayerTimesForDay(
    latitude,
    longitude,
    addCalendarDays(calendarDayInZone(now, zone), 1),
    calcMethod,
    asrMadhab,
    prayerTimeAdjustments,
  );

  return composeWirdPrayers({
    today: today.prayers,
    tomorrow: tomorrow.prayers,
    nowMs: now.getTime(),
    timeZone: zone,
  });
}

export async function buildWirdSnapshot(
  settings: Settings,
  now: Date = trustedNow(),
): Promise<WirdWidgetSnapshot> {
  const date = formatDateKey(now);
  const tasks = await db.tasks.where('date').equals(date).toArray();

  return {
    date,
    prayers: upcomingPrayers(settings, now),
    tasksText: composeWirdTasks(tasks),
    builtAt: now.getTime(),
  };
}

export async function syncWirdWidget(settings: Settings): Promise<void> {
  if (!isWirdWidgetAvailable()) return;

  try {
    const snapshot = await buildWirdSnapshot(settings);
    await WirdWidget.setSnapshot({ json: JSON.stringify(snapshot) });
  } catch (cause) {
    // The launcher's widget is a convenience drawn from a snapshot. It must
    // never be the reason the app fails — worst case the widget shows the
    // last thing it was given.
    console.error('Failed to refresh the home-screen widget:', cause);
  }
}
