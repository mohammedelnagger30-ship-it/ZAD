import { getNotificationDestination } from '@/utils/notificationRouting';

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

  it('opens the hadith screen', () => {
    expect(getNotificationDestination({ type: 'hadith' })).toEqual({
      screen: 'hadith',
      params: {},
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
