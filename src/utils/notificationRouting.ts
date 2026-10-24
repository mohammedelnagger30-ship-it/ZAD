import { JUZ_INFO, getSurah, TOTAL_QURAN_PAGES } from '@/data/surahs';
import { ADHKAR_CATEGORIES } from '@/data/adhkar';
import { SUNNAH_CATEGORIES } from '@/data/sunnah';
import { PROPHET_SECTIONS } from '@/data/prophetData';
import { RAWATIB_TYPES } from '@/utils/prayerTracker';
import type { NavParams, ScreenName } from '@/hooks/useApp';

export interface NotificationDestination {
  screen: ScreenName;
  params: NavParams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A non-empty string field of the notification payload, or `null`. */
function stringField(value: Record<string, unknown>, key: string): string | null {
  const raw = value[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
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

/**
 * Where a dhikr reminder lands.
 *
 * The category comes from the notification's own `categoryId` — the collection the
 * reminder actually drew its text from — rather than from the reminder *kind*, so a
 * reminder always opens the page that holds it. The item id then pins the exact
 * reminder inside that page.
 */
function getDhikrDestination(value: Record<string, unknown>): NotificationDestination {
  // The istighfar set has no adhkar page of its own; the tasbih counter is where
  // those words are read, and that is where its reminder belongs.
  if (value.category === 'istighfar') {
    return { screen: 'tasbih', params: { presetIndex: 4 } };
  }

  const params: Record<string, unknown> = {};
  const categoryId = stringField(value, 'categoryId');
  const category = categoryId
    ? ADHKAR_CATEGORIES.find((candidate) => candidate.id === categoryId)
    : undefined;
  if (category) {
    params.categoryId = category.id;
  } else if (value.category === 'morning' || value.category === 'evening') {
    // An older notification that only names the kind of reminder.
    params.categoryId = value.category;
  }
  const dhikrId = stringField(value, 'dhikrId');
  if (dhikrId) params.dhikrId = dhikrId;
  return { screen: 'adhkar', params };
}

/**
 * Where a "sunnah of the day" reminder lands: the section that holds the narration,
 * and the narration's own title so the reader lands on it rather than on the section
 * head. Titles are the stable key here — a narration has no id of its own.
 */
function getSunnahDestination(value: Record<string, unknown>): NotificationDestination | null {
  const categoryId = stringField(value, 'categoryId');
  const category = categoryId
    ? SUNNAH_CATEGORIES.find((candidate) => candidate.id === categoryId)
    : undefined;
  if (!category) return null;
  const params: Record<string, unknown> = { categoryId: category.id };
  const itemTitle = stringField(value, 'itemTitle');
  if (itemTitle) params.itemTitle = itemTitle;
  return { screen: 'sunnah', params };
}

/** Where a "fact about the Prophet ﷺ" reminder lands: the section, and the card in it. */
function getProphetDestination(value: Record<string, unknown>): NotificationDestination | null {
  const sectionId = stringField(value, 'sectionId');
  const section = sectionId
    ? PROPHET_SECTIONS.find((candidate) => candidate.id === sectionId)
    : undefined;
  if (!section) return null;
  const params: Record<string, unknown> = { sectionId: section.id };
  const entryTitle = stringField(value, 'entryTitle');
  if (entryTitle) params.entryTitle = entryTitle;
  return { screen: 'prophet', params };
}

/**
 * Where a Sunnah-rawatib reminder lands: the Nawafil page, on the item itself.
 *
 * The row keys are the ones the page tracks (`RAWATIB_BY_PRAYER`), so a reminder about
 * «ركعتان قبل الفجر» opens the very toggle that records it rather than the page top.
 * An unknown key still opens the page — the item list is the right place either way.
 */
function getNawafilDestination(value: Record<string, unknown>): NotificationDestination {
  const nawafilKey = stringField(value, 'nawafilKey');
  const known =
    nawafilKey !== null &&
    (RAWATIB_TYPES.includes(nawafilKey as (typeof RAWATIB_TYPES)[number]) ||
      nawafilKey === 'witr' ||
      nawafilKey === 'duha' ||
      nawafilKey === 'tahajjud');
  return { screen: 'nawafil', params: known ? { nawafilKey } : {} };
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
      // "Hadith of the day" is derived from the day of the year over the collection
      // that happens to be on the device, so the notification cannot name it ahead of
      // time. It names the day instead, and the screen resolves the very entry the
      // home card shows.
      return { screen: 'hadith', params: { hadithOfDay: true } };
    case 'quran-message': {
      const surahId = value.surahId;
      const ayahNumber = value.ayahNumber;
      if (
        typeof surahId !== 'number' ||
        typeof ayahNumber !== 'number' ||
        !Number.isInteger(surahId) ||
        !Number.isInteger(ayahNumber)
      ) return null;
      const surah = getSurah(surahId);
      if (!surah || ayahNumber < 1 || ayahNumber > surah.ayahCount) return null;
      return {
        screen: 'quran',
        params: { openSurahId: surah.id, openAyah: ayahNumber },
      };
    }
    case 'sunnah':
      return getSunnahDestination(value);
    case 'prophet':
      return getProphetDestination(value);
    case 'nawafil':
      return getNawafilDestination(value);
    case 'dhikr':
      return getDhikrDestination(value);
    default:
      return null;
  }
}
