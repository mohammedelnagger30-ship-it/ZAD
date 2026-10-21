import { JUZ_INFO, getSurah, TOTAL_QURAN_PAGES } from '@/data/surahs';
import type { NavParams, ScreenName } from '@/hooks/useApp';

export interface NotificationDestination {
  screen: ScreenName;
  params: NavParams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getTaskDestination(extra: Record<string, unknown>): NotificationDestination | null {
  if (extra.taskType !== 'hifz' && extra.taskType !== 'muraja') return null;
  if (typeof extra.portion !== 'string') return null;

  const portion = extra.portion;
  const surahMatch = /^surah:(\d+)(?::(\d+)(?:-(\d+))?)?$/.exec(portion);
  if (surahMatch) {
    const surahId = Number(surahMatch[1]);
    const ayah = surahMatch[2] ? Number(surahMatch[2]) : undefined;
    const endAyah = surahMatch[3] ? Number(surahMatch[3]) : ayah;
    const surah = getSurah(surahId);
    if (
      !surah ||
      (ayah !== undefined && (ayah < 1 || ayah > surah.ayahCount)) ||
      (endAyah !== undefined && (endAyah < (ayah ?? 1) || endAyah > surah.ayahCount))
    ) return null;
    return {
      screen: 'quran',
      params: {
        openSurahId: surahId,
        openAyah: ayah ?? 1,
        openToAyah: endAyah ?? surah.ayahCount,
        openHifzTest: true,
      },
    };
  }

  const juzMatch = /^juz:(\d+)$/.exec(portion);
  if (juzMatch) {
    const juz = JUZ_INFO.find((item) => item.id === Number(juzMatch[1]));
    return juz ? { screen: 'quran', params: { openPage: juz.startPage } } : null;
  }

  const pageMatch = /^page:(\d+)$/.exec(portion);
  if (pageMatch) {
    const page = Number(pageMatch[1]);
    return page >= 1 && page <= TOTAL_QURAN_PAGES
      ? { screen: 'quran', params: { openPage: page } }
      : null;
  }

  return null;
}

export function getNotificationDestination(value: unknown): NotificationDestination | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  switch (value.type) {
    case 'prayer':
      // The adhan listener owns this action and opens the dedicated adhan overlay.
      return null;
    case 'iqamah':
    case 'prayer-reminder':
      return value.prayerKey
        ? { screen: 'prayer', params: { prayerKey: value.prayerKey } }
        : { screen: 'prayer', params: {} };
    case 'task':
      return getTaskDestination(value);
    case 'hifz-review':
      if (
        !Number.isInteger(value.surahId) ||
        !Number.isInteger(value.fromAyah) ||
        !Number.isInteger(value.toAyah)
      ) return null;
      return getTaskDestination({
        taskType: 'muraja',
        portion: `surah:${value.surahId}:${value.fromAyah}-${value.toAyah}`,
      });
    case 'hadith':
      return { screen: 'hadith', params: {} };
    case 'dhikr':
      if (value.category === 'morning' || value.category === 'evening') {
        const params: Record<string, unknown> = { categoryId: value.category };
        if (typeof value.dhikrId === 'string') params.dhikrId = value.dhikrId;
        return { screen: 'adhkar', params };
      }
      if (value.category === 'istighfar') {
        return { screen: 'tasbih', params: { presetIndex: 4 } };
      }
      return { screen: 'adhkar', params: {} };
    default:
      return null;
  }
}
