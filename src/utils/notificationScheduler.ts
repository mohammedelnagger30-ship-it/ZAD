import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { getSettings } from '@/db/database';
import type { Settings } from '@/db/database';
import { getAdhanSound } from '@/data/adhanSounds';
import { calculatePrayerTimes, getDateInTimeZone, getPrayerTimeZone } from '@/utils/prayerTimes';
import { generateDailyTasks, getTodayTasks } from '@/utils/taskManager';
import { genNotificationId, cancelAllNotifications, hasNotificationPermission } from '@/utils/notifications';

type DhikrReminderCategory = 'morning' | 'evening' | 'istighfar';

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
 * Safe to call repeatedly — it cancels everything first, so it doubles as the
 * reschedule-on-resume hook (Android drops pending alarms across reboots, and stale
 * rows would otherwise accumulate).
 */
export async function rescheduleAllNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Scheduling without the grant throws or silently no-ops on both platforms, and the
  // failure was previously invisible because the whole body sat inside a fire-and-forget
  // promise. Bail out early instead.
  if (!(await hasNotificationPermission())) {
    console.info('Notification permission not granted — skipping reschedule');
    return;
  }

  const settings = await getSettings();

  // Cancel all existing notifications first
  await cancelAllNotifications();

  // Ensure channels exist
  await createNotificationChannels(settings);

  // 1. Schedule prayer notifications for today + tomorrow
  if (settings.latitude != null && settings.longitude != null) {
    const timeZone = getPrayerTimeZone(settings.timeZone, settings.cityName);
    const today = getDateInTimeZone(new Date(), timeZone);
    const todayPrayers = calculatePrayerTimes(
      settings.latitude, settings.longitude, today, settings.calcMethod, settings.asrMadhab, timeZone
    );
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowPrayers = calculatePrayerTimes(
      settings.latitude, settings.longitude, tomorrow, settings.calcMethod, settings.asrMadhab, timeZone
    );

    const allPrayers = [...todayPrayers.prayers, ...tomorrowPrayers.prayers];
    const notifications: LocalNotificationSchema[] = [];

    for (const [prayerIndex, prayer] of allPrayers.entries()) {
      if (prayer.name === 'sunrise') continue;
      if (prayer.time <= new Date()) continue;

      notifications.push({
        id: genNotificationId(10, prayer.time, prayerIndex),
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
        if (reminderTime > new Date()) {
          notifications.push({
            id: genNotificationId(11, prayer.time, prayerIndex),
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

    if (notifications.length > 0) {
      await LocalNotifications.schedule({ notifications });
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
      const notifications: LocalNotificationSchema[] = [];
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
            notifications.push({
              id: genNotificationId(40, at, dayOffset * 100 + slot),
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

      if (notifications.length > 0) {
        await LocalNotifications.schedule({ notifications });
      }
    }
  }

  // 3. Schedule today's task notifications
  await generateDailyTasks();
  const tasks = await getTodayTasks();
  const taskNotifications: LocalNotificationSchema[] = [];

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'missed') continue;
    const scheduledAt = task.status === 'snoozed' && task.snoozedUntil
      ? new Date(task.snoozedUntil)
      : new Date(`${task.date}T${task.scheduledTime}:00`);
    if (scheduledAt <= new Date()) continue;

    const typeText = task.type === 'hifz' ? 'الحفظ' : 'المراجعة';
    taskNotifications.push({
      id: genNotificationId(20 + (task.id || 0), scheduledAt),
      title: `حان وقت ${typeText}`,
      body: `وقت ${typeText}: ${task.portion}`,
      schedule: { at: scheduledAt, allowWhileIdle: true },
      channelId: task.type === 'hifz' ? 'hifz' : 'review',
      sound: settings.notificationSound ? 'notification.mp3' : undefined,
      smallIcon: 'ic_notification',
      iconColor: '#1f734e',
    });
  }

  if (taskNotifications.length > 0) {
    await LocalNotifications.schedule({ notifications: taskNotifications });
  }

  // 4. Schedule hadith of the day (9:00 AM)
  const hadithTime = new Date();
  hadithTime.setHours(9, 0, 0, 0);
  hadithTime.setDate(hadithTime.getDate() + (hadithTime < new Date() ? 1 : 0));
  if (hadithTime > new Date()) {
    await LocalNotifications.schedule({
      notifications: [{
        id: genNotificationId(30, hadithTime),
        title: 'حديث اليوم',
        body: 'اقرأ حديث اليوم المختار لك',
        schedule: { at: hadithTime, allowWhileIdle: true },
        channelId: 'hadith',
        smallIcon: 'ic_notification',
        iconColor: '#1f734e',
      }],
    });
  }
}
