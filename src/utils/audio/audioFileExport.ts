import { Capacitor } from '@capacitor/core';
import type { AudioTrack } from '@/utils/contentStore';

export type AudioFileExportOutcome = 'downloaded' | 'shared';

function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '-').trim();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('تعذّر تجهيز ملف التلاوة.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('تعذّر تجهيز ملف التلاوة.'));
        return;
      }
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('تعذّر تجهيز ملف التلاوة.'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Export an already-downloaded track to the device's Files/download destination. */
export async function exportAudioTrack(
  track: AudioTrack,
  reciterName: string,
  surahName: string,
): Promise<AudioFileExportOutcome> {
  if (!track.blob.size) throw new Error('ملف التلاوة فارغ ولا يمكن تصديره.');
  const filename = `${safeFilePart(reciterName)} - سورة ${safeFilePart(surahName)}.mp3`;

  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(track.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'downloaded';
  }

  const { Directory, Filesystem } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const path = `quran-audio/${Date.now()}-${filename}`;
  const { uri } = await Filesystem.writeFile({
    path,
    data: await blobToBase64(track.blob),
    directory: Directory.Cache,
    recursive: true,
  });
  await Share.share({
    files: [uri],
    title: filename,
    dialogTitle: 'حفظ ملف التلاوة',
  });
  return 'shared';
}
