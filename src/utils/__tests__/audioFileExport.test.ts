import { jest } from '@jest/globals';

const isNativePlatform = jest.fn(() => true);
const writeFile = jest.fn(async (_options: Record<string, unknown>) => ({
  uri: 'file:///cache/quran-audio/test.mp3',
}));
const share = jest.fn(async (_options: Record<string, unknown>) => undefined);

jest.unstable_mockModule('@capacitor/core', () => ({
  Capacitor: { isNativePlatform, isPluginAvailable: () => true },
  registerPlugin: () => ({}),
}));
jest.unstable_mockModule('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile },
}));
jest.unstable_mockModule('@capacitor/share', () => ({ Share: { share } }));

const { exportAudioTrack } = await import('@/utils/audioFileExport');

function track(blob: Blob) {
  return {
    key: 'audio:7:1',
    reciterId: '7',
    surah: 1,
    blob,
    bytes: blob.size,
    verseTimings: [],
    savedAt: 1,
  };
}

describe('exportAudioTrack', () => {
  beforeEach(() => {
    isNativePlatform.mockReturnValue(true);
    writeFile.mockClear();
    share.mockClear();
  });

  it('writes the audio file to cache and opens the device share sheet', async () => {
    const result = await exportAudioTrack(
      track(new Blob(['audio bytes'], { type: 'audio/mpeg' })),
      'مشاري العفاسي',
      'الفاتحة',
    );

    expect(result).toBe('shared');
    expect(writeFile).toHaveBeenCalledWith(expect.objectContaining({
      directory: 'CACHE',
      recursive: true,
      path: expect.stringContaining('مشاري العفاسي - سورة الفاتحة.mp3'),
      data: 'YXVkaW8gYnl0ZXM=',
    }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      files: ['file:///cache/quran-audio/test.mp3'],
      dialogTitle: 'حفظ ملف التلاوة',
    }));
  });

  it('refuses to export an empty audio file', async () => {
    await expect(exportAudioTrack(track(new Blob()), 'قارئ', 'الفاتحة'))
      .rejects.toThrow('ملف التلاوة فارغ');
    expect(writeFile).not.toHaveBeenCalled();
  });
});
