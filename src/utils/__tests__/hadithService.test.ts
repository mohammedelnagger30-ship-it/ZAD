import './jsdomPolyfills';
import { describe, expect, it } from '@jest/globals';
import { selectDailyHadith, type HadithRecord } from '@/utils/hadithService';

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

describe('selectDailyHadith', () => {
  const short = hadith('jami_tirmidhi:1', 'إنما الأعمال بالنيات.');
  const long = hadith('sahih_bukhari:2', 'حديث طويل '.repeat(30));

  it('alternates between short and long sahih hadiths from installed books', async () => {
    await expect(selectDailyHadith([short, long], new Date(2026, 0, 1))).resolves.toBe(short);
    await expect(selectDailyHadith([short, long], new Date(2026, 0, 2))).resolves.toBe(long);
  });

  it('returns the same selection throughout the same day', async () => {
    const records = [short, hadith('forty_qudsi:3', 'حديث قصير آخر.')];
    const first = await selectDailyHadith(records, new Date(2026, 0, 1, 8));
    const later = await selectDailyHadith(records, new Date(2026, 0, 1, 21));

    expect(later?.id).toBe(first?.id);
  });

  it('uses the available length group if the preferred group is empty', async () => {
    await expect(selectDailyHadith([short], new Date(2026, 0, 2))).resolves.toBe(short);
    await expect(selectDailyHadith([], new Date(2026, 0, 1))).resolves.toBeNull();
  });

  it('prefers sahih narrations within the selected length group', async () => {
    const weakShort = hadith('forty_qudsi:4', 'حديث قصير مشهور.', ['daif']);
    await expect(
      selectDailyHadith([weakShort, short], new Date(2026, 0, 1)),
    ).resolves.toBe(short);
  });
});
