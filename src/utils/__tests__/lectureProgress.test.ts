/**
 * The record of what has been heard of the الشيخ's library: how far each lesson got,
 * whether it was finished, and the figures the progress card is built from.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  clearLectureProgress,
  collectionProgress,
  lectureFraction,
  lectureInsight,
  lectureProgressStats,
  lectureRecord,
  lectureStatus,
  listeningJournal,
  markLectureComplete,
  mostListened,
  readLectureProgress,
  recentlyTouched,
  recordLectureProgress,
} from '@/utils/lectureProgress';
import {
  HUWAINI_COURSES,
  HUWAINI_LECTURES,
  HUWAINI_SERIES,
  HUWAINI_STATS,
} from '@/data/scholarHuwaini';

const MINUTE = 60_000;

beforeEach(() => {
  localStorage.clear();
});

describe('recordLectureProgress', () => {
  it('remembers where the needle rests and how far it ever reached', () => {
    recordLectureProgress({ id: 'a', position: 10 * MINUTE, duration: 60 * MINUTE, listenedDelta: 10 });
    recordLectureProgress({ id: 'a', position: 40 * MINUTE, duration: 60 * MINUTE, listenedDelta: 30 });

    const record = lectureRecord('a');
    expect(record.position).toBe(40 * MINUTE);
    expect(record.furthest).toBe(40 * MINUTE);
  });

  it('never lets the high-water mark fall when the listener jumps back', () => {
    recordLectureProgress({ id: 'a', position: 50 * MINUTE, duration: 60 * MINUTE, listenedDelta: 0 });
    // Seeking back to re-hear a passage has not un-heard the rest.
    recordLectureProgress({ id: 'a', position: 5 * MINUTE, duration: 60 * MINUTE, listenedDelta: 0 });

    const record = lectureRecord('a');
    expect(record.position).toBe(5 * MINUTE);
    expect(record.furthest).toBe(50 * MINUTE);
  });

  it('adds to the listened total instead of replacing it', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 12 });
    recordLectureProgress({ id: 'a', position: 2 * MINUTE, duration: 60 * MINUTE, listenedDelta: 8 });

    expect(lectureRecord('a').listened).toBe(20);
  });

  it('counts a lecture finished once the needle passes ninety-five percent', () => {
    recordLectureProgress({ id: 'a', position: 57 * MINUTE, duration: 60 * MINUTE, listenedDelta: 0 });
    expect(lectureRecord('a').completed).toBe(true);
  });

  it('ignores a nonsense position or a negative delta', () => {
    recordLectureProgress({ id: 'a', position: -500, duration: 60 * MINUTE, listenedDelta: -30 });
    const record = lectureRecord('a');
    expect(record.position).toBe(0);
    expect(record.listened).toBe(0);
  });

  it('reads a damaged file as no progress rather than crashing', () => {
    localStorage.setItem('huwaini-progress-v1', 'not json');
    expect(readLectureProgress()).toEqual({});
    expect(lectureRecord('a').listened).toBe(0);

    localStorage.setItem('huwaini-progress-v1', '{"a":{"position":1000,"furthest":2000,"listened":5,"updatedAt":1},"b":null}');
    expect(Object.keys(readLectureProgress())).toEqual(['a']);
  });

  it('keeps a record whose furthest sits above its position consistent', () => {
    localStorage.setItem(
      'huwaini-progress-v1',
      JSON.stringify({ a: { position: 1000, furthest: 500, listened: 1, updatedAt: 1 } }),
    );
    expect(lectureRecord('a').furthest).toBe(1000);
  });
});

describe('markLectureComplete', () => {
  it('marks a lecture done and parks the needle at its end', () => {
    markLectureComplete('a', 60 * MINUTE);
    const record = lectureRecord('a');
    expect(record.completed).toBe(true);
    expect(record.furthest).toBe(60 * MINUTE);
  });

  it('finishes a file with no published length', () => {
    markLectureComplete('a', 0);
    expect(lectureRecord('a').completed).toBe(true);
  });
});

describe('lectureStatus / lectureFraction', () => {
  const duration = 60 * MINUTE;

  it('reads a fresh lecture as new', () => {
    expect(lectureStatus('a', duration)).toBe('new');
    expect(lectureFraction('a', duration)).toBe(0);
  });

  it('reads one partway through as in progress', () => {
    recordLectureProgress({ id: 'a', position: 20 * MINUTE, duration, listenedDelta: 0 });
    expect(lectureStatus('a', duration)).toBe('in-progress');
    expect(lectureFraction('a', duration)).toBeCloseTo(1 / 3, 2);
  });

  it('reads one near the end as almost', () => {
    recordLectureProgress({ id: 'a', position: 54 * MINUTE, duration, listenedDelta: 0 });
    expect(lectureStatus('a', duration)).toBe('almost');
  });

  it('reads a completed lecture as done, whatever the duration says', () => {
    markLectureComplete('a', 0);
    expect(lectureStatus('a', duration)).toBe('done');
    expect(lectureFraction('a', duration)).toBe(1);
  });
});

describe('collectionProgress', () => {
  const lectures = [
    { id: 'l1', seconds: 600 },
    { id: 'l2', seconds: 600 },
    { id: 'l3', seconds: 600 },
  ];

  it('counts finished lessons and points at the next unfinished one', () => {
    markLectureComplete('l1', 600_000);
    recordLectureProgress({ id: 'l2', position: 120_000, duration: 600_000, listenedDelta: 60 });

    const progress = collectionProgress(lectures);
    expect(progress.finished).toBe(1);
    expect(progress.started).toBe(1);
    expect(progress.total).toBe(3);
    expect(progress.nextId).toBe('l2');
    expect(progress.complete).toBe(false);
    expect(progress.listenedSeconds).toBe(60);
  });

  it('reports the whole collection complete once every lesson is done', () => {
    for (const lecture of lectures) markLectureComplete(lecture.id, lecture.seconds * 1000);
    const progress = collectionProgress(lectures);
    expect(progress.complete).toBe(true);
    expect(progress.fraction).toBe(1);
    expect(progress.nextId).toBeNull();
  });

  it('treats an empty collection as not complete', () => {
    const progress = collectionProgress([]);
    expect(progress.total).toBe(0);
    expect(progress.complete).toBe(false);
    expect(progress.nextId).toBeNull();
  });
});

describe('lectureProgressStats', () => {
  it('sums the listened seconds and counts what was heard', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 120 });
    recordLectureProgress({ id: 'b', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 60 });
    markLectureComplete('c', 60 * MINUTE);

    const stats = lectureProgressStats();
    expect(stats.started).toBe(3);
    expect(stats.finished).toBe(1);
    expect(stats.listenedSeconds).toBe(180);
    expect(stats.activeDays).toBe(1);
  });
});

describe('the catalogue the progress card measures against', () => {
  it('counts every recording the الشيخ left, in both lectures and seconds', () => {
    let lectures = 0;
    let seconds = 0;
    for (const course of HUWAINI_COURSES) {
      lectures += course.lectures.length;
      seconds += course.seconds;
    }
    for (const series of HUWAINI_SERIES) {
      lectures += series.lectures.length;
      seconds += series.lectures.reduce((sum, lecture) => sum + lecture.seconds, 0);
    }
    lectures += HUWAINI_LECTURES.length;
    seconds += HUWAINI_LECTURES.reduce((sum, lecture) => sum + lecture.seconds, 0);

    // The card divides the listener's progress by exactly these, so they have to agree
    // with the figures the rest of the page advertises.
    expect(lectures).toBe(HUWAINI_STATS.lectures);
    expect(seconds).toBe(HUWAINI_STATS.seconds);
  });
});

describe('clearLectureProgress / recentlyTouched', () => {
  it('forgets one lecture without touching the others', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 1 });
    recordLectureProgress({ id: 'b', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 1 });
    clearLectureProgress('a');

    expect(lectureRecord('a').listened).toBe(0);
    expect(lectureRecord('b').listened).toBe(1);
  });

  it('orders the touched lectures newest first', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 1 });
    now.mockReturnValue(2_000);
    recordLectureProgress({ id: 'b', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 1 });
    now.mockRestore();

    const touched = recentlyTouched();
    expect(touched.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
});

describe('lectureInsight', () => {
  const duration = 60 * MINUTE;

  it('reads an untouched lecture as new, with nothing heard', () => {
    const insight = lectureInsight('a', duration);
    expect(insight.status).toBe('new');
    expect(insight.fraction).toBe(0);
    expect(insight.touched).toBe(false);
    expect(insight.heardSeconds).toBe(0);
    // Nothing has been heard, so all of it is still to come.
    expect(insight.remainingSeconds).toBe(3600);
  });

  it('measures what has been heard and what is left', () => {
    recordLectureProgress({ id: 'a', position: 15 * MINUTE, duration, listenedDelta: 900 });
    const insight = lectureInsight('a', duration);
    expect(insight.status).toBe('in-progress');
    expect(insight.fraction).toBeCloseTo(0.25, 2);
    expect(insight.heardSeconds).toBe(900);
    expect(insight.remainingSeconds).toBe(2700);
    expect(insight.touched).toBe(true);
  });

  it('leaves nothing remaining once a lecture is done', () => {
    markLectureComplete('a', duration);
    const insight = lectureInsight('a', duration);
    expect(insight.status).toBe('done');
    expect(insight.fraction).toBe(1);
    expect(insight.remainingSeconds).toBe(0);
  });

  it('marks a lecture with no published length as touched but unmeasured', () => {
    // The player knows only that something was heard; the catalogue's duration is what the
    // row measures against, so a fraction is available even when the file reported none.
    recordLectureProgress({ id: 'a', position: 5000, duration: 0, listenedDelta: 30 });
    const insight = lectureInsight('a', 0);
    expect(insight.touched).toBe(true);
    expect(insight.fraction).toBe(0);
    expect(insight.heardSeconds).toBe(0);
  });
});

describe('listeningJournal', () => {
  it('returns the requested number of days, newest first, gaps included', () => {
    const journal = listeningJournal(7);
    expect(journal).toHaveLength(7);
    for (const day of journal) {
      expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(day.seconds).toBe(0);
    }
    // Strictly descending dates.
    for (let i = 1; i < journal.length; i += 1) {
      expect(journal[i - 1].day > journal[i].day).toBe(true);
    }
  });

  it('totals today’s listening on today’s row', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 120 });
    recordLectureProgress({ id: 'b', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 60 });
    const journal = listeningJournal(3);
    expect(journal[0].seconds).toBe(180);
    expect(journal[0].lectures).toBe(2);
  });
});

describe('mostListened', () => {
  it('ranks lectures by real seconds heard, longest first', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 60 });
    recordLectureProgress({ id: 'b', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 300 });
    recordLectureProgress({ id: 'c', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 120 });

    const top = mostListened(2);
    expect(top.map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(top[0].listenedSeconds).toBe(300);
  });

  it('leaves out lectures that were only opened, never played', () => {
    recordLectureProgress({ id: 'a', position: MINUTE, duration: 60 * MINUTE, listenedDelta: 0 });
    expect(mostListened()).toEqual([]);
  });
});
