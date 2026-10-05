import { getAyah, TOTAL_AYAHS } from '@/data/quranText';
import { SURAHS } from '@/data/surahs';
import { addDays, formatDateKey } from '@/utils/dateUtils';

const STORAGE_KEY = 'hifzi-daily-quran-message';

interface StoredDailyMessage {
  date: string;
  surahId: number;
  ayahNumber: number;
}

export interface DailyQuranMessage extends StoredDailyMessage {
  text: string;
  surahName: string;
}

export interface DailyMessageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function findAyahByOffset(offset: number): { surahId: number; ayahNumber: number } {
  let remaining = offset;
  for (const surah of SURAHS) {
    if (remaining < surah.ayahCount) {
      return { surahId: surah.id, ayahNumber: remaining + 1 };
    }
    remaining -= surah.ayahCount;
  }
  throw new Error(`رقم الآية العشوائية خارج نطاق القرآن: ${offset}`);
}

export function getDailyQuranMessage(
  date = new Date(),
  storage?: DailyMessageStorage,
  random: () => number = Math.random,
): DailyQuranMessage {
  const targetStorage = storage ?? globalThis.localStorage;
  if (!targetStorage) throw new Error('التخزين المحلي غير متاح لحفظ رسالة القرآن اليومية.');

  const dateKey = formatDateKey(date);
  const saved = targetStorage.getItem(STORAGE_KEY);
  let previous: StoredDailyMessage | null = null;
  if (saved) {
    try {
      const entry = JSON.parse(saved) as StoredDailyMessage;
      const ayah = getAyah(entry.surahId, entry.ayahNumber);
      const surah = SURAHS.find((item) => item.id === entry.surahId);
      if (ayah && surah) {
        previous = entry;
        if (entry.date === dateKey) {
          return {
            ...entry,
            text: ayah.text,
            surahName: surah.name,
          };
        }
      }
    } catch {
      // Invalid local data is replaced below with a fresh verified Quran verse.
    }
  }

  let selectedOffset = Math.floor(random() * TOTAL_AYAHS);
  if (!Number.isInteger(selectedOffset) || selectedOffset < 0 || selectedOffset >= TOTAL_AYAHS) {
    throw new Error('تعذّر اختيار آية صالحة لرسالة القرآن اليومية.');
  }
  if (previous?.date === formatDateKey(addDays(date, -1))) {
    const candidate = findAyahByOffset(selectedOffset);
    if (
      previous.surahId === candidate.surahId &&
      previous.ayahNumber === candidate.ayahNumber
    ) {
      selectedOffset = (selectedOffset + 1) % TOTAL_AYAHS;
    }
  }
  const selected = findAyahByOffset(selectedOffset);
  const ayah = getAyah(selected.surahId, selected.ayahNumber);
  const surah = SURAHS.find((item) => item.id === selected.surahId);
  if (!ayah || !surah) throw new Error('تعذّر تحميل نص آية رسالة القرآن اليومية.');

  const entry: StoredDailyMessage = { date: dateKey, ...selected };
  targetStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  return { ...entry, text: ayah.text, surahName: surah.name };
}
