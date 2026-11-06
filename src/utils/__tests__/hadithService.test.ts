import './jsdomPolyfills';
import { describe, expect, it } from '@jest/globals';
import { hadithOfDayFrom, type HadithRecord } from '@/utils/hadithService';

function hadith(id: string, text: string, grades: HadithRecord['grades'] = ['sahih']): HadithRecord {
  const [collectionId, numberText] = id.split(':');
  const number = Number(numberText);
  return {
    id,
    collectionId,
    collectionTitle: collectionId,
    number,
    arabicNumber: number,
    text,
    section: 0,
    sectionTitle: '',
    grades,
    graders: [],
  };
}

describe('hadithOfDayFrom', () => {
  const short = hadith('jami_tirmidhi:1', 'إنما الأعمال بالنيات.');
  const long = hadith('sahih_bukhari:2', 'حديث طويل '.repeat(30));

  it('selects deterministically from the available hadiths for the day', () => {
    const records = [short, long];
    const first = hadithOfDayFrom(records, new Date(2026, 0, 1));
    const later = hadithOfDayFrom(records, new Date(2026, 0, 1, 21));

    expect(first).toBe(later);
    expect(records).toContain(first);
  });

  it('prefers sahih narrations and falls back when none are graded sahih', () => {
    const weakShort = hadith('forty_qudsi:4', 'حديث قصير مشهور.', ['daif']);
    expect(hadithOfDayFrom([weakShort, short], new Date(2026, 0, 1))).toBe(short);
    expect(hadithOfDayFrom([weakShort], new Date(2026, 0, 1))).toBe(weakShort);
    expect(hadithOfDayFrom([], new Date(2026, 0, 1))).toBeNull();
  });
});
