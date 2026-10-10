import { SURAHS } from '@/data/surahs';
import { getAyahs } from '@/data/quranText';
import { arabicQueryTerms, normalizeArabic } from '@/utils/arabic';

/**
 * Full-text search over the bundled Quran text.
 *
 * The fold comes from `arabic.ts` — the same tolerance the content checks rely
 * on — so a query typed without harakat finds text written with them, and the
 * alef/maqsura/taa-marbuta spellings match each other. Terms are combined with
 * AND regardless of order, so word order in the query does not matter.
 *
 * The folded index is built once on the first search (6236 ayahs) and kept for
 * the session; the original tashkeel'd text is what gets displayed.
 */

export interface AyahSearchResult {
  surahId: number;
  ayahNumber: number;
  surahName: string;
  /** Original text with tashkeel — for display, never for matching. */
  text: string;
}

export interface AyahSearchOutcome {
  results: AyahSearchResult[];
  /** How many ayahs match in total, even when `results` was capped by `limit`. */
  total: number;
}

interface IndexedAyah extends AyahSearchResult {
  folded: string;
}

let indexCache: IndexedAyah[] | null = null;

function ensureIndex(): IndexedAyah[] {
  if (indexCache) return indexCache;
  const entries: IndexedAyah[] = [];
  for (const surah of SURAHS) {
    for (const ayah of getAyahs(surah.id)) {
      entries.push({
        surahId: surah.id,
        ayahNumber: ayah.ayahNumber,
        surahName: surah.name,
        text: ayah.text,
        folded: normalizeArabic(ayah.text),
      });
    }
  }
  indexCache = entries;
  return entries;
}

/** Test seam: drop the folded index so each test starts cold. */
export function resetAyahSearchIndex(): void {
  indexCache = null;
}

export function searchAyahs(query: string, limit = 50): AyahSearchOutcome {
  const terms = arabicQueryTerms(query);
  if (terms.length === 0 || limit <= 0) return { results: [], total: 0 };

  const results: AyahSearchResult[] = [];
  let total = 0;
  for (const entry of ensureIndex()) {
    if (!terms.every((term) => entry.folded.includes(term))) continue;
    total++;
    if (results.length < limit) {
      const { folded: _folded, ...result } = entry;
      results.push(result);
    }
  }
  return { results, total };
}
