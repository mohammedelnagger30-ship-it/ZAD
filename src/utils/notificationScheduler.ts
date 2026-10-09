import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { getSettings } from '@/db/database';
import type { Settings } from '@/db/database';
import { getAdhanSound } from '@/data/adhanSounds';
import {
  addCalendarDays,
  calculatePrayerTimesForDay,
  calendarDayInZone,
  getPrayerTimeZone,
} from '@/utils/prayerTimes';
import { generateDailyTasks, getTodayTasks } from '@/utils/taskManager';
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
 * How many days of prayer alarms are kept armed.
 *
 * Each open/resume rebuilds the whole queue, so this is the adhan's survival horizon
 * when the app is never opened again: beyond it there is nothing left to fire.
 */
const PRAYER_NOTIFICATION_DAYS = 7;

const DHIKR_REMINDER_MESSAGES: Record<DhikrReminderCategory, { title: string; messages: string[] }> = {
  morning: {
    title: 'أذكار الصباح',
    messages: [
      'أذكار الصباح في انتظارك — ابدأ يومك بذكر الله.',
      'ابدأ صباحك بلحظة هادئة مع أذكار الصباح.',
      'خصص دقائق لأذكار الصباح واجعلها بداية يومك.',
      'صباحك أجمل بذكر الله — أذكار الصباح جاهزة.',
      'خذ لحظة للذكر قبل الانشغال بمهام اليوم.',
    ],
  },
  evening: {
    title: 'أذكار المساء',
    messages: [
      'أذكار المساء في انتظارك — اختم يومك بذكر الله.',
      'خصص لحظة هادئة لأذكار المساء.',
      'قبل أن تنهي يومك، لا تنس أذكار المساء.',
      'اجعل ختام يومك ذكرًا وطمأنينة.',
      'حان وقت أذكار المساء — افتح وردك اليومي.',
    ],
  },
  istighfar: {
    title: 'تذكير بالاستغفار',
    messages: [
      'استغفر الله — لحظة ذكر في يومك.',
      'تذكير لطيف: أكثر من الاستغفار.',
      'خذ لحظة وقل: أستغفر الله.',
      'استغفر الله العظيم، وواصل يومك بقلب حاضر.',
      'لا تنسَ وردك من الاستغفار.',
    ],
  },
};

function getDhikrReminderCategory(
  preference: Settings['randomDhikrCategory'] | undefined,
  at: Date,
  slot: number,
): DhikrReminderCategory {
  if (preference && preference !== 'varied') return preference;
  const hour = at.getHours();
  if (hour < 12) return 'morning';
  if (hour >= 17) return 'evening';
  return slot % 2 === 0 ? 'istighfar' : 'morning';
}

function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export async function createNotificationChannels(settings: Settings): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const adhan = getAdhanSound(settings.adhanVoiceId);
  await LocalNotifications.createChannel({
    id: `prayer-${adhan.id}`,
    name: `الأذان — ${adhan.name}`,
    description: 'تنبيه عند دخول وقت الصلاة',
    importance: 4,
    sound: adhan.file,
    vibration: true,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'prayer-muted',
    name: 'مواقيت الصلاة — دون صوت',
    description: 'تنبيه صامت عند دخول وقت الصلاة',
    importance: 2,
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
  await LocalNotifications.createChannel({
    id: 'hifz',
    name: 'الحفظ',
    description: 'تذكيرات حفظ القرآن',
    importance: 4,
    vibration: true,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'review',
    name: 'المراجعة',
    description: 'تذكيرات مراجعة القرآن',
    importance: 4,
    vibration: true,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'hadith',
    name: 'حديث اليوم',
    description: 'تنبيه حديث اليوم',
    importance: 3,
    vibration: true,
    visibility: 1,
  });
  await LocalNotifications.createChannel({
    id: 'azkar',
    name: 'الأذكار',
    description: 'تذكيرات أذكار الصباح والمساء',
    importance: 3,
    vibration: true,
    visibility: 1,
  });
}

/**
 * Rebuild every pending notification from the current settings.
 *
 * Safe to call repeatedly — it swaps the whole queue in one cancel/schedule pair, so it
 * doubles as the reschedule-on-resume hook (Android drops pending alarms across
 * reboots, and stale rows would otherwise accumulate). The only notifications kept
 * through the swap are active snoozes the user asked for. A failed swap restores the
 * previous queue rather than leaving the adhan silent.
 */
export async function rescheduleAllNotifications(): Promise<void> {
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
  const queue: LocalNotificationSchema[] = [];

  // Channels are idempotent and independent of the queue; if this fails, the previously
  // created channels (same ids) are still in place.
  try {
    await createNotificationChannels(settings);
  } catch (err) {
    console.error('Could not create notification channels:', err);
  }

  // 1. Prayer notifications for the next PRAYER_NOTIFICATION_DAYS days.
  //
  // More than "today + tomorrow" is what keeps the adhan firing while the app stays
  // closed for a while: these alarms are the only thing that plays the adhan outside
  // the process, so a two-day horizon meant the adhan silently stopped on day three.
  if (settings.latitude != null && settings.longitude != null) {
    const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
    const firstDay = calendarDayInZone(new Date(), timeZone);
    const now = Date.now();

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
      );

      for (const prayer of dayPrayers.prayers) {
        const slot = armSlot++;
        if (prayer.name === 'sunrise') continue;
        if (prayer.time.getTime() <= now) continue;

        queue.push({
          id: notificationId.prayer(slot),
          title: `حان وقت صلاة ${prayer.arabicName}`,
          body: `أدِّ صلاة ${prayer.arabicName} في وقتها`,
          schedule: { at: prayer.time, allowWhileIdle: true },
          channelId: settings.adhanSound ? `prayer-${getAdhanSound(settings.adhanVoiceId).id}` : 'prayer-muted',
          sound: settings.adhanSound ? getAdhanSound(settings.adhanVoiceId).file : undefined,
          smallIcon: 'ic_notification',
          iconColor: '#1f734e',
          extra: {
            type: 'prayer',
            prayerKey: prayer.name,
            prayerName: prayer.arabicName,
            time: prayer.time.toISOString(),
          },
        });

        // Pre-prayer reminder
        if (settings.prePrayerReminder > 0) {
          const reminderTime = new Date(prayer.time.getTime() - settings.prePrayerReminder * 60000);
          if (reminderTime.getTime() > now) {
            queue.push({
              id: notificationId.reminder(slot),
              title: `تذكير: صلاة ${prayer.arabicName} بعد ${settings.prePrayerReminder} دقيقة`,
              body: `استعد لصلاة ${prayer.arabicName}`,
              schedule: { at: reminderTime, allowWhileIdle: true },
              channelId: 'prayer-reminder',
              smallIcon: 'ic_notification',
              iconColor: '#1f734e',
            });
          }
        }
      }
    }
  }

  // 2. Schedule random text-only dhikr reminders for today and tomorrow.
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
      const now = new Date();
      const previousMessageByCategory = new Map<DhikrReminderCategory, number>();

      if (duration > 0) {
        for (let dayOffset = 0; dayOffset < 2; dayOffset += 1) {
          const windowStart = new Date();
          windowStart.setHours(0, 0, 0, 0);
          windowStart.setDate(windowStart.getDate() + dayOffset);
          windowStart.setMinutes(startMinute);
          const windowEnd = new Date(windowStart.getTime() + duration * 60000);

          for (
            let at = new Date(windowStart.getTime() + interval * 60000), slot = 0;
            at < windowEnd;
            at = new Date(at.getTime() + interval * 60000), slot += 1
          ) {
            if (at <= now) continue;
            const category = getDhikrReminderCategory(settings.randomDhikrCategory, at, slot);
            const reminder = DHIKR_REMINDER_MESSAGES[category];
            const previousIndex = previousMessageByCategory.get(category) ?? -1;
            const available = reminder.messages.map((_, index) => index)
              .filter((index) => index !== previousIndex);
            const messageIndex = available[Math.floor(Math.random() * available.length)];
            previousMessageByCategory.set(category, messageIndex);
            queue.push({
              id: notificationId.dhikr(dayOffset * 1000 + slot),
              title: reminder.title,
              body: reminder.messages[messageIndex],
              schedule: { at, allowWhileIdle: true },
              channelId: 'azkar',
              smallIcon: 'ic_notification',
              iconColor: '#1f734e',
            });
          }
        }
      }
    }
  }

  // 3. Today's task notifications (hifz / review)
  await generateDailyTasks();
  const tasks = await getTodayTasks();

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'missed') continue;
    const scheduledAt = task.status === 'snoozed' && task.snoozedUntil
      ? new Date(task.snoozedUntil)
      : new Date(`${task.date}T${task.scheduledTime}:00`);
    if (scheduledAt <= new Date()) continue;

    const typeText = task.type === 'hifz' ? 'الحفظ' : 'المراجعة';
    queue.push({
      id: notificationId.task(task.id ?? 0),
      title: `حان وقت ${typeText}`,
      body: `وقت ${typeText}: ${task.portion}`,
      schedule: { at: scheduledAt, allowWhileIdle: true },
      channelId: task.type === 'hifz' ? 'hifz' : 'review',
      sound: settings.notificationSound ? 'notification.wav' : undefined,
      smallIcon: 'ic_notification',
      iconColor: '#1f734e',
    });
  }

  // 4. Hadith of the day (9:00 AM)
  const hadithTime = new Date();
  hadithTime.setHours(9, 0, 0, 0);
  hadithTime.setDate(hadithTime.getDate() + (hadithTime < new Date() ? 1 : 0));
  if (hadithTime > new Date()) {
    queue.push({
      id: notificationId.hadith(),
      title: 'حديث اليوم',
      body: 'اقرأ حديث اليوم المختار لك',
      schedule: { at: hadithTime, allowWhileIdle: true },
      channelId: 'hadith',
      smallIcon: 'ic_notification',
      iconColor: '#1f734e',
    });
  }

  // --- Swap phase: one cancel, one schedule, restore on failure. -------------
  // The snapshot is taken first so a rejected schedule() can put the previous queue
  // back instead of leaving nothing armed at all. Active snoozes (the adhan overlay's
  // «تذكير بعد 10 دقائق») are deliberately kept through the cancel — every resume
  // rebuilds the queue, and the old unconditional cancel-all silently deleted the
  // reminder the user had just asked for.
  let previousQueue: LocalNotificationSchema[] = [];
  try {
    previousQueue = (await LocalNotifications.getPending()).notifications;
  } catch (err) {
    console.warn('Could not snapshot the pending notification queue:', err);
  }

  try {
    await cancelAllNotifications(preserveActiveSnooze);
    if (queue.length > 0) {
      const result = (await LocalNotifications.schedule({ notifications: queue })) as unknown as
        { warning?: string } | void;
      if (result && typeof result === 'object' && typeof result.warning === 'string' && result.warning) {
        // The plugin downgraded the batch (exact-alarm permission vanished mid-call):
        // alarms will fire, but possibly late in sleep mode.
        console.warn('Notifications were scheduled inexact:', result.warning);
        notifyNotificationWarning('scheduled-inexact');
      }
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
