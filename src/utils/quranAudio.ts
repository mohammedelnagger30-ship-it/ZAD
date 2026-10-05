import { getSurah } from '@/data/surahs';
import {
  downloadSurahAudioFile,
  isContentStoreAvailable,
  notifyContentChanged,
  readAudioTrack,
  type AudioTrack,
  type DownloadProgress,
} from '@/utils/contentStore';

export interface VerseTiming {
  ayah: number;
  startMs: number;
  endMs: number;
}

export interface SurahAudioSource {
  url: string;
  blob: Blob | null;
  verseTimings: VerseTiming[];
}

interface ChapterAudioResponse {
  audio_file?: {
    audio_url?: string;
    timestamps?: Array<{
      verse_key?: string;
      timestamp_from?: number;
      timestamp_to?: number;
    }>;
  };
}

function timingsFromTrack(track: AudioTrack): VerseTiming[] {
  return track.verseTimings;
}

async function fetchSurahAudioMetadata(
  reciterId: string,
  surahId: number,
  signal?: AbortSignal,
): Promise<{ url: string; verseTimings: VerseTiming[] }> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.quran.com/api/v4/chapter_recitations/${reciterId}/${surahId}?segments=true`,
      { signal },
    );
  } catch (cause) {
    if ((cause as Error).name === 'AbortError') throw cause;
    throw new Error('تعذّر الاتصال بمصدر التلاوة');
  }
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'تلاوة هذه السورة غير متاحة لهذا القارئ'
        : `تعذّر تحميل بيانات التلاوة (${response.status})`,
    );
  }

  const data = (await response.json()) as ChapterAudioResponse;
  const audioFile = data.audio_file;
  const url = audioFile?.audio_url;
  if (!url || !url.startsWith('https://')) {
    throw new Error('رابط ملف التلاوة غير صالح');
  }

  const surah = getSurah(surahId);
  if (!surah) throw new Error('السورة المطلوبة غير موجودة');
  const verseTimings: VerseTiming[] = [];
  for (const timing of audioFile?.timestamps ?? []) {
    const [timedSurah, timedAyah] = (timing.verse_key ?? '').split(':').map(Number);
    if (
      timedSurah !== surahId ||
      !Number.isInteger(timedAyah) ||
      timedAyah < 1 ||
      timedAyah > surah.ayahCount ||
      !Number.isFinite(timing.timestamp_from) ||
      !Number.isFinite(timing.timestamp_to)
    ) {
      continue;
    }
    verseTimings.push({
      ayah: timedAyah,
      startMs: timing.timestamp_from!,
      endMs: timing.timestamp_to!,
    });
  }
  if (verseTimings.length !== surah.ayahCount) {
    throw new Error('بيانات توقيت الآيات غير مكتملة لهذه السورة');
  }

  return { url, verseTimings };
}

export async function loadSurahAudio(
  reciterId: string,
  surahId: number,
  signal?: AbortSignal,
): Promise<SurahAudioSource> {
  const saved = await readAudioTrack(reciterId, surahId);
  if (saved) {
    return {
      url: URL.createObjectURL(saved.blob),
      blob: saved.blob,
      verseTimings: timingsFromTrack(saved),
    };
  }

  const remote = await fetchSurahAudioMetadata(reciterId, surahId, signal);
  return { ...remote, blob: null };
}

export async function downloadSurahAudio(
  reciterId: string,
  surahId: number,
  onProgress?: (progress: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!isContentStoreAvailable()) {
    throw new Error('التخزين المحلي غير متاح في هذا المتصفح');
  }
  if (!getSurah(surahId)) throw new Error('السورة المطلوبة غير موجودة');
  if (await readAudioTrack(reciterId, surahId)) return;

  try {
    const { url, verseTimings } = await fetchSurahAudioMetadata(reciterId, surahId, signal);
    await downloadSurahAudioFile(reciterId, surahId, url, verseTimings, onProgress, signal);
  } finally {
    notifyContentChanged();
  }
}
