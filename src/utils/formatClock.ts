import { toArabicDigits } from '@/data/surahs';

/**
 * `3:05`, or `1:03:05` once it runs past the hour — in Arabic-Indic digits. A clock, not
 * an ayah number, and long enough for a two-hour lecture.
 */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return toArabicDigits(clock);
}

/** `1.2 ساعة` / `45 دقيقة` — how long a collection is, in words. */
export function formatDurationWords(seconds: number): string {
  if (seconds <= 0) return 'مدة غير معلومة';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${toArabicDigits(hours)} س ${minutes > 0 ? `${toArabicDigits(minutes)} د` : ''}`.trim();
  return `${toArabicDigits(Math.max(1, minutes))} دقيقة`;
}

/** `3.4 ميجابايت` / `1.2 جيجابايت`. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / 1048576;
  if (mb < 1) return `${toArabicDigits(Math.max(1, Math.round(bytes / 1024)))} كيلوبايت`;
  if (mb < 1024) return `${toArabicDigits(mb.toFixed(mb < 10 ? 1 : 0))} ميجابايت`;
  return `${toArabicDigits((mb / 1024).toFixed(1))} جيجابايت`;
}
