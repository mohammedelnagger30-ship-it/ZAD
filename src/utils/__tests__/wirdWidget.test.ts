/**
 * The widget is drawn from this text with no app behind it, so whatever is
 * wrong here is what a person reads on their home screen for a day: an
 * overflow counted as «٣ مهمة» instead of «٣ مهام», or three ticked boxes
 * standing where the one portion still to do should be.
 *
 * The prayer side matters more still. A list that lets the last prayer of
 * the day pass without a replacement leaves the widget blank overnight, and
 * a widget that includes sunrise will announce the شروق as though it were a
 * prayer to answer.
 */
import { describe, it, expect } from '@jest/globals';
import {
  WIRD_TASK_LINES,
  composeWirdPrayers,
  composeWirdTasks,
  type WirdTaskRow,
} from '@/utils/wirdWidget';

const hifz = (portion: string, status = 'pending'): WirdTaskRow => ({
  type: 'hifz',
  portion,
  status,
});
const muraja = (portion: string, status = 'pending'): WirdTaskRow => ({
  type: 'muraja',
  portion,
  status,
});

describe('composeWirdTasks', () => {
  it('says so in words when there is nothing to do', () => {
    expect(composeWirdTasks([])).toBe('لا واجبات اليوم');
  });

  it('says so in words when the day is finished', () => {
    expect(
      composeWirdTasks([hifz('surah:2:1-5', 'done'), muraja('juz:30', 'done')]),
    ).toBe('أتممت ورد اليوم');
  });

  it('marks what is done and what is not', () => {
    // Undone first, so the order here is the reverse of the argument's.
    const lines = composeWirdTasks([hifz('surah:2:1-5', 'done'), muraja('juz:30')]).split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^○ /);
    expect(lines[1]).toMatch(/^✓ /);
  });

  /**
   * A plan that generates four portions a day used to be able to fill every
   * line with ticked boxes and hide the one still to do — the widget would
   * have reported the past while the present sat on the next line down.
   */
  it('puts what is left to do before what is already done', () => {
    const lines = composeWirdTasks([
      hifz('surah:2:1-5', 'done'),
      hifz('surah:2:6-10'),
      muraja('juz:30', 'done'),
      hifz('surah:2:11-15'),
    ]).split('\n');

    // Three lines of task, plus the one that counts what is left over.
    expect(lines).toHaveLength(WIRD_TASK_LINES + 1);
    expect(lines.slice(0, 2).every((line) => line.startsWith('○'))).toBe(true);
    expect(lines[2].startsWith('✓')).toBe(true);
    expect(lines[3]).toBe('ومهمة واحدة');
  });

  /** The remainder is counted, so it has to be counted the way Arabic counts. */
  it('counts what it cannot show, with the noun the number takes', () => {
    const overflow = (extra: number) =>
      composeWirdTasks([
        ...Array.from({ length: extra }, (_, index) => hifz(`surah:2:${index + 1}`)),
      ]).split('\n');

    expect(overflow(3)[3]).toBeUndefined();
    expect(overflow(4)[3]).toBe('ومهمة واحدة');
    expect(overflow(5)[3]).toBe('ومهمتان');
    expect(overflow(6)[3]).toBe('و٣ مهام');
    expect(overflow(7)[3]).toBe('و٤ مهام');
    expect(overflow(14)[3]).toBe('و١١ مهمة');
  });

  it('names the portion and the kind of work', () => {
    const lines = composeWirdTasks([muraja('juz:30')]).split('\n');

    expect(lines[0]).toContain('مراجعة');
    expect(lines[0]).toContain('الجزء');
  });
});

describe('composeWirdPrayers', () => {
  const day = [
    { name: 'fajr', arabicName: 'الفجر', time: new Date('2026-10-15T02:30:00Z') },
    { name: 'sunrise', arabicName: 'الشروق', time: new Date('2026-10-15T04:00:00Z') },
    { name: 'dhuhr', arabicName: 'الظهر', time: new Date('2026-10-15T09:30:00Z') },
    { name: 'asr', arabicName: 'العصر', time: new Date('2026-10-15T12:45:00Z') },
    { name: 'maghrib', arabicName: 'المغرب', time: new Date('2026-10-15T15:00:00Z') },
    { name: 'isha', arabicName: 'العشاء', time: new Date('2026-10-15T16:30:00Z') },
  ];
  const tomorrow = [
    { name: 'fajr', arabicName: 'الفجر', time: new Date('2026-10-16T02:30:00Z') },
    { name: 'sunrise', arabicName: 'الشروق', time: new Date('2026-10-16T04:00:00Z') },
  ];
  const at = (iso: string) => new Date(iso).getTime();

  it('keeps only what is still ahead, in order', () => {
    const prayers = composeWirdPrayers({
      today: day,
      tomorrow,
      nowMs: at('2026-10-15T10:00:00Z'),
      timeZone: 'UTC',
    });

    expect(prayers.map((prayer) => prayer.name)).toEqual(['العصر', 'المغرب', 'العشاء', 'الفجر']);
    expect(prayers.every((prayer, index) => index === 0 || prayer.timeMillis > prayers[index - 1].timeMillis)).toBe(true);
  });

  /** The شروق is a marker in the day, not something to pray. */
  it('never announces sunrise as the next prayer', () => {
    const prayers = composeWirdPrayers({
      today: day,
      tomorrow,
      // Between fajr and sunrise, where sunrise is the next thing on the clock.
      nowMs: at('2026-10-15T03:00:00Z'),
      timeZone: 'UTC',
    });

    expect(prayers.map((prayer) => prayer.name)).toEqual(['الظهر', 'العصر', 'المغرب', 'العشاء', 'الفجر']);
  });

  /**
   * The list is built once and read for the rest of the day. Without
   * tomorrow's fajr in it, the widget would run out of prayers at «العشاء»
   * and sit blank until the app was next opened — which for a widget is
   * whenever the person happens to think of it.
   */
  it('still holds a prayer after the last one of the day', () => {
    const prayers = composeWirdPrayers({
      today: day,
      tomorrow,
      nowMs: at('2026-10-15T17:00:00Z'),
      timeZone: 'UTC',
    });

    expect(prayers).toHaveLength(1);
    expect(prayers[0].name).toBe('الفجر');
    expect(prayers[0].timeMillis).toBe(tomorrow[0].time.getTime());
  });

  it('is empty when the day offers nothing', () => {
    expect(
      composeWirdPrayers({ today: [], tomorrow: [], nowMs: at('2026-10-15T10:00:00Z'), timeZone: 'UTC' }),
    ).toEqual([]);
  });

  it('formats each time for the zone the app was standing in', () => {
    const prayers = composeWirdPrayers({
      today: day,
      tomorrow,
      nowMs: at('2026-10-15T10:00:00Z'),
      timeZone: 'UTC',
    });

    expect(prayers[0].name).toBe('العصر');
    expect(prayers[0].timeLabel).toBe('12:45 م');
  });
});
