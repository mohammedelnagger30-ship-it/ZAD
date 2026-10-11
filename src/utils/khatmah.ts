import { db } from '@/db/database';
import type { KhatmahPlan } from '@/db/database';
import { TOTAL_QURAN_PAGES } from '@/data/surahs';
import { formatDateKey } from '@/utils/dateUtils';

/**
 * Quran-completion (khatmah) plan logic.
 *
 * Progress is measured in mushaf-flow pages — the same numbering the reader
 * and the mushaf view use — so "الصفحة ٥٨" here and in the mushaf are the same
 * page. The arithmetic lives here as pure functions so the plan maths can be
 * tested without a database; the db wrappers below stay thin.
 */

/** Whole days from `a` to `b` (negative when `b` is earlier). */
function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`);
  return Math.round(ms / 86_400_000);
}

/** The ISO date `days` whole days after `iso`. */
function plusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}

export interface KhatmahStatus {
  totalPages: number;
  completed: number;
  percent: number;
  remaining: number;
  /** Days left including today; null when the plan has no target date. */
  daysLeft: number | null;
  /** Pages per day needed to finish on the target date (ceil); null without a reachable target. */
  pagesPerDay: number | null;
  finished: boolean;
}

/**
 * Derives everything the card shows from a plan and today's date key.
 *
 * A target of N days means N reading days including the start day, so a plan
 * started on the target's last day still counts as one day left. Once the
 * target date has passed the daily rate stops being meaningful and is null —
 * the remaining count still tells the user what is left.
 */
export function describeKhatmah(plan: KhatmahPlan, today: string): KhatmahStatus {
  const completed = Math.min(Math.max(plan.currentPage, 0), TOTAL_QURAN_PAGES);
  const remaining = TOTAL_QURAN_PAGES - completed;
  const percent = Math.round((completed / TOTAL_QURAN_PAGES) * 100);
  const finished = remaining <= 0;

  let daysLeft: number | null = null;
  let pagesPerDay: number | null = null;
  if (plan.targetDate) {
    daysLeft = daysBetween(today, plan.targetDate) + 1;
    if (daysLeft > 0) {
      pagesPerDay = Math.max(1, Math.ceil(remaining / daysLeft));
    }
  }

  return { totalPages: TOTAL_QURAN_PAGES, completed, percent, remaining, daysLeft, pagesPerDay, finished };
}

/**
 * A fresh plan starting `today`.
 *
 * `targetDays` counts reading days including today, so a 30-day plan started
 * on October 10 has its last reading day on November 8: start + (30 - 1).
 */
export function createKhatmahPlan(today: string, targetDays: number | null): KhatmahPlan {
  return {
    startDate: today,
    targetDate: targetDays === null ? null : plusDays(today, targetDays - 1),
    currentPage: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Where the plan's cursor goes when the reader lands on `landed` — null when
 * the landing teaches the plan nothing: an impossible page, or one at or behind
 * the cursor, since re-reading and jumping backwards claim no new ground. A
 * finished plan cannot be moved by reading further; the total is the total.
 */
export function nextKhatmahCursor(currentPage: number, landed: number): number | null {
  if (!Number.isFinite(landed) || landed < 1 || landed > TOTAL_QURAN_PAGES) return null;
  if (landed <= currentPage) return null;
  return landed;
}

/** Loads the most recent plan; the table is a singleton by discipline, not by schema. */
export async function loadKhatmah(): Promise<KhatmahPlan | null> {
  const rows = await db.khatmah.toArray();
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows[0];
}

/** Inserts or updates a plan, returning it with the assigned id. */
export async function saveKhatmah(plan: KhatmahPlan): Promise<KhatmahPlan> {
  const id = await db.khatmah.put(plan);
  return { ...plan, id };
}

/** Ends the current plan (used by «إنهاء» and by starting fresh after a finish). */
export async function clearKhatmah(): Promise<void> {
  await db.khatmah.clear();
}

/**
 * Advance the running plan with a page the reader actually landed on, so the
 * daily count follows the mushaf instead of a hand-pressed +1. The mushaf
 * reports every settled page; forward readings move the plan, everything else
 * and a missing plan cost a read and nothing more. Returns the new cursor, or
 * null when nothing moved.
 */
export async function creditKhatmahPage(landed: number): Promise<number | null> {
  const plan = await loadKhatmah();
  if (!plan) return null;
  const next = nextKhatmahCursor(plan.currentPage, landed);
  if (next === null) return null;
  await saveKhatmah({ ...plan, currentPage: next, updatedAt: Date.now() });
  return next;
}
