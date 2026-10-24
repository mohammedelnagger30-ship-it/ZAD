import { getNotificationDestination } from '@/utils/notificationRouting';
import { SUNNAH_CATEGORIES } from '@/data/sunnah';
import { PROPHET_SECTIONS } from '@/data/prophetData';

describe('getNotificationDestination', () => {
  it('leaves adhan notifications to the adhan overlay listener', () => {
    expect(getNotificationDestination({ type: 'prayer', prayerKey: 'fajr' })).toBeNull();
  });

  it.each(['iqamah', 'prayer-reminder'])('opens prayer times for %s notifications', (type) => {
    expect(getNotificationDestination({ type, prayerKey: 'dhuhr' })).toEqual({
      screen: 'prayer',
      params: { prayerKey: 'dhuhr' },
    });
  });

  it('opens the Quran at a task surah and ayah', () => {
    expect(getNotificationDestination({
      type: 'task',
      taskType: 'hifz',
      portion: 'surah:2:5-10',
    })).toEqual({
      screen: 'quran',
      params: { openSurahId: 2, openAyah: 5, openToAyah: 10, openHifzTest: true },
    });
  });

  it('opens the Quran at the beginning of a task juz', () => {
    expect(getNotificationDestination({
      type: 'task',
      taskType: 'muraja',
      portion: 'juz:1',
    })).toEqual({
      screen: 'quran',
      params: { openPage: 1 },
    });
  });

  it('does not navigate for invalid task targets', () => {
    expect(getNotificationDestination({
      type: 'task',
      taskType: 'hifz',
      portion: 'surah:999',
    })).toBeNull();
    expect(getNotificationDestination({
      type: 'task',
      taskType: 'hifz',
      portion: 'page:0',
    })).toBeNull();
    expect(getNotificationDestination({
      type: 'task',
      taskType: 'hifz',
      portion: 'surah:2:5-300',
    })).toBeNull();
  });

  it('opens the hadith screen on the hadith of the day', () => {
    expect(getNotificationDestination({ type: 'hadith' })).toEqual({
      screen: 'hadith',
      params: { hadithOfDay: true },
    });
  });

  it('opens the Quran at the message-of-the-day verse', () => {
    expect(getNotificationDestination({
      type: 'quran-message',
      surahId: 2,
      ayahNumber: 255,
    })).toEqual({
      screen: 'quran',
      params: { openSurahId: 2, openAyah: 255 },
    });
  });

  it('does not navigate for an invalid Quran message', () => {
    expect(getNotificationDestination({
      type: 'quran-message',
      surahId: 999,
      ayahNumber: 1,
    })).toBeNull();
    expect(getNotificationDestination({
      type: 'quran-message',
      surahId: 1,
      ayahNumber: 99,
    })).toBeNull();
    expect(getNotificationDestination({ type: 'quran-message', surahId: 1 })).toBeNull();
  });

  it('opens the sunnah section and lands on the narration itself', () => {
    const category = SUNNAH_CATEGORIES[0];
    const item = category.items[0];
    expect(getNotificationDestination({
      type: 'sunnah',
      categoryId: category.id,
      itemTitle: item.title,
    })).toEqual({
      screen: 'sunnah',
      params: { categoryId: category.id, itemTitle: item.title },
    });
  });

  it('does not navigate for a sunnah from an unknown section', () => {
    expect(getNotificationDestination({
      type: 'sunnah',
      categoryId: 'not-a-section',
      itemTitle: 'عنوان',
    })).toBeNull();
  });

  it('opens the prophet section and lands on the card itself', () => {
    const section = PROPHET_SECTIONS[0];
    const entry = section.entries[0];
    expect(getNotificationDestination({
      type: 'prophet',
      sectionId: section.id,
      entryTitle: entry.title,
    })).toEqual({
      screen: 'prophet',
      params: { sectionId: section.id, entryTitle: entry.title },
    });
  });

  it('does not navigate for a prophet card from an unknown section', () => {
    expect(getNotificationDestination({
      type: 'prophet',
      sectionId: 'not-a-section',
      entryTitle: 'عنوان',
    })).toBeNull();
  });

  it('opens the nawafil page on the rawatib row a reminder names', () => {
    expect(getNotificationDestination({
      type: 'nawafil',
      nawafilKey: 'rawatib_fajr',
    })).toEqual({
      screen: 'nawafil',
      params: { nawafilKey: 'rawatib_fajr' },
    });
  });

  it('opens the nawafil page on a voluntary prayer a reminder names', () => {
    expect(getNotificationDestination({
      type: 'nawafil',
      nawafilKey: 'witr',
    })).toEqual({
      screen: 'nawafil',
      params: { nawafilKey: 'witr' },
    });
  });

  it('still opens the nawafil page for a reminder with an unknown key', () => {
    // The item list is the right place even when the key is one an older payload
    // invented; only the scroll-and-ring is given up.
    expect(getNotificationDestination({ type: 'nawafil', nawafilKey: 'gone' })).toEqual({
      screen: 'nawafil',
      params: {},
    });
    expect(getNotificationDestination({ type: 'nawafil' })).toEqual({
      screen: 'nawafil',
      params: {},
    });
  });

  it('opens a dhikr notification on the exact reminder it carried', () => {
    expect(getNotificationDestination({
      type: 'dhikr',
      category: 'morning',
      categoryId: 'morning',
      dhikrId: 'm1',
    })).toEqual({
      screen: 'adhkar',
      params: { categoryId: 'morning', dhikrId: 'm1' },
    });
  });

  it('falls back to the reminder kind for older dhikr payloads', () => {
    expect(getNotificationDestination({ type: 'dhikr', category: 'evening' })).toEqual({
      screen: 'adhkar',
      params: { categoryId: 'evening' },
    });
  });

  it('opens a spaced-repetition notification directly in its range quiz', () => {
    expect(getNotificationDestination({
      type: 'hifz-review',
      surahId: 2,
      fromAyah: 10,
      toAyah: 15,
    })).toEqual({
      screen: 'quran',
      params: {
        openSurahId: 2,
        openAyah: 10,
        openToAyah: 15,
        openHifzTest: true,
      },
    });
  });

  it.each([
    ['morning', { screen: 'adhkar', params: { categoryId: 'morning' } }],
    ['evening', { screen: 'adhkar', params: { categoryId: 'evening' } }],
    ['istighfar', { screen: 'tasbih', params: { presetIndex: 4 } }],
  ])('opens the relevant dhikr page for %s reminders', (category, destination) => {
    expect(getNotificationDestination({ type: 'dhikr', category })).toEqual(destination);
  });

  it('ignores malformed or unsupported notification data', () => {
    expect(getNotificationDestination(null)).toBeNull();
    expect(getNotificationDestination({ type: 'unknown' })).toBeNull();
    expect(getNotificationDestination({ type: 'task', taskType: 'other', portion: 'page:1' })).toBeNull();
  });
});
