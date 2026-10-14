import { describe, it, expect } from '@jest/globals';
import {
  allSurahIds,
  describeBatchResult,
  runBatchDownload,
  surahsInJuz,
  type BatchDownloadDeps,
  type BatchProgress,
  type BatchResult,
} from '@/utils/batchDownload';

/**
 * What is checked is the queue's behaviour, which is the whole of what could
 * go wrong on a run of a hundred and fourteen files: nothing already on the
 * device is fetched twice, one bad file does not cost the rest, the network
 * going away is recognised as such, and a cancel is not reported as a failure.
 */

interface HarnessOptions {
  /** Surah ids that always fail, in the order the queue reaches them. */
  fail?: number[];
  existing?: number[];
}

interface Harness {
  deps: BatchDownloadDeps;
  attempted: number[];
}

function harness(options: HarnessOptions = {}): Harness {
  const attempted: number[] = [];
  return {
    attempted,
    deps: {
      existing: new Set(options.existing ?? []),
      download: async (surahId, onProgress) => {
        attempted.push(surahId);
        if (options.fail?.includes(surahId) ?? false) {
          throw new Error('تعذّر الاتصال بمصدر التلاوة');
        }
        onProgress({ received: 10, total: 100 });
      },
    },
  };
}

describe('runBatchDownload', () => {
  it('fetches every surah it was given, in order', async () => {
    const h = harness();
    const result = await runBatchDownload([1, 2, 3], h.deps);
    expect(result.downloaded).toEqual([1, 2, 3]);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.networkGaveUp).toBe(false);
    expect(h.attempted).toEqual([1, 2, 3]);
  });

  it('never fetches a surah already on the device', async () => {
    const h = harness({ existing: [2] });
    const result = await runBatchDownload([1, 2, 3], h.deps);
    expect(result.downloaded).toEqual([1, 3]);
    expect(result.skipped).toEqual([2]);
    expect(h.attempted).toEqual([1, 3]);
  });

  it('fetches a surah named twice only once', async () => {
    const h = harness();
    const result = await runBatchDownload([1, 2, 1, 3, 2], h.deps);
    expect(h.attempted).toEqual([1, 2, 3]);
    expect(result.downloaded).toEqual([1, 2, 3]);
  });

  it('reports the surah in hand and its place against the real denominator', async () => {
    const h = harness({ existing: [1] });
    const seen: BatchProgress[] = [];
    await runBatchDownload([1, 2, 3], h.deps, (progress) => seen.push(progress));

    // Surah 1 was skipped, so the run is two surahs long, not three.
    expect(seen.every((p) => p.surahCount === 2)).toBe(true);
    expect(seen.map((p) => p.surahId)).toEqual([2, 2, 3, 3]);
    expect(seen.map((p) => p.surahIndex)).toEqual([1, 1, 2, 2]);
    // The byte reading arrives after the opening zero report for that surah.
    const forSurah2 = seen.filter((p) => p.surahId === 2);
    expect(forSurah2[forSurah2.length - 1]).toEqual({
      surahId: 2,
      surahIndex: 1,
      surahCount: 2,
      received: 10,
      bytesTotal: 100,
    });
  });

  it('collects one bad surah and carries on to the rest', async () => {
    const h = harness({ fail: [2] });
    const result = await runBatchDownload([1, 2, 3], h.deps);
    expect(result.downloaded).toEqual([1, 3]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].surahId).toBe(2);
    expect(result.failed[0].message).toBe('تعذّر الاتصال بمصدر التلاوة');
    expect(result.networkGaveUp).toBe(false);
    expect(h.attempted).toEqual([1, 2, 3]);
  });

  it('stops after three failures in a row, and says so', async () => {
    const h = harness({ fail: [1, 2, 3, 4, 5, 6] });
    const result = await runBatchDownload([1, 2, 3, 4, 5, 6], h.deps);
    expect(result.failed).toHaveLength(3);
    expect(result.networkGaveUp).toBe(true);
    // The fourth was never attempted: three dead fetches were enough.
    expect(h.attempted).toEqual([1, 2, 3]);
    expect(result.downloaded).toEqual([]);
  });

  it('forgets the count the moment one surah succeeds', async () => {
    const h = harness({ fail: [1, 2, 4, 5] });
    const result = await runBatchDownload([1, 2, 3, 4, 5, 6], h.deps);
    // 1,2 fail — success at 3 clears it — 4,5 fail — never three straight.
    expect(result.failed).toHaveLength(4);
    expect(result.networkGaveUp).toBe(false);
    expect(h.attempted).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.downloaded).toEqual([3, 6]);
  });

  it('treats an abort as a stop, not as a surah that failed', async () => {
    const controller = new AbortController();
    const attempted: number[] = [];
    const deps: BatchDownloadDeps = {
      existing: new Set(),
      download: async (surahId, onProgress, signal) => {
        attempted.push(surahId);
        // Without the caller's signal reaching the fetch, cancelling the batch
        // would leave every later download still running behind it.
        expect(signal).toBe(controller.signal);
        if (surahId === 1) {
          controller.abort();
          throw new DOMException('Aborted', 'AbortError');
        }
        onProgress({ received: 1, total: 2 });
      },
    };

    const result = await runBatchDownload([1, 2, 3], deps, undefined, controller.signal);
    expect(result.failed).toEqual([]);
    expect(result.networkGaveUp).toBe(false);
    expect(attempted).toEqual([1]);
  });

  it('has nothing to do for an empty run', async () => {
    const h = harness();
    const result = await runBatchDownload([], h.deps);
    expect(result).toEqual({
      downloaded: [],
      skipped: [],
      failed: [],
      networkGaveUp: false,
    });
    expect(h.attempted).toEqual([]);
  });
});

describe('scope helpers', () => {
  it('names a juz as the surahs it overlaps, in mushaf order', () => {
    const juz1 = surahsInJuz(1);
    // Juz 1 opens on page 1: الفاتحة whole, and Al-Baqarah — which is the
    // point of the note on this function: a juz buys whole surahs.
    expect(juz1).toEqual([1, 2]);
    expect(juz1).toEqual([...juz1].sort((a, b) => a - b));
  });

  it('has an answer for every one of the thirty juz', () => {
    for (let juzId = 1; juzId <= 30; juzId += 1) {
      expect(surahsInJuz(juzId).length).toBeGreaterThan(0);
    }
    expect(surahsInJuz(31)).toEqual([]);
  });

  it('offers the whole Quran, once, in order', () => {
    const ids = allSurahIds();
    expect(ids).toHaveLength(114);
    expect(ids[0]).toBe(1);
    expect(ids[ids.length - 1]).toBe(114);
    expect(new Set(ids).size).toBe(114);
  });
});

describe('describeBatchResult', () => {
  const result = (partial: Partial<BatchResult>): BatchResult => ({
    downloaded: [],
    skipped: [],
    failed: [],
    networkGaveUp: false,
    ...partial,
  });

  it('says plainly when there was never anything to fetch', () => {
    expect(describeBatchResult(result({}))).toBe('لا يوجد في هذا النطاق ما يستحق التنزيل.');
    expect(describeBatchResult(result({ skipped: [1, 2] }))).toBe(
      'كل السور في هذا النطاق محفوظة على الجهاز بالفعل.',
    );
  });

  it('adds the three counts up, each in the form Arabic counts it', () => {
    const line = describeBatchResult(
      result({ downloaded: [1, 2, 3], skipped: [4, 5], failed: [{ surahId: 6, message: 'x' }] }),
    );
    expect(line).toContain('نُزِّلت: ٣ سور');
    expect(line).toContain('محفوظة سابقًا: سورتان');
    expect(line).toContain('تعذّر: سورة');
    // A numeral is never set beside a dual that already says it.
    expect(line).not.toContain('٢ سورتان');
  });

  it('distinguishes giving up on the connection from trying and failing', () => {
    const failed = describeBatchResult(
      result({ failed: [{ surahId: 1, message: 'x' }] }),
    );
    expect(failed).toContain('تعذّر: سورة');
    expect(failed).not.toContain('توقّف');

    const gaveUp = describeBatchResult(
      result({ failed: [{ surahId: 1, message: 'x' }], networkGaveUp: true }),
    );
    expect(gaveUp).toContain('توقّف لانقطاع الاتصال');
  });
});
