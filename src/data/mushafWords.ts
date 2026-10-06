/**
 * Per-surah word lists, in the order the flow layout indexes them.
 *
 * ── Why words and not ayahs ─────────────────────────────────────────────────────────
 * A page is built from `getPageLines()`, and each line carries a `from` and a `count`
 * into a surah's word list. Those offsets only mean something if the runtime rebuilds
 * exactly the list the generator measured — so this is deliberately the same construction
 * as `scripts/build-mushaf-flow.ts`, word for word:
 *
 *     [ basmala words (only when it gets its own line), ayah 1, ayah 2, ... ]
 *
 * If the two ever disagree the symptom is subtle and hard to trace: pages still fill, they
 * just show the wrong words. `npm run check:flow` rebuilds the whole list from this text
 * and asserts it reproduces the source exactly, which is what catches a divergence.
 *
 * The basmala is not an ayah — Tanzil folds it into ayah 1 of every surah but At-Tawbah —
 * so its words carry ayah number 0 and never get an end marker.
 */

import fullText from './quran-full.json';
import { splitBasmala } from '@/utils/basmala';

const RAW = fullText as Record<string, string[]>;

export interface FlowWord {
  text: string;
  /** Ayah this word belongs to. 0 for the basmala. */
  ayah: number;
  /** Last word of its ayah, so the reader can hang the end marker off it. */
  endsAyah: boolean;
}

/**
 * How many surahs to keep word lists for.
 *
 * A page shows one or two surahs, and a turn of the page moves one, so a handful is plenty.
 * The whole Quran is 77,881 words and holding every word object alive would cost megabytes
 * on a phone for no benefit — the lines a reader can actually see are two surahs' worth.
 */
const CACHE_LIMIT = 6;

const cache = new Map<number, FlowWord[]>();

/** Words of a surah in flow order. Cached; see `CACHE_LIMIT`. */
export function getSurahWords(surahId: number): FlowWord[] {
  const cached = cache.get(surahId);
  if (cached) {
    // Re-insert so the most recently drawn surahs are the ones that survive eviction.
    cache.delete(surahId);
    cache.set(surahId, cached);
    return cached;
  }

  const ayahs = RAW[String(surahId)] ?? [];
  const first = splitBasmala(ayahs[0] ?? '');
  const basmalaIsOwnLine = first.basmala !== null && first.rest.length > 0;

  const words: FlowWord[] = [];
  /** Word indices at which a new ayah begins, so its first word can be marked. */
  const ayahStarts: number[] = [];

  if (basmalaIsOwnLine) {
    for (const text of first.basmala!.split(' ').filter(Boolean)) {
      words.push({ text, ayah: 0, endsAyah: false });
    }
  }
  ayahStarts.push(words.length);

  const pushAyah = (text: string, ayahNumber: number) => {
    const parts = text.split(' ').filter(Boolean);
    parts.forEach((text, index) => {
      words.push({ text, ayah: ayahNumber, endsAyah: index === parts.length - 1 });
    });
  };

  pushAyah(basmalaIsOwnLine ? first.rest : (ayahs[0] ?? ''), 1);
  for (let i = 1; i < ayahs.length; i++) {
    ayahStarts.push(words.length);
    pushAyah(ayahs[i], i + 1);
  }

  const starts = new Set(ayahStarts);
  // A basmala word is never an ayah ending; the last ayah's final word always is.
  for (let i = 0; i < words.length; i++) {
    const ends = i + 1 === words.length || starts.has(i + 1);
    if (words[i].ayah > 0) words[i].endsAyah = ends;
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(surahId, words);
  return words;
}