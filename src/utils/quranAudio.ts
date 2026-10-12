import { getSurah } from '@/data/surahs';
import { getAudioReciter } from '@/data/audioReciters';
import {
  downloadSurahAudioFile,
  isContentStoreAvailable,
  notifyContentChanged,
  readAudioTrack,
  writeAudioTrack,
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
  recitationId: string,
  surahId: number,
  signal?: AbortSignal,
): Promise<{ url: string; verseTimings: VerseTiming[] }> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.quran.com/api/v4/chapter_recitations/${recitationId}/${surahId}?segments=true`,
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

// ---------------------------------------------------------------------------
// Per-ayah archive.org sources (e.g. the معلم recitations with one MP3 file
// per ayah). The rest of the app — the ayah sheet, the surah player, the
// offline store — is built around one file per surah plus verse timings, so
// the ayah files of a surah are stitched into a single MP3 blob and the
// timings are measured from the decoded audio. Nothing downstream changes.
// ---------------------------------------------------------------------------

/** `001001.mp3` = surah 1, ayah 1. Both parts are zero-padded to 3 digits. */
export function perAyahFileUrl(item: string, surahId: number, ayah: number): string {
  const surah = String(surahId).padStart(3, '0');
  const ayahPart = String(ayah).padStart(3, '0');
  return `https://archive.org/download/${item}/${surah}${ayahPart}.mp3`;
}

/** `001.mp3` = surah 1 (whole-surah file, no published verse timings). */
export function archiveSurahFileUrl(item: string, surahId: number): string {
  return `https://archive.org/download/${item}/${String(surahId).padStart(3, '0')}.mp3`;
}

/**
 * Drop ID3v2/v1 tag bytes so concatenated files hold audio frames only. A tag
 * left in the middle of a stitched stream is not audio and can glitch or stall
 * playback at the ayah boundary.
 */
export function stripId3(bytes: Uint8Array): Uint8Array {
  let start = 0;
  if (
    bytes.length > 10 &&
    bytes[0] === 0x49 && // I
    bytes[1] === 0x44 && // D
    bytes[2] === 0x33 // 3
  ) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    start = Math.min(bytes.length, 10 + size);
  }
  let end = bytes.length;
  if (
    end - start > 128 &&
    bytes[end - 128] === 0x54 && // T
    bytes[end - 127] === 0x41 && // A
    bytes[end - 126] === 0x47 // G
  ) {
    end -= 128;
  }
  return bytes.subarray(start, end);
}

/** Cumulative ayah boundaries (ms) from per-ayah durations in seconds. */
export function timingsFromDurations(durationsSec: number[]): VerseTiming[] {
  const timings: VerseTiming[] = [];
  let cursorMs = 0;
  for (let index = 0; index < durationsSec.length; index += 1) {
    const endMs = cursorMs + Math.max(0, Math.round(durationsSec[index] * 1000));
    timings.push({ ayah: index + 1, startMs: cursorMs, endMs });
    cursorMs = endMs;
  }
  return timings;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/** Bounded-parallel map: archive.org serves many small files, but hundreds of
 * simultaneous requests (Al-Baqarah has 286 ayahs) would thrash the tab. */
async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, size), items.length) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        out[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

let decodeContext: AudioContext | null = null;

function sharedDecodeContext(): AudioContext {
  decodeContext ??= new AudioContext();
  return decodeContext;
}

async function measureMp3Duration(buffer: ArrayBuffer): Promise<number> {
  // decodeAudioData detaches its input, so it always gets a private copy.
  const copy = buffer.slice(0);
  const decoded = await sharedDecodeContext().decodeAudioData(copy);
  return decoded.duration;
}

interface PerAyahSurah {
  blob: Blob;
  verseTimings: VerseTiming[];
}

async function buildPerAyahSurah(
  item: string,
  surahId: number,
  signal?: AbortSignal,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<PerAyahSurah> {
  const surah = getSurah(surahId);
  if (!surah) throw new Error('السورة المطلوبة غير موجودة');
  const ayahs = Array.from({ length: surah.ayahCount }, (_, index) => index + 1);

  let received = 0;
  let total = 0;
  const buffers = await mapPool(ayahs, 6, async (ayah) => {
    throwIfAborted(signal);
    let response: Response;
    try {
      response = await fetch(perAyahFileUrl(item, surahId, ayah), {
        signal,
        mode: 'cors',
        redirect: 'follow',
      });
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') throw cause;
      throw new Error('تعذّر الاتصال بمصدر التلاوة');
    }
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? 'تلاوة هذه السورة غير متاحة لهذا القارئ'
          : `تعذّر تحميل تلاوة الآية ${ayah} (${response.status})`,
      );
    }
    const raw = new Uint8Array(await response.arrayBuffer());
    throwIfAborted(signal);
    total += Number(response.headers.get('content-length') ?? 0);
    received += raw.byteLength;
    onProgress?.({ received, total });
    // Copy out of the fetch buffer: the stitched blob and the decoder each
    // keep their segment after this turn of the pool reuses nothing.
    return stripId3(raw).slice();
  });

  // Timings come from the audio itself: each stitched segment's length is its
  // decoded duration. A file that refuses to decode falls back to the byte
  // rate of its decoded siblings rather than failing the whole surah.
  const settled = await mapPool(buffers, 6, async (buffer) => {
    throwIfAborted(signal);
    try {
      return { ok: true as const, seconds: await measureMp3Duration(buffer.slice().buffer) };
    } catch {
      return { ok: false as const, seconds: 0 };
    }
  });
  throwIfAborted(signal);
  const decodedRates = settled
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.ok && entry.seconds > 0)
    .map(({ entry, index }) => buffers[index].byteLength / entry.seconds);
  const meanRate =
    decodedRates.length > 0
      ? decodedRates.reduce((sum, rate) => sum + rate, 0) / decodedRates.length
      : 16000; // ~128 kbps fallback; only used if nothing decoded at all
  if (decodedRates.length === 0) {
    throw new Error('تعذّر قياس مدة ملفات التلاوة');
  }
  const durations = settled.map((entry, index) =>
    entry.ok && entry.seconds > 0 ? entry.seconds : buffers[index].byteLength / meanRate,
  );
  const verseTimings = timingsFromDurations(durations);
  if (verseTimings.length !== surah.ayahCount) {
    throw new Error('بيانات توقيت الآيات غير مكتملة لهذه السورة');
  }

  const blob = new Blob(buffers, { type: 'audio/mpeg' });
  if (blob.size === 0) throw new Error('مصدر التلاوة أعاد ملفاً صوتياً غير صالح');
  onProgress?.({ received, total: total || received });
  return { blob, verseTimings };
}

export async function loadSurahAudio(
  reciterId: string,
  surahId: number,
  signal?: AbortSignal,
): Promise<SurahAudioSource> {
  const reciter = getAudioReciter(reciterId);
  if (!reciter) throw new Error('القارئ المطلوب غير معروف');
  const saved = await readAudioTrack(reciterId, surahId);
  if (saved) {
    return {
      url: URL.createObjectURL(saved.blob),
      blob: saved.blob,
      verseTimings: timingsFromTrack(saved),
    };
  }

  if (reciter.source.kind === 'per-ayah') {
    // One file per ayah, stitched into a single surah blob with measured
    // timings — downstream players see the same shape as a Quran.com file.
    // The blob is owned by the caller through `url` (revoked on change).
    const stitched = await buildPerAyahSurah(reciter.source.item, surahId, signal);
    return {
      url: URL.createObjectURL(stitched.blob),
      blob: stitched.blob,
      verseTimings: stitched.verseTimings,
    };
  }

  if (reciter.source.kind === 'archive-surah') {
    // One file for the whole surah and no published verse timings: players
    // see `verseTimings: []` and play the file whole instead of cutting
    // ayahs out of it (see the whole-file branches in the players).
    return { url: archiveSurahFileUrl(reciter.source.item, surahId), blob: null, verseTimings: [] };
  }

  const remote = await fetchSurahAudioMetadata(reciter.source.recitationId, surahId, signal);
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
    const reciter = getAudioReciter(reciterId);
    if (!reciter) throw new Error('القارئ المطلوب غير معروف');
    if (reciter.source.kind === 'per-ayah') {
      const stitched = await buildPerAyahSurah(reciter.source.item, surahId, signal, onProgress);
      await writeAudioTrack(reciterId, surahId, stitched.blob, stitched.verseTimings);
      return;
    }
    if (reciter.source.kind === 'archive-surah') {
      // A single whole-surah file, stored with empty timings so players keep
      // treating it as one whole file when it is read back offline.
      const url = archiveSurahFileUrl(reciter.source.item, surahId);
      await downloadSurahAudioFile(reciterId, surahId, url, [], onProgress, signal);
      return;
    }
    const { url, verseTimings } = await fetchSurahAudioMetadata(
      reciter.source.recitationId,
      surahId,
      signal,
    );
    await downloadSurahAudioFile(reciterId, surahId, url, verseTimings, onProgress, signal);
  } finally {
    notifyContentChanged();
  }
}
