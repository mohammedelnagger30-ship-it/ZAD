import { SURAHS, toArabicNumber } from '@/data/surahs';
import { ADHKAR_CATEGORIES } from '@/data/adhkar';
import { GRADE_INFO } from '@/data/hadithCollections';
import { arabicQueryTerms, normalizeArabic } from '@/utils/arabic';
import { searchAyahs, type AyahSearchResult } from '@/utils/ayahSearch';
import { searchInstalledHadiths, type SearchHit } from '@/utils/hadithService';
import { searchInstalledTafsir, type TafsirSearchHit } from '@/utils/tafsirService';
import type { ScreenName } from '@/hooks/useApp';

/**
 * One box, four corpora.
 *
 * The four sources are not four kinds of the same thing: an ayah, a hadith, a
 * dhikr and a commentary differ in length, in how they are stored, in whether
 * they are even on the device, and in how cheaply they can be searched. What
 * they share is the query and the fold behind it — `arabic.ts` puts every one
 * of them on the same comparison footing, so the same three words find
 * «الصَّلَاةِ» written with harakat and «وصلاة» written without, whichever
 * corpus it sits in.
 *
 * Two decisions are written down here rather than left to fall out:
 *
 *   * **Ordering is by source, not by a blended relevance score.** Relevance
 *     across four unrelated corpora is not a number — a score that mixed them
 *     would be a ranking nobody could explain, and «الله» would put a thousand
 *     ayahs above the one hadith being looked for by accident of frequency.
 *     So each source keeps its own order and each is capped, and the list is
 *     stable while the person reads it.
 *
 *   * **Tafsir is last, and stays last.** It is the only source without an
 *     index to read: whole files are folded as they are scanned, so it is
 *     always the last to answer. Putting it last means it can arrive after
 *     everything else without a single card moving under the reader's eye.
 *
 * Matching is AND-of-terms everywhere, word order in the query ignored. The
 * adhkar screen used to require the whole query as one contiguous substring;
 * across four sources, requiring one behaviour that differs from the other
 * three would be a bug wearing a design's clothes.
 */

export const UNIFIED_SOURCE_ORDER = ['quran', 'hadith', 'adhkar', 'tafsir'] as const;

export type UnifiedSource = (typeof UNIFIED_SOURCE_ORDER)[number];

export const UNIFIED_SOURCE_LABELS: Record<UnifiedSource, string> = {
  quran: 'قرآن',
  hadith: 'حديث',
  adhkar: 'ذكر',
  tafsir: 'تفسير',
};

/** How many results one source may put on the screen at once. */
export const PER_SOURCE_LIMIT = 6;

/**
 * Long sources are cut to this many characters, around the match.
 *
 * Quran is excluded on purpose: an ayah is shown whole on its own screen and
 * in محفوظاتي, and cutting scripture to fit a list would be the first place in
 * the app where a quotation is not the thing quoted.
 */
const EXCERPT_LENGTH = 240;
const EXCERPT_LEAD_IN = 60;

export interface UnifiedResult {
  /** Stable across runs — a source's own id namespaced by that source. */
  key: string;
  source: UnifiedSource;
  /** Ready to show. A long source is already cut around the match. */
  text: string;
  /** Where it came from, formatted: «سورة البقرة — الآية ٥». */
  reference: string;
  /** An optional second line — a collection, a grade, a commentator. */
  detail?: string;
  /** Where tapping it goes. Absent only where the source has nowhere to go. */
  target?: { screen: ScreenName; params?: Record<string, unknown> };
}

/**
 * The index in the original text of the first word carrying one of the terms.
 *
 * Folding is what makes this awkward: it deletes harakat, so a position in the
 * folded string is not a position in the original. It does not have to be —
 * the fold is context-free character substitution, so folding a word on its
 * own gives the same letters as folding the sentence it sits in, and a term
 * never spans a whitespace boundary because `arabicQueryTerms` split it at
 * exactly those boundaries. Walking word by word therefore finds the word in
 * the *original* string without ever needing the mapping back.
 */
function anchorOffset(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  let offset = 0;
  for (const piece of text.split(/(\s+)/)) {
    if (terms.some((term) => normalizeArabic(piece).includes(term))) return offset;
    offset += piece.length;
  }
  return 0;
}

/**
 * Cuts a long text to a window around the first match.
 *
 * Cutting from the start would show the first three lines of an eighty-line
 * hadith and leave the match, which is the entire reason the card is on
 * screen, somewhere below the fold. The result is marked with an ellipsis at
 * whichever end is cut, because a search result is an excerpt by definition —
 * but it must read as one.
 */
export function excerptAroundMatch(
  text: string,
  terms: string[],
  maxLength: number = EXCERPT_LENGTH,
): string {
  if (text.length <= maxLength) return text;

  const anchor = anchorOffset(text, terms);
  const startRaw = Math.max(0, anchor - EXCERPT_LEAD_IN);

  // Snap forward to a word: a half-word at the opening edge reads as a typo
  // rather than as an omission. Never past the anchor itself.
  let start = startRaw;
  if (startRaw > 0) {
    const nextSpace = text.indexOf(' ', startRaw);
    if (nextSpace !== -1 && nextSpace < anchor) start = nextSpace + 1;
  }

  const rawEnd = Math.min(text.length, start + maxLength);
  const lastSpace = text.lastIndexOf(' ', rawEnd);
  const end = rawEnd < text.length && lastSpace > start ? lastSpace : rawEnd;

  return [
    start > 0 ? '…' : '',
    text.slice(start, end).trim(),
    end < text.length ? '…' : '',
  ].join('');
}

/**
 * Searches the adhkar bundled with the app.
 *
 * Pure over `ADHKAR_CATEGORIES`, so it is testable without touching storage —
 * and cheap enough to run per keystroke that it needs no debounce of its own.
 */
export function searchAdhkarFor(query: string, limit: number): UnifiedResult[] {
  const terms = arabicQueryTerms(query);
  if (terms.length === 0 || limit <= 0) return [];

  const results: UnifiedResult[] = [];
  for (const category of ADHKAR_CATEGORIES) {
    for (const dhikr of category.items) {
      const haystack = normalizeArabic(
        `${dhikr.text} ${dhikr.reference} ${dhikr.virtue ?? ''} ${dhikr.note ?? ''}`,
      );
      if (!terms.every((term) => haystack.includes(term))) continue;

      results.push({
        key: `adhkar:${category.id}:${dhikr.id}`,
        source: 'adhkar',
        text: dhikr.text,
        reference: category.title,
        detail: dhikr.reference,
        target: { screen: 'adhkar', params: { categoryId: category.id } },
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/**
 * Lays the sources out in one list, capping each.
 *
 * Order comes from `UNIFIED_SOURCE_ORDER`, never from the caller's insertion:
 * a card that moves while it is being read is worse than a card in the wrong
 * place, and the only way to guarantee that is to write the order down once.
 */
export function mergeUnifiedResults(
  sections: Partial<Record<UnifiedSource, readonly UnifiedResult[]>>,
  perSourceLimit: number,
): UnifiedResult[] {
  const merged: UnifiedResult[] = [];
  for (const source of UNIFIED_SOURCE_ORDER) {
    const section = sections[source];
    if (!section) continue;
    for (const result of section.slice(0, Math.max(0, perSourceLimit))) merged.push(result);
  }
  return merged;
}

function surahName(surahId: number): string {
  return SURAHS.find((surah) => surah.id === surahId)?.name ?? '';
}

function toQuranResult(hit: AyahSearchResult): UnifiedResult {
  return {
    key: `quran:${hit.surahId}:${hit.ayahNumber}`,
    source: 'quran',
    text: hit.text,
    reference: `سورة ${hit.surahName} — الآية ${toArabicNumber(hit.ayahNumber)}`,
    target: { screen: 'quran', params: { openSurahId: hit.surahId, openAyah: hit.ayahNumber } },
  };
}

function toHadithResult(hit: SearchHit, terms: string[]): UnifiedResult {
  const grade = hit.hadith.grades[0];
  return {
    key: `hadith:${hit.hadith.id}`,
    source: 'hadith',
    text: excerptAroundMatch(hit.hadith.text, terms),
    reference: `${hit.collection.titleAr} — حديث ${toArabicNumber(hit.hadith.number)}`,
    ...(grade ? { detail: GRADE_INFO[grade].label } : {}),
    target: { screen: 'hadith', params: { hadithId: hit.hadith.id } },
  };
}

function toTafsirResult(hit: TafsirSearchHit, terms: string[]): UnifiedResult {
  return {
    key: `tafsir:${hit.editionId}:${hit.surah}:${hit.ayah}`,
    source: 'tafsir',
    text: excerptAroundMatch(hit.text, terms),
    reference: `سورة ${surahName(hit.surah)} — الآية ${toArabicNumber(hit.ayah)}`,
    detail: hit.editionTitle,
    target: {
      screen: 'quran',
      params: { openSurahId: hit.surah, openAyah: hit.ayah, openTafsir: true },
    },
  };
}

/**
 * The three sources that answer from an index.
 *
 * Quran and adhkar are read synchronously and hadith is fetched alongside
 * them, so the first screenful of results never waits on the commentary scan.
 * A source that fails is dropped rather than thrown: a hadith store in the
 * middle of an update has no business emptying the ayah results next to it.
 */
export async function searchUnifiedCore(
  query: string,
  signal?: AbortSignal,
): Promise<Partial<Record<UnifiedSource, UnifiedResult[]>>> {
  const terms = arabicQueryTerms(query);
  if (terms.length === 0) return {};

  const sections: Partial<Record<UnifiedSource, UnifiedResult[]>> = {
    quran: searchAyahs(query, PER_SOURCE_LIMIT).results.map(toQuranResult),
    adhkar: searchAdhkarFor(query, PER_SOURCE_LIMIT),
  };

  if (signal?.aborted) return sections;

  try {
    const hits = await searchInstalledHadiths(query, { limit: PER_SOURCE_LIMIT });
    if (!signal?.aborted) sections.hadith = hits.map((hit) => toHadithResult(hit, terms));
  } catch {
    // Nothing on the device yet, or the store could not be read: the other
    // three sources are still a complete answer.
  }

  return sections;
}

/**
 * The fourth source, which is the only one that cannot be read from an index.
 *
 * Kept apart so it can be awaited on its own: the caller shows what
 * `searchUnifiedCore` returned immediately and fills this in when it lands,
 * which is safe precisely because tafsir is last in the merged list and so
 * cannot reorder anything already on screen.
 */
export async function searchUnifiedTafsir(
  query: string,
  signal?: AbortSignal,
): Promise<UnifiedResult[]> {
  try {
    const hits = await searchInstalledTafsir(query, { signal, limit: PER_SOURCE_LIMIT });
    return hits.map((hit) => toTafsirResult(hit, arabicQueryTerms(query)));
  } catch {
    return [];
  }
}
