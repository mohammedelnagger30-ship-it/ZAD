import { trustedNow } from '@/utils/clock';

export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return formatDateKey(trustedNow());
}

export function getDayName(date: Date): string {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return days[date.getDay()];
}

export function getDayNameShort(dayNum: number): string {
  const days = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  return days[dayNum] || '';
}

/** Gregorian months as an Arabic reader writes them — 0-indexed. */
export const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export function formatArabicDate(date: Date): string {
  return `${date.getDate()} ${ARABIC_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The Hijri date for `date`, optionally corrected by whole days.
 *
 * Moon-sighting calendars can disagree by a day, so surfaces offer a manual
 * ±1 correction: the offset shifts the instant handed to the calendar, which
 * is exactly "show tomorrow's / yesterday's Hijri date".
 */
export function getHijriDate(date: Date, adjustmentDays = 0): string {
  try {
    const adjusted = adjustmentDays === 0 ? date : addDays(date, adjustmentDays);
    // Umm al-Qura, not the tabular calendar `ca-islamic` gives. The tabular
    // one is arithmetic: a fixed formula, no observation, and it drifts a day
    // or two from the crescent people actually saw. Umm al-Qura is the
    // calendar Saudi Arabia declares by — the one a mosque wall and a printed
    // almanac agree on — so a reader comparing the app to the notice by the
    // door gets the same date.
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(adjusted);
    return hijri;
  } catch {
    return '';
  }
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function getLast7Days(): string[] {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days.push(formatDateKey(addDays(trustedNow(), -i)));
  }
  return days;
}

export function getLast30Days(): string[] {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(formatDateKey(addDays(trustedNow(), -i)));
  }
  return days;
}

export function getWeekRange(): { start: Date; end: Date } {
  const now = trustedNow();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
