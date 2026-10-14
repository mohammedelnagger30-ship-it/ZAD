import { getSurahsByJuz, SURAHS } from '@/data/surahs';
import { countNoun, type ArabicCountForms } from '@/utils/arabicCount';

const SURAH_COUNT: ArabicCountForms = { one: 'سورة', two: 'سورتان', few: 'سور', many: 'سورة' };

/** «٣ سور» · «سورتان» · «سورة» — a count of surahs as Arabic says it. */
export function countSurahs(count: number): string {
  return countNoun(count, SURAH_COUNT);
}

/**
 * Batch download of the offline recitation, in scopes a person can name — a
 * juz, or a whole reciter — instead of one surah chosen at a time.
 *
 * The decisions the shape of this file rests on:
 *
 * · **Sequential, one surah at a time.** Fetching a single surah already fans
 *   out to six parallel requests for the per-ayah recitations; several surahs
 *   on top of that would thrash a phone's radio, and a byte-progress bar with
 *   three streams writing into it would mean nothing.
 *
 * · **Whole surahs, never cut at a juz edge.** The store keeps one file per
 *   surah with its timings, so a juz is fetched as the surahs it overlaps —
 *   which is why "download juz 1" costs Al-Baqarah and not a page or two. The
 *   interface has to say so, because the alternative reading is a wrong one.
 *
 * · **A failure does not end the run**, since one missing recitation among a
 *   hundred and fourteen should not cost the other hundred and thirteen —
 *   but **three failures in a row do**. Three fetches with nothing arriving
 *   is the connection having gone, not three unlucky files, and walking the
 *   remaining surahs one timeout at a time after that is worse than stopping.
 */

/** Three fetches in a row that all come back empty-handed. */
const CONSECUTIVE_FAILURE_LIMIT = 3;

export interface BatchProgress {
  /** The surah being fetched right now. */
  surahId: number;
  /** Its place among the surahs this run actually fetches, 1-based. */
  surahIndex: number;
  /** How many surahs this run fetches, once already-stored ones are out. */
  surahCount: number;
  /** Bytes read for the current surah. */
  received: number;
  /** Bytes the current surah expects; 0 until a server has said. */
  bytesTotal: number;
}

export interface BatchResult {
  /** Surahs fetched onto the device during this run, in the order attempted. */
  downloaded: number[];
  /** Surahs already on the device when the run began — counted, never re-fetched. */
  skipped: number[];
  /** Surahs that could not be fetched, with why. */
  failed: Array<{ surahId: number; message: string }>;
  /** True when the run stopped early because the connection kept failing. */
  networkGaveUp: boolean;
}

export interface BatchDownloadDeps {
  /** Which surahs are already stored when the run begins — one snapshot. */
  existing: ReadonlySet<number>;
  /** Fetch one surah. Injected so the queue can be exercised without a server. */
  download: (
    surahId: number,
    onProgress: (progress: { received: number; total: number }) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}

/**
 * Every surah a juz touches, in mushaf order.
 *
 * A juz opens and closes in the middle of surahs, and the store holds audio one
 * whole surah at a time, so the unit of download here is the overlapping surah —
 * whole, never trimmed at the juz's edge.
 */
export function surahsInJuz(juzId: number): number[] {
  return getSurahsByJuz(juzId).map((surah) => surah.id);
}

/** The whole Quran in mushaf order — a reciter's entire recitation. */
export function allSurahIds(): number[] {
  return SURAHS.map((surah) => surah.id);
}

/**
 * The outcome of a run, in one line the screen can put under the progress bar.
 *
 * Spelled out here rather than in the component because the three counts have
 * to add up honestly in Arabic: what was fetched, what was already there, and
 * what could not be fetched — and because "we stopped early" is a different
 * sentence from "we tried and failed", and a person watching a long run needs
 * to be told which one happened.
 */
export function describeBatchResult(result: BatchResult): string {
  if (result.downloaded.length === 0 && result.failed.length === 0) {
    return result.skipped.length > 0
      ? 'كل السور في هذا النطاق محفوظة على الجهاز بالفعل.'
      : 'لا يوجد في هذا النطاق ما يستحق التنزيل.';
  }

  // Each count sits after a colon instead of under a verb, so it stays in the
  // nominative and «سورتان» is not asked to become «سورتين» as a governed
  // object would be. The label form reads correctly for one, two, and every
  // count after those.
  const parts: string[] = [];
  if (result.downloaded.length > 0) {
    parts.push(`نُزِّلت: ${countSurahs(result.downloaded.length)}`);
  }
  if (result.skipped.length > 0) {
    parts.push(`محفوظة سابقًا: ${countSurahs(result.skipped.length)}`);
  }
  if (result.failed.length > 0) {
    parts.push(`تعذّر: ${countSurahs(result.failed.length)}`);
  }
  return `${parts.join(' · ')}${result.networkGaveUp ? ' — توقّف لانقطاع الاتصال' : ''}.`;
}

/**
 * Fetches `surahIds` in order, skipping what is already on the device, and
 * reports both the surah being worked on and the bytes inside it.
 *
 * Never throws for a surah's own failure — those are collected and the run
 * carries on. Throws nothing at all: an abort returns the run as it stood.
 */
export async function runBatchDownload(
  surahIds: readonly number[],
  deps: BatchDownloadDeps,
  onProgress?: (progress: BatchProgress) => void,
  signal?: AbortSignal,
): Promise<BatchResult> {
  // Two requested juzes can name the same surah; it is still one file.
  const ordered = [...new Set(surahIds)];
  const result: BatchResult = {
    downloaded: [],
    skipped: ordered.filter((id) => deps.existing.has(id)),
    failed: [],
    networkGaveUp: false,
  };
  const queue = ordered.filter((id) => !deps.existing.has(id));

  let consecutiveFailures = 0;
  for (let index = 0; index < queue.length; index += 1) {
    if (signal?.aborted) break;
    const surahId = queue[index];
    const report = (received: number, bytesTotal: number) => {
      onProgress?.({
        surahId,
        surahIndex: index + 1,
        surahCount: queue.length,
        received,
        bytesTotal,
      });
    };
    report(0, 0);
    try {
      await deps.download(surahId, ({ received, total }) => report(received, total), signal);
      result.downloaded.push(surahId);
      // One success is proof the connection came back, so the count starts
      // over rather than holding a grudge from four surahs ago.
      consecutiveFailures = 0;
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') break;
      result.failed.push({
        surahId,
        message: cause instanceof Error ? cause.message : 'تعذّر تنزيل التلاوة',
      });
      consecutiveFailures += 1;
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
        result.networkGaveUp = true;
        break;
      }
    }
  }
  return result;
}
