import { getSurah, toArabicNumber } from '@/data/surahs';

export interface AyahBookmarkExport {
  surahId: number;
  ayahNumber: number;
  /** The mushaf's own text, when the ayah is one the app has embedded. */
  text?: string;
}

/**
 * Renders every saved mark — ayahs and pages — as one block of text.
 *
 * The screen has always been able to copy *an* ayah, which is no use to anyone
 * who marked forty of them: the marks existed only inside the app, in a list
 * that could be read but not taken anywhere. This turns the whole collection
 * into something that can be pasted into a notebook, a message, or a document
 * of what was memorised this year — grouped by surah, with the mushaf's own
 * spelling of each ayah and the page list at the end.
 */
export function buildBookmarksExport(
  ayahs: readonly AyahBookmarkExport[],
  pages: readonly number[],
): string {
  if (ayahs.length === 0 && pages.length === 0) return '';

  const lines: string[] = ['محفوظاتي — قُرّة', ''];

  if (ayahs.length > 0) {
    lines.push(
      `${toArabicNumber(ayahs.length)} ${arabicCount(
        ayahs.length,
        'آية',
        'آيتان',
        'آيات',
        'آية',
      )}`,
      '',
    );

    // Grouped by surah, and each group in ayah order — the same order the
    // screen shows, so an exported list lines up with the one on the phone.
    const groups = new Map<number, AyahBookmarkExport[]>();
    for (const bm of ayahs) {
      const list = groups.get(bm.surahId) ?? [];
      list.push(bm);
      groups.set(bm.surahId, list);
    }
    for (const [surahId, rows] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`سورة ${getSurah(surahId)?.name ?? toArabicNumber(surahId)}`);
      for (const row of [...rows].sort((a, b) => a.ayahNumber - b.ayahNumber)) {
        const number = `الآية ${toArabicNumber(row.ayahNumber)}`;
        lines.push(row.text ? `﴿${row.text}﴾ — ${number}` : number);
      }
      lines.push('');
    }
  }

  if (pages.length > 0) {
    lines.push(
      `${toArabicNumber(pages.length)} ${arabicCount(pages.length, 'صفحة', 'صفحتان', 'صفحات', 'صفحة')} محفوظة`,
      [...pages].sort((a, b) => a - b)
        .map((page) => toArabicNumber(page))
        .join('، '),
      '',
    );
  }

  return lines.join('\n').trimEnd();
}

/**
 * Counts a noun the way Arabic counts it: one, two, then the plural for three
 * up to ten, and the singular again past ten — «١١ آية», not «١١ آيات».
 */
function arabicCount(count: number, one: string, two: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count === 2) return two;
  const lastTwo = count % 100;
  if (lastTwo >= 3 && lastTwo <= 10) return few;
  return many;
}
