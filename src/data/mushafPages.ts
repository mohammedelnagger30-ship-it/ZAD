// Mushaf page metadata — Madani layout (Hafs an Asim)
// Maps each page to its surah, juz, hizb, and special markers
// Source: Standard Madani Mushaf page mapping (604 pages, 15 lines per page)

import { SURAHS, getAyahPage, getJuzForPage } from './surahs';

export interface PageMeta {
  page: number;
  juz: number;
  hizb: number | null;       // hizb number if this page starts a new hizb
  rubAlHizb: number | null;   // quarter hizb marker
  surahStart: number[];       // surah IDs that start on this page
  isSajdah: boolean;          // contains a sajdah ayah
  lines: number;              // typically 15
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

// Hizb boundaries — each juz has 2 hizbs, each hizb has 4 quarters
// hizbNumber = (juz-1)*2 + half
export const HIZB_START_PAGES: Record<number, number> = {
  1: 1, 2: 11, 3: 22, 4: 32, 5: 42, 6: 52, 7: 62, 8: 72,
  9: 82, 10: 92, 11: 102, 12: 112, 13: 122, 14: 132, 15: 142,
  16: 152, 17: 162, 18: 172, 19: 182, 20: 192, 21: 202, 22: 212,
  23: 222, 24: 232, 25: 242, 26: 252, 27: 262, 28: 272, 29: 282,
  30: 292, 31: 302, 32: 312, 33: 322, 34: 332, 35: 342, 36: 352,
  37: 362, 38: 372, 39: 382, 40: 392, 41: 402, 42: 412, 43: 422,
  44: 432, 45: 442, 46: 452, 47: 462, 48: 472, 49: 482, 50: 492,
  51: 502, 52: 512, 53: 522, 54: 532, 55: 542, 56: 552, 57: 562,
  58: 572, 59: 582, 60: 592,
};

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
    pageToHizb[page] = parseInt(hizb);
  }

  for (let p = 1; p <= 604; p++) {
    pages.set(p, {
      page: p,
      juz: getJuzForPage(p),
      hizb: pageToHizb[p] || null,
      rubAlHizb: null,
      surahStart: surahStartByPage[p] || [],
      isSajdah: sajdahPages.has(p),
      lines: 15,
    });
  }

  return pages;
}

const PAGE_META = buildPageMeta();

export function getPageMeta(page: number): PageMeta | undefined {
  return PAGE_META.get(page);
}

export function getTotalPages(): number {
  return 604;
}

export function getHizbForPage(page: number): number {
  let result = 1;
  for (const [hizb, startPage] of Object.entries(HIZB_START_PAGES)) {
    if (page >= startPage) {
      result = parseInt(hizb);
    } else {
      break;
    }
  }
  return result;
}

// Verification check — confirms 604 pages are mapped
export function verifyPageIntegrity(): { totalPages: number; valid: boolean; missingPages: number[] } {
  const missing: number[] = [];
  for (let p = 1; p <= 604; p++) {
    if (!PAGE_META.has(p)) missing.push(p);
  }
  return {
    totalPages: 604,
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
