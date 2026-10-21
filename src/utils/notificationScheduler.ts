import { LocalNotifications, type Importance, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { db, getSettings } from '@/db/database';
import type { Settings } from '@/db/database';
import {
  addCalendarDays,
  calculatePrayerTimesForDay,
  calendarDayInZone,
  formatTime12h,
  getPrayerTimeZone,
} from '@/utils/prayerTimes';
import { deviceClockDriftMs, toDeviceClock, trustedNow, trustedNowMs } from '@/utils/clock';
import { describePortion, generateDailyTasks, getTodayTasks } from '@/utils/taskManager';
import { getDailyQuranMessage, type DailyMessageStorage } from '@/utils/dailyQuranMessage';
import { SUNNAH_CATEGORIES, type SunnahItem } from '@/data/sunnah';
import { PROPHET_SECTIONS, type ProphetEntry } from '@/data/prophetData';
import { assembleNotificationQueue, dhikrFillerBudget } from '@/utils/notificationQueue';
import {
  getProtectionStatus,
  scheduleAdhanOverlay,
  setAdhanChannel,
  type AdhanOverlayAlarm,
  type AdhanScheduleResult,
} from '@/utils/adhanOverlay';
import {
  ensureAdhanVoicesLoaded,
  downloadedAdhanVoiceIds,
  resolveAdhanSoundPath,
  usableAdhanSound,
} from '@/utils/adhanStore';
import {
  NOTIFICATION_VOICE_NONE,
  getNotificationVoice,
  usableNotificationVoice,
} from '@/data/notificationSounds';
import { ADHKAR_CATEGORIES, ISTIGHFAR_DHIKR, type Dhikr } from '@/data/adhkar';
import {
  cancelAllNotifications,
  canScheduleExactAlarms,
  hasNotificationPermission,
  notifyNotificationWarning,
  notificationId,
  preserveActiveSnooze,
} from '@/utils/notifications';

type DhikrReminderCategory = 'morning' | 'evening' | 'istighfar';

/**
 * How many days of native prayer alarms are kept armed.
 *
 * Each open/resume rebuilds the whole queue, so this is the adhan's survival horizon
 * when the app is never opened again: beyond it there is nothing left to fire.
 */
const PRAYER_NOTIFICATION_DAYS = 30;

/**
 * Sound-notification fallbacks share Android's bounded notification queue with the
 * rest of the app. Keep them to a week (35 prayer alerts) so they still fit the
 * existing 50-entry ceiling if native full-screen alarm arming fails.
 */
const PRAYER_FALLBACK_DAYS = 7;

/**
 * How many days of the *daily-repeat* alerts — the iqamah and the pre-prayer reminder —
 * travel in the queue.
 *
 * Both are five-per-day buckets, and both used to be armed for the full 30-day prayer
 * horizon: 150 entries each against a 50-slot ceiling. That is arithmetically
 * impossible, and the two failures it caused compounded:
 *
 *   1. `dhikrFillerBudget` subtracts every certainly-armed bucket from the ceiling as
 *      an economy, so 150 + 150 drove the filler's budget to zero and the random dhikr
 *      reminders were never even created — the switch in Settings did nothing;
 *   2. assembly ranks the filler last, so a queue holding a month of iqamah had no room
 *      for one even when it was requested.
 *
 * Two days is what the queue can actually hold beside today's tasks, the hadith and the
 * spaced reviews, and it matches the filler's own horizon: everything here is rebuilt on
 * every open and resume. The adhan itself — the alert that must survive a closed app —
 * is armed natively for the full month and is unaffected.
 */
const DAILY_ALERT_DAYS = 2;

/**
 * The queue is capped at this many entries, in priority order: prayer fallback
 * alerts, today's task reminders, the hadith, the iqamah alerts, the pre-prayer
 * reminders, and finally the dhikr filler. It used to reach 100–250 entries — seven
 * days of prayer alerts plus two days of fifteen-minute dhikr slots — and Android's
 * notification store drops the tail of a batch this size, which could take the
 * hadith or a task reminder with it. Fifty is room for every prayer fallback on
 * the horizon plus a full day of tasks, the iqamah alerts and dhikr; what does not
 * fit is filler, cut from the end.
 *
 * Enforced in one place, at assembly — see assembleNotificationQueue. Capping
 * only the filler was not enough: with the fallbacks appended afterwards, a day
 * whose takeover had failed overflowed anyway, and the tail Android then dropped
 * was the fallbacks themselves.
 */
const MAX_SCHEDULED_NOTIFICATIONS = 50;
const MAX_HIFZ_REVIEW_REMINDERS = 15;

/**
 * How many days of the daily content notifications — hadith of the day, the Qur'an
 * message, a Sunnah, a fact about the Prophet ﷺ — travel in the queue.
 *
 * A week matches the prayer-fallback horizon, but unlike it the content is bounded
 * again at assembly (see the budget in `rescheduleAllNotifications`), so a busy week
 * gives up its far days rather than today's task.
 */
const CONTENT_NOTIFICATION_DAYS = 7;

/**
 * The identity every notification carries: the small icon (the open Mushaf,
 * white — the status bar tints it with `iconColor`, kept white so the badge
 * never shows the old blue), the full-colour app mark beside the content
 * (the Mushaf — Android drawable `ic_notification_large`, regenerated by
 * scripts/make-icons.ps1), and the app name as the sub-text so grouped
 * notifications stay recognisable.
 */
export const NOTIFICATION_BRAND = {
  smallIcon: 'ic_notification',
  largeIcon: 'ic_notification_large',
  iconColor: '#FFFFFF',
  summaryText: 'قُرّة',
} as const;

/**
 * Which collection a reminder draws from when the user leaves the category on
 * «متنوع حسب الوقت». The clock decides: morning adhkar before noon, evening adhkar from
 * Asr onwards, and a lighter istighfar in the middle of the day — alternating with the
 * collection of the period so a long window is not one theme end to end.
 */
function getDhikrReminderCategory(
  preference: Settings['randomDhikrCategory'] | undefined,
  at: Date,
  slot: number,
): DhikrReminderCategory {
  if (preference && preference !== 'varied') return preference;
  const hour = at.getHours();
  if (hour < 12) return slot % 2 === 0 ? 'morning' : 'istighfar';
  if (hour >= 17) return slot % 2 === 0 ? 'evening' : 'istighfar';
  return 'istighfar';
}

/**
 * The pool a reminder category draws from, with the collection id the notification's
 * deep link needs. Istighfar has no collection of its own in the adhkar pages, so it
 * uses its dedicated set rather than the generic fallback.
 */
function dhikrPool(category: DhikrReminderCategory): { items: Dhikr[]; categoryId: string } {
  if (category === 'istighfar') return { items: ISTIGHFAR_DHIKR, categoryId: 'istighfar' };
  const cat = ADHKAR_CATEGORIES.find((candidate) => candidate.id === category && candidate.items.length > 0);
  if (cat) return { items: cat.items, categoryId: cat.id };
  return {
    items: [{ id: 'fallback', text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', count: 1, reference: 'ذكر عام' }],
    categoryId: 'adhkar',
  };
}

/** FNV-1a over a short label, so a (category, day) pair always seeds the same order. */
function seedFrom(label: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG, so the day's order survives a reschedule. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates with a seeded RNG: the same items, a different order each day. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const order = items.slice();
  const random = seededRandom(seed);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The reminder rotation.
 *
 * Every reschedule calls this for the slots it is about to arm. Each category gets a
 * *shuffled-per-day* order that the calls then walk one item at a time, so a reminder
 * never repeats the previous one, every dhikr of a collection is seen before any of them
 * comes round again, and the sequence is fresh tomorrow. The seed is the category and the
 * date, so rescheduling the queue — which happens on every open — does not reshuffle what
 * a slot already shows.
 */
export function createDhikrRotation(): (
  category: DhikrReminderCategory,
  at: Date,
) => { dhikr: Dhikr; categoryId: string } {
  const rotations = new Map<DhikrReminderCategory, { day: string; order: Dhikr[]; categoryId: string }>();
  const cursors = new Map<DhikrReminderCategory, number>();
  const lastId = new Map<DhikrReminderCategory, string>();

  return (category, at) => {
    const day = `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
    let rotation = rotations.get(category);
    if (!rotation || rotation.day !== day) {
      const pool = dhikrPool(category);
      rotation = {
        day,
        order: shuffled(pool.items, seedFrom(`${category}:${day}`)),
        categoryId: pool.categoryId,
      };
      rotations.set(category, rotation);
    }

    const cursor = cursors.get(category) ?? 0;
    let index = cursor % rotation.order.length;
    // Across midnight a new order can place the same item where the old one left off;
    // step past it so two reminders in a row never carry the same dhikr.
    if (rotation.order.length > 1 && rotation.order[index].id === lastId.get(category)) {
      index = (index + 1) % rotation.order.length;
    }
    const dhikr = rotation.order[index];
    lastId.set(category, dhikr.id);
    cursors.set(category, index + 1);
    return { dhikr, categoryId: rotation.categoryId };
  };
}

/**
 * Classify dhikr as "short" (fits fully in expanded notification) or "long" (needs deep link).
 * Threshold: ~180 chars — short dhikr like tasbih/istighfar fit; long ones like Ayat al-Kursi don't.
 */
function isShortDhikr(dhikr: Dhikr): boolean {
  return dhikr.text.length <= 180;
}

/**
 * Build the notification payload for a dhikr reminder.
 * Short dhikr: full text in largeBody (BigTextStyle), tap dismisses.
 * Long dhikr: excerpt in body, full text in largeBody with "…", tap opens that dhikr in app.
 */
function buildDhikrNotification(
  dhikr: Dhikr,
  category: DhikrReminderCategory,
  slot: number,
  dayOffset: number,
  reminderSound: string | undefined,
  categoryId: string,
): LocalNotificationSchema {
  const short = isShortDhikr(dhikr);
  const notificationIdValue = notificationId.dhikr(dayOffset * 1000 + slot);
  const base = {
    id: notificationIdValue,
    title: category === 'istighfar' ? 'تذكير بالاستغفار' : `أذكار ${category === 'morning' ? 'الصباح' : 'المساء'}`,
    channelId: 'azkar',
    schedule: { at: new Date(), allowWhileIdle: true }, // placeholder, set by caller
    sound: reminderSound,
    ...NOTIFICATION_BRAND,
    extra: { type: 'dhikr', category, categoryId, dhikrId: dhikr.id },
  };

  if (short) {
    // Short dhikr — show full text in expanded notification, no deep link needed
    return {
      ...base,
      body: dhikr.text,
      largeBody: dhikr.text,
      summaryText: dhikr.reference,
    };
  } else {
    // Long dhikr — show excerpt, tap opens the specific dhikr in app
    const excerpt = dhikr.text.slice(0, 160).trimEnd() + '…';
    return {
      ...base,
      body: excerpt,
      largeBody: dhikr.text,
      summaryText: `${dhikr.reference} — اضغط للقراءة الكاملة`,
    };
  }
}

function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * A configured `'HH:MM'` settings row as the wall-clock fields to arm.
 *
 * The fallback is the hour the notification used before the row existed. An empty
 * or malformed value — a row from an older install, or a hand-edited backup —
 * therefore keeps the notification where it always was, rather than sliding it to
 * midnight.
 */
function configuredClockTime(
  value: string | undefined,
  fallbackHour: number,
): { hour: number; minute: number } {
  const minutes = timeToMinutes(value ?? '');
  if (minutes === null) return { hour: fallbackHour, minute: 0 };
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

/**
 * The channel the adhan itself rings on.
 *
 * `prayer-muted` when the reader switched the adhan's sound off — that channel is
 * silent by design, so it is never probed for a sound and never repaired. Exported
 * because the settings banner has to ask the system about this exact channel, and it
 * must not re-derive the id by hand: a drift between the two would have the banner
 * reporting on a channel nothing rings on.
 */
export function adhanChannelId(settings: Settings): string {
  return settings.adhanSound ? `prayer-${usableAdhanSound(settings.adhanVoiceId).id}` : 'prayer-muted';
}

export async function createNotificationChannels(settings: Settings): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  // The chosen voice may be one the user downloaded; knowing what is on disk decides
  // which of the two channel builders below can describe it.
  await ensureAdhanVoicesLoaded();
  const adhan = usableAdhanSound(settings.adhanVoiceId);
  const storedPath = await resolveAdhanSoundPath(adhan);
  if (storedPath) {
    // A downloaded voice has no res/raw entry, so the plugin's builder would point the
    // channel at a resource that isn't there and the prayer would arrive silent. The
    // native side publishes the stored file through the FileProvider instead.
    await setAdhanChannel({
      id: `prayer-${adhan.id}`,
      name: `الأذان — ${adhan.name}`,
      description: 'تنبيه عند دخول وقت الصلاة',
      soundPath: storedPath,
    });
  } else {
    await LocalNotifications.createChannel({
      id: `prayer-${adhan.id}`,
      name: `الأذان — ${adhan.name}`,
      description: 'تنبيه عند دخول وقت الصلاة',
      importance: 4,
      sound: adhan.file,
      vibration: true,
      visibility: 1,
    });
  }
  await LocalNotifications.createChannel({
    id: 'prayer-muted',
    name: 'مواقيت الصلاة — دون صوت',
    description: 'تنبيه صامت عند دخول وقت الصلاة',
    // High importance without a sound: the full-screen takeover needs it, so the adhan
    // page still opens itself at prayer time for users who silenced the adhan.
    importance: 4,
    vibration: true,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'prayer-reminder',
    name: 'تذكير قبل الصلاة',
    description: 'تذكير صامت قبل وقت الصلاة',
    importance: 2,
    vibration: true,
    visibility: 1,
  });
  await applyNotificationVoiceChannels(settings);
}

/**
 * Put the sound back on a prayer channel that exists but is silent.
 *
 * This is the state Android hands an app that created the channel before its sound
 * existed — and it is exactly what the native receiver's own fallback used to do: when
 * an alarm fired for a channel that was not there, `ensureChannel()` minted one with
 * **no** sound, and a later `createChannel` with a sound cannot change it, because a
 * channel is immutable from the moment it exists. Delete-then-create is the only route
 * back, the same one the reminder channels already use when the voice changes. The
 * reader's own per-channel preferences are lost with the old channel, which is the
 * price of a channel that could not ring at all.
 */
async function rebuildSilentPrayerChannel(settings: Settings): Promise<void> {
  const adhan = usableAdhanSound(settings.adhanVoiceId);
  const id = `prayer-${adhan.id}`;
  try {
    await LocalNotifications.deleteChannel({ id });
  } catch {
    // Not readable as an existing channel (Android < 8): recreating is still safe.
  }
  try {
    const storedPath = await resolveAdhanSoundPath(adhan);
    if (storedPath) {
      await setAdhanChannel({
        id,
        name: `الأذان — ${adhan.name}`,
        description: 'تنبيه عند دخول وقت الصلاة',
        soundPath: storedPath,
      });
    } else {
      await LocalNotifications.createChannel({
        id,
        name: `الأذان — ${adhan.name}`,
        description: 'تنبيه عند دخول وقت الصلاة',
        importance: 4,
        sound: adhan.file,
        vibration: true,
        visibility: 1,
      });
    }
    notifyNotificationWarning('channel-silent');
  } catch (err) {
    console.error('Could not recreate the silent prayer channel:', err);
    notifyNotificationWarning('channel-failed');
  }
}

/** The channels a reminder lands in — the ones whose sound the picker owns. */
const REMINDER_CHANNELS: Array<{
  id: string;
  name: string;
  description: string;
  importance: Importance;
}> = [
  { id: 'hifz', name: 'الحفظ', description: 'تذكيرات حفظ القرآن', importance: 4 },
  { id: 'review', name: 'المراجعة', description: 'تذكيرات مراجعة القرآن', importance: 4 },
  { id: 'hadith', name: 'حديث اليوم', description: 'تنبيه حديث اليوم', importance: 3 },
  { id: 'quran', name: 'رسالة القرآن', description: 'رسالة يومية من القرآن', importance: 3 },
  { id: 'sunnah', name: 'سنن عن النبي', description: 'سنّة يومية عن النبي ﷺ', importance: 3 },
  { id: 'prophet', name: 'النبي محمد ﷺ', description: 'معلومات عن النبي ﷺ', importance: 3 },
  { id: 'azkar', name: 'الأذكار', description: 'تذكيرات أذكار الصباح والمساء', importance: 3 },
];

/** Which voice the reminder channels were last built with (see below). */
const NOTIFICATION_VOICE_APPLIED_KEY = 'zad:notification-voice-applied';

/**
 * The stamp the memo is compared against: the voice *and* the set of channel ids.
 *
 * The memo used to hold only the voice id, so an upgrade that adds a channel (the
 * daily Qur'an / Sunnah / Prophet ones did) found the old voice still "applied" and
 * returned early — the new ids were never created, and Android then drops every
 * notification posted to a channel that does not exist. The ids are part of the
 * stamp, so any change to the channel set rebuilds them once, while the user's own
 * per-channel preferences still survive a rebuild that changes nothing.
 */
function notificationChannelsStamp(voiceId: string): string {
  return `${voiceId}#${REMINDER_CHANNELS.map((channel) => channel.id).join(',')}`;
}

function appliedNotificationChannelsStamp(): string | null {
  try {
    return localStorage.getItem(NOTIFICATION_VOICE_APPLIED_KEY);
  } catch {
    return null;
  }
}

function rememberNotificationChannelsStamp(stamp: string): void {
  try {
    localStorage.setItem(NOTIFICATION_VOICE_APPLIED_KEY, stamp);
  } catch {
    // Private mode: the channels still ring, they are simply rebuilt next time too.
  }
}

/**
 * Point the reminder channels at the chosen voice.
 *
 * On Android 8+ a channel's sound is fixed the moment the channel is created:
 * calling `createChannel` again with a different sound updates the name and the
 * description and leaves the old sound in place — which is why the per-notification
 * `sound` these reminders used to carry never rang for anyone on a modern device. The
 * only way to change what a reminder sounds like is to delete the channel and create
 * it again, so the applied voice is remembered and that pair is paid for only when the
 * choice has actually changed.
 *
 * Recreating a channel also throws away the user's own per-channel preferences for it
 * (vibration off, or «صامت» chosen in the system settings), which is why it is not
 * done on every queue rebuild.
 */
async function applyNotificationVoiceChannels(settings: Settings): Promise<void> {
  // The master switch wins: a silent reminders setting means silent channels, whatever
  // voice is stored behind it.
  const voice = settings.notificationSound
    ? usableNotificationVoice(settings.notificationVoiceId, downloadedAdhanVoiceIds())
    : getNotificationVoice(NOTIFICATION_VOICE_NONE);
  const stamp = notificationChannelsStamp(voice.id);
  if (appliedNotificationChannelsStamp() === stamp) return;

  // A downloaded adhan voice has no res/raw entry, so the plugin's builder would name a
  // resource that is not there and the reminder would arrive silent. The native side
  // publishes the stored file through the FileProvider instead — or, if the file has
  // gone since it was chosen, the app's own chime stands in.
  const target = voice;
  const soundPath: string | null = null;
  // Message ringtones are all bundled, so there is no downloaded file to resolve.

  for (const channel of REMINDER_CHANNELS) {
    try {
      await LocalNotifications.deleteChannel({ id: channel.id });
    } catch {
      // Never created (or Android < 8, where channels do not exist): nothing to remove.
    }
  }

  for (const channel of REMINDER_CHANNELS) {
    if (target.silent) {
      await LocalNotifications.createChannel({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        importance: channel.importance,
        vibration: true,
        visibility: 1,
      });
      continue;
    }
    if (soundPath) {
      await setAdhanChannel({
        id: channel.id,
        name: channel.name,
        description: channel.description,
        soundPath,
        importance: channel.importance,
      });
      continue;
    }
    await LocalNotifications.createChannel({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      importance: channel.importance,
      sound: target.file,
      vibration: true,
      visibility: 1,
    });
  }

  rememberNotificationChannelsStamp(notificationChannelsStamp(target.id));
}

/**
 * The sound named on old devices' per-notification alerts.
 *
 * Android 7 and older have no channels at all, so there `setSound` on the notification
 * is what rings — and it can only resolve a bundled file (res/raw or a web asset), never
 * a stored one. On Android 8+ this value is ignored the moment the notification names a
 * channel, which every one of these does.
 */
function reminderNotificationSound(settings: Settings): string | undefined {
  if (!settings.notificationSound) return undefined;
  const voice = usableNotificationVoice(settings.notificationVoiceId, downloadedAdhanVoiceIds());
  return voice.silent || !voice.bundled ? undefined : voice.file;
}

/**
 * Rebuild every pending notification from the current settings.
 *
 * Safe to call repeatedly — it swaps the whole queue in one cancel/schedule pair, so it
 * doubles as the reschedule-on-resume hook (Android drops pending alarms across
 * reboots, and stale rows would otherwise accumulate). The only notifications kept
 * through the swap are active snoozes the user asked for. A failed swap restores the
 * previous queue rather than leaving the adhan silent.
 *
 * Every call runs on one shared chain (below): two rebuilds interleaving is exactly how
 * an armed batch gets cancelled out from under the rebuild that just scheduled it,
 * leaving the queue empty until the next resume. Serialising them means the last
 * rebuild wins, and no rebuild can cancel another's work mid-flight.
 */
let rebuildChain: Promise<void> = Promise.resolve();

export async function rescheduleAllNotifications(): Promise<void> {
  const run = rebuildChain.then(rebuildNotifications, rebuildNotifications);
  // The chain must never break: a failed rebuild is reported by its own warning, and
  // the next call has to be able to run regardless.
  rebuildChain = run.catch(() => {});
  return run;
}

async function rebuildNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Scheduling without the grant rejects the call (and would cancel-first for nothing),
  // so bail out before touching the running queue.
  if (!(await hasNotificationPermission())) {
    console.info('Notification permission not granted — skipping reschedule');
    return;
  }

  // Exact alarms are what makes the adhan sound at the prayer minute while the app is
  // closed. When the permission is revoked the plugin's schedule() would pop the system
  // «Alarms & reminders» page mid-resume — so leave the already-armed queue exactly as
  // it is, tell the user (Settings shows the fix), and try again once it is granted.
  if (!(await canScheduleExactAlarms())) {
    console.warn('Exact-alarm permission denied — keeping the existing notification queue.');
    notifyNotificationWarning('exact-alarm-denied');
    return;
  }

  const settings = await getSettings();

  // Rebuild in two phases:
  //  1. Build — every fallible read (settings, tasks) and every notification object,
  //     gathered into ONE batch. A failure here leaves the running queue untouched.
  //  2. Swap — snapshot the queue, cancel it, schedule the batch. If the schedule call
  //     rejects (notifications switched off between the check above and now, plugin
  //     error), the snapshot is put back so a failed rebuild can never silence the
  //     adhan: previously `cancelAll()` ran first and the swallowed error meant nothing
  //     was re-armed until the next successful open.
  //
  // Built as separate priority buckets rather than one array: the ceiling is applied
  // once, at assembly (assembleNotificationQueue), and only separate buckets let the
  // trim eat the filler while the adhan's fallbacks stay untouched at the front.
  const prePrayerReminders: LocalNotificationSchema[] = [];
  const iqamahAlerts: LocalNotificationSchema[] = [];
  const hifzReviewReminders: LocalNotificationSchema[] = [];
  const taskReminders: LocalNotificationSchema[] = [];
  const hadithReminders: LocalNotificationSchema[] = [];
  const dhikrFiller: LocalNotificationSchema[] = [];

  // The native alarm posts into the prayer channel, so do not replace the working
  // queue with alarms that may open a silent page if channel creation failed.
  try {
    await createNotificationChannels(settings);
  } catch (err) {
    console.error('Could not create notification channels:', err);
    notifyNotificationWarning('channel-failed');
    return;
  }

  // …and then ask the device whether that channel really carries a sound. Creating a
  // channel is not the same as having one that rings: an install created the prayer
  // channel long before the adhan sound existed, and Android fixes a channel's sound
  // the instant it exists — no later createChannel call can put it back. Every alarm
  // armed below would then post a card nobody hears, which is the reported «التنبيه
  // بيوصل من غير صوت» exactly. The check runs on every rebuild because an update or a
  // cleared cache can reintroduce it at any moment. A channel the reader muted
  // themselves is a preference, not a bug, and is left alone.
  if (settings.adhanSound) {
    const status = await getProtectionStatus(adhanChannelId(settings));
    // A channel the reader silenced themselves is a choice, not a bug: rebuilding it
    // would put a sound back they had asked to remove. Only the app's own mistake —
    // a channel that was born without a sound — is repaired here.
    if (status?.channelSoundOk === false && status?.channelMuted !== true) {
      console.warn('[notify] prayer channel has no sound — rebuilding it');
      await rebuildSilentPrayerChannel(settings);
    }
  }

  // The reminder voice, resolved once: Android 7 and older have no channels, so there
  // the sound has to be named on each notification instead.
  const reminderSound = reminderNotificationSound(settings);

  /**
   * Android fires an alarm when the *device* clock reaches the target, so a
   * phone whose clock has drifted from the trusted instant would sound every
   * alarm shifted by exactly that drift. Each true instant below is armed with
   * the drift added, which lands the sound on the real moment regardless of
   * what the phone's clock now claims.
   */
  const drift = deviceClockDriftMs();
  const armedAt = (instant: Date) => new Date(toDeviceClock(instant.getTime(), drift));

  // 1. Native prayer alarms for the next PRAYER_NOTIFICATION_DAYS days.
  //
  // Native alarms are kept for a month so the adhan — and now the iqamah — continues if
  // the app is not opened for a while. The notification fallbacks remain a separate,
  // shorter window because they share the bounded queue with the rest of the app.
  //
  // On Android the prayer alert itself is armed natively (full-screen intent — see
  // @/utils/adhanOverlay): that is what lets the adhan *page* open while the app is
  // closed, and the جماعة is armed the same way under its own type. The sound
  // notifications below are kept as the fallback for the case where that native arming
  // fails, so neither goes silent either way.
  const overlayAlarms: AdhanOverlayAlarm[] = [];
  const prayerFallbacks: LocalNotificationSchema[] = [];
  if (settings.latitude != null && settings.longitude != null) {
    const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
    const firstDay = calendarDayInZone(trustedNow(), timeZone);
    const now = trustedNowMs();
    const adhan = usableAdhanSound(settings.adhanVoiceId);
    const channelId = settings.adhanSound ? `prayer-${adhan.id}` : 'prayer-muted';
    // The channel's sound travels with each alarm, so the receiver can build the
    // channel *with* it when the channel is missing. Android fixes a channel's sound at
    // creation, so a receiver-minted silent channel is silent for good — this is what
    // keeps the fallback ringing instead of posting a card nobody hears.
    //
    // Exactly one of the two carries the voice: a bundled one is its res/raw name, a
    // downloaded one is the stored path the FileProvider publishes (it has no res/raw
    // entry). When the reader silenced the adhan, neither rides — `prayer-muted` is
    // silent by design, and the receiver must not resurrect a sound it was told to drop.
    const adhanSoundPath = settings.adhanSound && !adhan.bundled
      ? await resolveAdhanSoundPath(adhan)
      : null;
    const adhanSound = settings.adhanSound && adhan.bundled ? adhan.file : undefined;
    // One slot number per prayer, shared by the prayer alert and its reminder: the two
    // live in disjoint id ranges, while every prayer across the window gets its own.
    let armSlot = 0;
    for (let dayOffset = 0; dayOffset < PRAYER_NOTIFICATION_DAYS; dayOffset += 1) {
      const dayPrayers = calculatePrayerTimesForDay(
        settings.latitude,
        settings.longitude,
        addCalendarDays(firstDay, dayOffset),
        settings.calcMethod,
        settings.asrMadhab,
        settings.prayerTimeAdjustments,
      );

      for (const prayer of dayPrayers.prayers) {
        const slot = armSlot++;
        if (prayer.name === 'sunrise') continue;

        // The daily-repeat alerts stop at DAILY_ALERT_DAYS: they are five-per-day
        // buckets, and a month of them would fill the queue on its own (see the
        // constant). The adhan itself keeps the full horizon above.
        const withinDailyAlerts = dayOffset < DAILY_ALERT_DAYS;
        if (prayer.time.getTime() <= now) continue;

        const title = `حان وقت صلاة ${prayer.arabicName}`;
        const body = `${formatTime12h(prayer.time, timeZone)} — تقبّل الله صلاتك`;

        overlayAlarms.push({
          id: notificationId.prayer(slot),
          at: armedAt(prayer.time).getTime(),
          channelId,
          title,
          body,
          prayerKey: prayer.name,
          prayerName: prayer.arabicName,
          time: prayer.time.toISOString(),
          type: 'prayer',
          // Nothing rides when the reader silenced the adhan: `prayer-muted` is silent
          // by design, and the receiver must not resurrect a sound it was told to drop.
          sound: adhanSound,
          soundPath: adhanSoundPath ?? undefined,
        });
        if (dayOffset < PRAYER_FALLBACK_DAYS) {
          prayerFallbacks.push({
            id: notificationId.prayer(slot),
            title,
            body,
            schedule: { at: armedAt(prayer.time), allowWhileIdle: true },
            channelId,
            // Only a bundled voice can ride the plugin's per-notification sound, which
            // resolves resources; a downloaded one already rings through its channel.
            sound: settings.adhanSound && adhan.bundled ? adhan.file : undefined,
            ...NOTIFICATION_BRAND,
            extra: {
              type: 'prayer',
              prayerKey: prayer.name,
              prayerName: prayer.arabicName,
              time: prayer.time.toISOString(),
            },
          });
        }

        // Pre-prayer reminder
        if (withinDailyAlerts && settings.prePrayerReminder > 0) {
          const reminderTime = new Date(prayer.time.getTime() - settings.prePrayerReminder * 60000);
          if (reminderTime.getTime() > now) {
            prePrayerReminders.push({
              id: notificationId.reminder(slot),
              title: `صلاة ${prayer.arabicName} بعد ${settings.prePrayerReminder} دقيقة`,
              body: `استعد — وقتها ${formatTime12h(prayer.time, timeZone)}`,
              schedule: { at: armedAt(reminderTime), allowWhileIdle: true },
              channelId: 'prayer-reminder',
              ...NOTIFICATION_BRAND,
              extra: {
                type: 'prayer-reminder',
                prayerKey: prayer.name,
                prayerName: prayer.arabicName,
                time: prayer.time.toISOString(),
              },
            });
          }
        }
      }
    }
  }

  // 2. Today's task notifications (hifz / review) — ahead of the dhikr filler, so
  //    they win the queue cap (see MAX_SCHEDULED_NOTIFICATIONS).
  await generateDailyTasks();
  const tasks = await getTodayTasks();

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'missed') continue;
    const scheduledAt = task.status === 'snoozed' && task.snoozedUntil
      ? new Date(task.snoozedUntil)
      : new Date(`${task.date}T${task.scheduledTime}:00`);
    if (scheduledAt <= trustedNow()) continue;

    const typeText = task.type === 'hifz' ? 'الحفظ' : 'المراجعة';
    taskReminders.push({
      id: notificationId.task(task.id ?? 0),
      title: `حان وقت ${typeText}`,
      body: `${describePortion(task.portion)} — وردك في ${typeText} اليوم`,
      schedule: { at: armedAt(scheduledAt), allowWhileIdle: true },
      channelId: task.type === 'hifz' ? 'hifz' : 'review',
      sound: reminderSound,
      ...NOTIFICATION_BRAND,
      extra: {
        type: 'task',
        taskId: task.id,
        taskType: task.type,
        portion: task.portion,
      },
    });
  }

  // Spaced-repetition reviews are scheduled from the quiz's next due instant.
  // The short horizon and cap keep them from crowding out today's planned work.
  const reviewNow = trustedNowMs();
  const reviewHorizon = reviewNow + PRAYER_NOTIFICATION_DAYS * 24 * 60 * 60_000;
  const reviews = await db.hifzReviews
    .where('dueAt')
    .above(reviewNow)
    .and((review) => Number.isFinite(review.dueAt) && review.dueAt <= reviewHorizon)
    .limit(MAX_HIFZ_REVIEW_REMINDERS)
    .toArray();
  reviews.forEach((review, slot) => {
    const portion = `surah:${review.surahId}:${review.fromAyah}-${review.toAyah}`;
    hifzReviewReminders.push({
      id: notificationId.hifzReview(slot),
      title: 'موعد مراجعة حفظك',
      body: `${describePortion(portion)} — اختبر حفظك وثبّته`,
      schedule: { at: armedAt(new Date(review.dueAt)), allowWhileIdle: true },
      channelId: 'review',
      sound: reminderSound,
      ...NOTIFICATION_BRAND,
      extra: {
        type: 'hifz-review',
        surahId: review.surahId,
        fromAyah: review.fromAyah,
        toAyah: review.toAyah,
      },
    });
  });

  // 3. The daily content notifications, armed for the next several days:
  //    the hadith of the day (09:00), the Qur'an message (10:00), a Sunnah about the
  //    Prophet ﷺ (14:00) and a fact about him ﷺ (16:00).
  //
  //    The queue is rebuilt when the app opens, so a *today only* horizon made all of
  //    these stop the moment the app stayed closed for a day — which is exactly what a
  //    user reads as «الإشعارات مش شغالة». The native prayer alarms keep a month for
  //    the same reason; these keep a few days, bounded below by what still has to fit.
  //
  //    The bound is spent on the buckets ranked above them (tasks, spaced reviews,
  //    pre-prayer reminders) first, and only *today's* four join the hadith block:
  //    the days still to come travel in their own bucket, ranked just ahead of the
  //    dhikr filler, so a queue that fills up gives up its farthest day long before
  //    it gives up the جماعة or tomorrow's task.
  const contentBudget = Math.max(
    0,
    MAX_SCHEDULED_NOTIFICATIONS
      - taskReminders.length
      - hifzReviewReminders.length
      - prePrayerReminders.length
      - iqamahAlerts.length,
  );
  /** The next days' four-per-day content; see {@link NotificationQueueParts}. */
  const futureContentReminders: LocalNotificationSchema[] = [];
  const sunnahItems: SunnahItem[] = SUNNAH_CATEGORIES.flatMap((category) => category.items);
  const prophetEntries: ProphetEntry[] = PROPHET_SECTIONS.flatMap((section) => section.entries);
  /** Seeded so re-arming the queue never swaps the verse of the day under the user. */
  const seededRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  };
  /**
   * Future days are picked without touching the real store: `getDailyQuranMessage`
   * persists whatever it chooses, and arming a week ahead would otherwise overwrite
   * today's verse (the one the home screen shows) with a future day's.
   */
  const ephemeralStorage: DailyMessageStorage = { getItem: () => null, setItem: () => {} };
  const queueNow = trustedNow();
  const dayNumber = Math.floor(trustedNowMs() / 86_400_000);
  let contentSlot = 0;

  /**
   * The hour each of the four arrives, as set in Settings — with the hour it had
   * before the setting existed as its default, so an install whose rows are still
   * empty keeps waking to the same clock it always did.
   */
  const contentTimes = {
    hadith: configuredClockTime(settings.hadithNotificationTime, 9),
    quran: configuredClockTime(settings.quranMessageTime, 10),
    sunnah: configuredClockTime(settings.sunnahNotificationTime, 14),
    prophet: configuredClockTime(settings.prophetNotificationTime, 16),
  };

  const contentCount = () => hadithReminders.length + futureContentReminders.length;
  /** Only *today's* content belongs to the hadith block; the rest waits its turn. */
  const pushContent = (notification: LocalNotificationSchema) => {
    const dayOffset = (notification.extra?.dayOffset as number | undefined) ?? 0;
    (dayOffset === 0 ? hadithReminders : futureContentReminders).push(notification);
  };

  for (
    let dayOffset = 0;
    dayOffset < CONTENT_NOTIFICATION_DAYS && contentCount() < contentBudget;
    dayOffset += 1
  ) {
    const dayDate = new Date(queueNow);
    dayDate.setDate(dayDate.getDate() + dayOffset);
    const atTime = ({ hour, minute }: { hour: number; minute: number }): Date => {
      const at = new Date(dayDate);
      at.setHours(hour, minute, 0, 0);
      return at;
    };
    const claim = () => contentCount() < contentBudget;

    // Hadith of the day. Its clock is a *true* instant derived from trustedNow():
    // Android fires when the *device* clock reaches the target, so it carries the
    // drift like every other entry here — without it the hadith sounded drift-shifted
    // while every prayer alarm around it was corrected.
    const hadithTime = atTime(contentTimes.hadith);
    if (hadithTime > queueNow && claim()) {
      pushContent({
        id: notificationId.hadith(contentSlot++),
        title: 'حديث اليوم',
        body: 'حديثٌ مختار لك اليوم — اقرأه في دقيقة',
        schedule: { at: armedAt(hadithTime), allowWhileIdle: true },
        channelId: 'hadith',
        sound: reminderSound,
        ...NOTIFICATION_BRAND,
        extra: { type: 'hadith', dayOffset },
      });
    }

    // The Qur'an message of the day — one verse, read where it belongs.
    const quranTime = atTime(contentTimes.quran);
    if (quranTime > queueNow && claim()) {
      try {
        const message = getDailyQuranMessage(
          dayDate,
          dayOffset === 0 ? undefined : ephemeralStorage,
          seededRandom(dayNumber + dayOffset),
        );
        const text = message.text.length > 120 ? `${message.text.slice(0, 117)}…` : message.text;
        pushContent({
          id: notificationId.hadith(contentSlot++),
          title: 'رسالة اليوم من القرآن',
          body: `${text} — سورة ${message.surahName}`,
          schedule: { at: armedAt(quranTime), allowWhileIdle: true },
          channelId: 'quran',
          sound: reminderSound,
          ...NOTIFICATION_BRAND,
          extra: {
            type: 'quran-message',
            surahId: message.surahId,
            ayahNumber: message.ayahNumber,
            dayOffset,
          },
        });
      } catch (err) {
        console.warn('Could not schedule the daily Quran message notification:', err);
      }
    }

    // A Sunnah of the day, rotated through the narration library.
    const sunnahTime = atTime(contentTimes.sunnah);
    if (sunnahTime > queueNow && sunnahItems.length > 0 && claim()) {
      const item = sunnahItems[(dayNumber + dayOffset) % sunnahItems.length];
      pushContent({
        id: notificationId.hadith(contentSlot++),
        title: item.title || 'سنّة عن النبي ﷺ',
        body: item.text || item.benefit || '',
        schedule: { at: armedAt(sunnahTime), allowWhileIdle: true },
        channelId: 'sunnah',
        sound: reminderSound,
        ...NOTIFICATION_BRAND,
        extra: { type: 'sunnah', dayOffset },
      });
    }

    // A fact about the Prophet ﷺ from the Prophet page.
    const prophetTime = atTime(contentTimes.prophet);
    if (prophetTime > queueNow && prophetEntries.length > 0 && claim()) {
      const entry = prophetEntries[(dayNumber + dayOffset) % prophetEntries.length];
      pushContent({
        id: notificationId.hadith(contentSlot++),
        title: entry.title || 'النبي محمد ﷺ',
        body: entry.text || entry.hint || '',
        schedule: { at: armedAt(prophetTime), allowWhileIdle: true },
        channelId: 'prophet',
        sound: reminderSound,
        ...NOTIFICATION_BRAND,
        extra: { type: 'prophet', dayOffset },
      });
    }
  }

  // 4. Random text-only dhikr reminders for today and tomorrow — the queue's
  //    filler. They are generated only for as many slots as the certainly-armed
  //    buckets leave free, so a full queue drops tomorrow's dhikr rather than a
  //    prayer or a task. The fallbacks claim nothing here: they are conditional
  //    on the takeover failing, and assembly ranks them first when it does —
  //    see dhikrFillerBudget.
  if (settings.randomDhikrEnabled) {
    const startMinute = timeToMinutes(settings.randomDhikrStartTime);
    const endMinute = timeToMinutes(settings.randomDhikrEndTime);
    const interval = settings.randomDhikrIntervalMinutes;
    if (
      startMinute === null ||
      endMinute === null ||
      ![15, 30, 60, 120].includes(interval)
    ) {
      console.error('Invalid random dhikr reminder settings; reminders were not scheduled.');
    } else {
      const duration = (endMinute - startMinute + 1440) % 1440;
      const now = trustedNow();
      const nextDhikr = createDhikrRotation();
      const budget = dhikrFillerBudget(
        {
          taskReminders,
          hadithReminders,
          iqamahAlerts,
          hifzReviewReminders,
          prePrayerReminders,
          futureContentReminders,
        },
        MAX_SCHEDULED_NOTIFICATIONS,
      );

      if (duration > 0 && budget > 0) {
        let armed = 0;
        for (let dayOffset = 0; dayOffset < 2 && armed < budget; dayOffset += 1) {
          const windowStart = trustedNow();
          windowStart.setHours(0, 0, 0, 0);
          windowStart.setDate(windowStart.getDate() + dayOffset);
          windowStart.setMinutes(startMinute);
          const windowEnd = new Date(windowStart.getTime() + duration * 60000);

          for (
            let at = new Date(windowStart.getTime()), slot = 0;
            at < windowEnd && armed < budget;
            at = new Date(at.getTime() + interval * 60000), slot += 1
          ) {
            if (at <= now) continue;
            const category = getDhikrReminderCategory(settings.randomDhikrCategory, at, slot);
            const { dhikr, categoryId } = nextDhikr(category, at);
            const notif = buildDhikrNotification(dhikr, category, slot, dayOffset, reminderSound, categoryId);
            notif.schedule = { at: armedAt(at), allowWhileIdle: true };
            dhikrFiller.push(notif);
            armed += 1;
          }
        }
      }
    }
  }

  // One line describing what this rebuild actually produced — the only way to tell,
  // from a log, whether an entry was never built (a throw above) or built and refused
  // by the platform (a rejection below).
  console.log(
    '[notify] built',
    JSON.stringify({
      prayerFallbacks: prayerFallbacks.length,
      iqamah: iqamahAlerts.length,
      overlay: overlayAlarms.length,
      tasks: taskReminders.length,
      reviews: hifzReviewReminders.length,
      content: hadithReminders.map(
        (notification) => `${notification.title}@${(notification.schedule?.at as Date | undefined)?.toISOString?.() ?? '?'}`,
      ),
      prePrayer: prePrayerReminders.length,
      futureContent: futureContentReminders.length,
      dhikr: dhikrFiller.length,
    }),
  );

  // --- Swap phase: one cancel, one schedule, restore on failure. -------------
  // The snapshot is taken first so a rejected schedule() can put the previous queue
  // back instead of leaving nothing armed at all. Active snoozes (the adhan overlay's
  // «تذكير بعد 10 دقائق») are deliberately kept through the cancel — every resume
  // rebuilds the queue, and the old unconditional cancel-all silently deleted the
  // reminder the user had just asked for.
  //
  // The native takeover alarms are armed first, because their outcome decides whether
  // the prayer entries belong in the queue at all: a device where the full-screen
  // path is unavailable still gets the adhan, just without the page opening itself.
  let previousQueue: LocalNotificationSchema[] = [];
  try {
    previousQueue = (await LocalNotifications.getPending()).notifications;
  } catch (err) {
    console.warn('Could not snapshot the pending notification queue:', err);
  }

  // Whether the takeover alarms can be trusted to speak for the adhan.
  //
  // Arming is not the same as being armed. Android 12+ can refuse exact alarms, an OEM
  // cleaner can drop the batch the instant it is written, and a downgraded (inexact)
  // alarm fires whenever the phone wakes — which for an adhan is the same as not
  // ringing. The native side answers by asking the platform itself rather than trusting
  // the return of the arming call, and that answer decides whether the sound fallbacks
  // below are needed at all. Assuming success (as this used to) is what left a phone
  // with neither a takeover nor a sound notification: «التنبيه وصل من غير صوت».
  let overlayArmed = true;
  try {
    const result: AdhanScheduleResult = await scheduleAdhanOverlay(overlayAlarms);
    overlayArmed = result.verified && !result.inexact;
    if (!overlayArmed) {
      console.warn(
        `[notify] adhan takeover not verified (armed=${result.armed}, inexact=${result.inexact}) — keeping sound fallbacks`,
      );
      notifyNotificationWarning('scheduled-inexact');
    }
  } catch (err) {
    // Takeover unavailable (old install, native error): keep the sound notifications.
    console.error('Adhan overlay arming failed — falling back to sound notifications.', err);
    overlayArmed = false;
  }

  // One assembly, one cap: both fallbacks join only when the takeover failed, and the
  // trim eats the filler first, so a full queue drops far-future dhikr and reminders
  // rather than the adhan or today's tasks — the previous build capped only the
  // filler, then pushed the fallbacks last, so an over-full day had Android drop the
  // very alerts meant to cover for the failed takeover.
  const scheduled = assembleNotificationQueue(
    {
      prayerFallbacks: overlayArmed ? [] : prayerFallbacks,
      taskReminders,
      hadithReminders,
      iqamahAlerts: overlayArmed ? [] : iqamahAlerts,
      hifzReviewReminders,
      prePrayerReminders,
      futureContentReminders,
      dhikrFiller,
    },
    MAX_SCHEDULED_NOTIFICATIONS,
  );

  try {
    await cancelAllNotifications(preserveActiveSnooze);
    if (scheduled.length > 0) {
      const result = (await LocalNotifications.schedule({ notifications: scheduled })) as unknown as
        { warning?: unknown } | void;
      console.log('[notify] armed', scheduled.length, 'notifications');
      console.log('[notify] armed list', scheduled.map((n) => `${n.extra?.type ?? '?'}@${(n.schedule?.at as Date)?.toISOString?.() ?? '?'}`));
      // The plugin reports a refused downgrade (e.g. the exact-alarm permission
      // vanished mid-call) as `warning` — a string on some versions, an object
      // with details on others. Its mere presence means the alarms will still
      // fire but possibly late in sleep mode, which the user must be told.
      const warning = result && typeof result === 'object' ? result.warning : undefined;
      if (warning) {
        console.warn('Notifications were scheduled inexact:', warning);
        notifyNotificationWarning('scheduled-inexact');
      } else {
        notifyNotificationWarning('schedule-ready');
      }
    } else {
      notifyNotificationWarning('schedule-ready');
    }
  } catch (err) {
    console.error('Scheduling notifications failed — restoring the previous queue.', err);
    notifyNotificationWarning('schedule-failed');
    if (previousQueue.length > 0) {
      try {
        await LocalNotifications.schedule({ notifications: previousQueue });
      } catch (restoreErr) {
        console.error('Could not restore the previous notification queue.', restoreErr);
      }
    }
  }
}

