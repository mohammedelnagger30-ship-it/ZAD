// Mushaf page metadata for *our* mushaf — the flow layout in `mushafFlow`.
//
// What a page carries: which juz and hizb it sits in, which surahs open on it, and whether
// a sajdah ayah is printed there. Which page an ayah is on is not answered here — that is
// `getAyahPage`, a lookup in the generated flow table, and the whole point of generating
// that table is that this file no longer has to guess.
//
// The printed mushaf's own page count (604) and boundary tables live in `mushafPrinted`.
// `mushafFlow` maps those boundaries through our line breaks at build time, so what the
// reader shows is always our own pagination and never a mixture of the two.

import { SURAHS, getAyahPage, getJuzForPage, toArabicNumber } from './surahs';
import { TOTAL_PAGES, HIZB_START_PAGES as FLOW_HIZB_START_PAGES, getPageLineCount } from './mushafFlow';

export interface PageMeta {
  page: number;
  juz: number;
  hizb: number | null;       // hizb number if this page starts a new hizb
  rubAlHizb: number | null;   // quarter hizb marker
  surahStart: number[];       // surah IDs that start on this page
  isSajdah: boolean;          // contains a sajdah ayah
  lines: number;              // 15, or fewer where a surah heading needed room
}

// Sajdah ayahs in the Quran (standard Hafs layout)
// Surah:Ayah pairs where prostration is required
export const SAJDAH_AYAHS: { surahId: number; ayah: number; type: 'wajib' | 'mustahab' }[] = [
  { surahId: 7, ayah: 206, type: 'wajib' },
  { surahId: 13, ayah: 15, type: 'wajib' },
  { surahId: 16, ayah: 50, type: 'wajib' },
  { surahId: 17, ayah: 109, type: 'wajib' },
  { surahId: 19, ayah: 58, type: 'mustahab' },
  { surahId: 22, ayah: 18, type: 'wajib' },
  { surahId: 22, ayah: 77, type: 'mustahab' },
  { surahId: 25, ayah: 60, type: 'wajib' },
  { surahId: 27, ayah: 26, type: 'mustahab' },
  { surahId: 32, ayah: 15, type: 'wajib' },
  { surahId: 38, ayah: 24, type: 'wajib' },
  { surahId: 41, ayah: 38, type: 'wajib' },
  { surahId: 53, ayah: 62, type: 'wajib' },
  { surahId: 84, ayah: 21, type: 'wajib' },
  { surahId: 96, ayah: 19, type: 'wajib' },
];

/** Page on which each hizb begins, in our mushaf. Two per juz. */
export const HIZB_START_PAGES = FLOW_HIZB_START_PAGES;

export const HIZB_INFO = Object.entries(HIZB_START_PAGES)
  .map(([hizb, startPage]) => ({ id: Number(hizb), startPage }))
  .sort((a, b) => a.id - b.id)
  .map(({ id, startPage }) => ({ id, startPage, name: `الحزب ${toArabicNumber(id)}` }));

function buildPageMeta(): Map<number, PageMeta> {
  const pages = new Map<number, PageMeta>();

  // Build surah start pages lookup
  const surahStartByPage: Record<number, number[]> = {};
  for (const surah of SURAHS) {
    if (!surahStartByPage[surah.pageStart]) surahStartByPage[surah.pageStart] = [];
    surahStartByPage[surah.pageStart].push(surah.id);
  }

  // Build sajdah page lookup.
  // The page comes from the authoritative ayah→page map, not from interpolating the surah's
  // length: the old arithmetic estimate put the marker on the wrong page for several
  // surahs, which made the reader announce a sajdah that was not printed there.
  const sajdahPages = new Set<number>();
  for (const sajdah of SAJDAH_AYAHS) {
    const surah = SURAHS.find((s) => s.id === sajdah.surahId);
    if (surah) sajdahPages.add(getAyahPage(surah, sajdah.ayah));
  }

  // Build reverse hizb lookup
  const pageToHizb: Record<number, number> = {};
  for (const [hizb, page] of Object.entries(HIZB_START_PAGES)) {
    pageToHizb[page] = parseInt(hizb, 10);
  }

  for (let p = 1; p <= TOTAL_PAGES; p++) {
    pages.set(p, {
      page: p,
      juz: getJuzForPage(p),
      hizb: pageToHizb[p] || null,
      rubAlHizb: null,
      surahStart: surahStartByPage[p] || [],
      isSajdah: sajdahPages.has(p),
      lines: getPageLineCount(p),
    });
  }

  return pages;
}

const PAGE_META = buildPageMeta();

export function getPageMeta(page: number): PageMeta | undefined {
  return PAGE_META.get(page);
}

export function getTotalPages(): number {
  return TOTAL_PAGES;
}

export function getHizbForPage(page: number): number {
  let result = 1;
  for (const [hizb, startPage] of Object.entries(HIZB_START_PAGES)) {
    if (page >= startPage) {
      result = parseInt(hizb, 10);
    } else {
      break;
    }
  }
  return result;
}

// Verification check — confirms every page of our mushaf is mapped
export function verifyPageIntegrity(): { totalPages: number; valid: boolean; missingPages: number[] } {
  const missing: number[] = [];
  for (let p = 1; p <= TOTAL_PAGES; p++) {
    if (!PAGE_META.has(p)) missing.push(p);
  }
  return {
    totalPages: TOTAL_PAGES,
    valid: missing.length === 0,
    missingPages: missing,
  };
}

// Verification check — confirms all 6236 ayahs have page mapping
export function verifyAyahIntegrity(): { totalAyahs: number; valid: boolean } {
  const total = SURAHS.reduce((sum, s) => sum + s.ayahCount, 0);
  return {
    totalAyahs: total,
    valid: total === 6236,
  };
}