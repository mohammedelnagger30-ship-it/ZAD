/**
 * The Huwaini catalogue.
 *
 * The file is generated from archive.org, and everything in the page — the play button,
 * the downloader, the «is it kept?» check — is keyed by lecture id. A duplicated or
 * empty id would silently play the wrong recording, and a URL that is not the archive's
 * would 404 only when a listener tapped download. Cheap to assert here, expensive to
 * discover in the app.
 */
import { describe, expect, it } from '@jest/globals';
import {
  HUWAINI_COURSES,
  HUWAINI_LECTURES,
  HUWAINI_LIBRARY_ITEM,
  HUWAINI_PROFILE,
  HUWAINI_SERIES,
  HUWAINI_STATS,
  huwayniLectureById,
  huwayniLectureUrl,
  huwayniQualityLabel,
  huwayniQualityTier,
  type HuwainiLecture,
} from '@/data/scholarHuwaini';

/** Every recording the page can offer, with the item it came from. */
function allLectures(): { lecture: HuwainiLecture; item: string }[] {
  return [
    ...HUWAINI_COURSES.flatMap((course) =>
      course.lectures.map((lecture) => ({ lecture, item: course.item })),
    ),
    ...HUWAINI_SERIES.flatMap((series) =>
      series.lectures.map((lecture) => ({ lecture, item: HUWAINI_LIBRARY_ITEM })),
    ),
    ...HUWAINI_LECTURES.map((lecture) => ({ lecture, item: HUWAINI_LIBRARY_ITEM })),
  ];
}

describe('the catalogue', () => {
  it('holds a library worth shipping, not a stub', () => {
    expect(HUWAINI_COURSES.length).toBeGreaterThanOrEqual(10);
    expect(HUWAINI_SERIES.length).toBeGreaterThanOrEqual(20);
    expect(allLectures().length).toBeGreaterThanOrEqual(500);
  });

  it('gives every recording a unique id that is safe as a file name', () => {
    const ids = allLectures().map(({ lecture }) => lecture.id);
    // The id becomes `lecture_store/<id>.mp3`, so it may carry Arabic (the catalogue is
    // Arabic), but never a space, a separator or a control character.
    const safe = /^[\u0600-\u06FFA-Za-z0-9][\u0600-\u06FFA-Za-z0-9-]*$/;
    expect(ids.filter((id) => !safe.test(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the card ids unique too, since the page keys on them', () => {
    const courseIds = HUWAINI_COURSES.map((course) => course.id);
    const seriesIds = HUWAINI_SERIES.map((series) => series.id);
    expect(new Set(courseIds).size).toBe(courseIds.length);
    expect(new Set(seriesIds).size).toBe(seriesIds.length);
    expect(courseIds.filter((id) => seriesIds.includes(id))).toEqual([]);
  });

  it('gives every recording a title, a file and an archive.org item', () => {
    for (const { lecture, item } of allLectures()) {
      expect(lecture.title.trim().length).toBeGreaterThan(1);
      expect(lecture.file.trim().length).toBeGreaterThan(0);
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });

  it('never claims a negative duration or size', () => {
    for (const { lecture } of allLectures()) {
      expect(lecture.seconds).toBeGreaterThanOrEqual(0);
      expect(lecture.bytes).toBeGreaterThanOrEqual(0);
    }
  });

  it('resolves every id back to the recording it belongs to', () => {
    for (const { lecture, item } of allLectures()) {
      const ref = huwayniLectureById(lecture.id);
      expect(ref).not.toBeNull();
      expect(ref?.lecture.file).toBe(lecture.file);
      expect(ref?.item).toBe(item);
    }
    expect(huwayniLectureById('no-such-lecture')).toBeNull();
  });

  it('builds https archive.org URLs for every recording', () => {
    for (const { lecture, item } of allLectures()) {
      const url = huwayniLectureUrl(item, lecture.file);
      expect(url.startsWith('https://archive.org/download/')).toBe(true);
      expect(url.startsWith(`https://archive.org/download/${item}/`)).toBe(true);
      // The file name is escaped, so a space or a bracket cannot break the URL.
      expect(url).not.toMatch(/[^\x21-\x7e]/);
    }
  });

  it('reports statistics that match the catalogue it ships', () => {
    expect(HUWAINI_STATS.courses).toBe(HUWAINI_COURSES.length);
    expect(HUWAINI_STATS.series).toBe(HUWAINI_SERIES.length);
    expect(HUWAINI_STATS.lectures).toBe(allLectures().length);
    expect(HUWAINI_STATS.seconds).toBe(
      allLectures().reduce((total, { lecture }) => total + lecture.seconds, 0),
    );
    expect(HUWAINI_STATS.bytes).toBe(
      allLectures().reduce((total, { lecture }) => total + lecture.bytes, 0),
    );
  });

  it('carries a biography for the page to introduce him with', () => {
    expect(HUWAINI_PROFILE.name).toContain('الحويني');
    expect(HUWAINI_PROFILE.honorific.length).toBeGreaterThan(0);
    expect(HUWAINI_PROFILE.bio.length).toBeGreaterThanOrEqual(2);
    expect(HUWAINI_PROFILE.teachers.length).toBeGreaterThan(0);
    expect(HUWAINI_PROFILE.source.startsWith('https://')).toBe(true);
  });
});

describe('quality tiers', () => {
  it('ranks a higher bitrate no worse than a lower one', () => {
    const order = { low: 0, medium: 1, high: 2 } as const;
    expect(order[huwayniQualityTier(192)]).toBeGreaterThanOrEqual(order[huwayniQualityTier(128)]);
    expect(order[huwayniQualityTier(128)]).toBeGreaterThanOrEqual(order[huwayniQualityTier(64)]);
    expect(order[huwayniQualityTier(64)]).toBeGreaterThanOrEqual(order[huwayniQualityTier(32)]);
  });

  it('says so plainly when the bitrate is unknown', () => {
    expect(huwayniQualityLabel(0)).toContain('غير معلومة');
    expect(huwayniQualityLabel(192)).toContain('192');
  });
});
