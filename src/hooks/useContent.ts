// Download state for tafsir, hadith and recitation audio.
//
// `contentStore` notifies subscribers whenever something is written or deleted, so these
// hooks re-read the store instead of polling or guessing. That is what keeps the library
// screen, the tafsir sheet and the hadith screen consistent with each other: a download
// started in one place shows as finished everywhere without any of them knowing.

import { useCallback, useEffect, useState } from 'react';
import {
  audioStatusInStore,
  hadithBooksInStore,
  storageSummary,
  subscribeToContent,
  tafsirSurahsInStore,
  type StorageSummary,
} from '@/utils/contentStore';
import { TAFSIR_EDITIONS, HADITH_BOOKS } from '@/data/contentCatalog';
import { AUDIO_RECITERS } from '@/data/audioReciters';

export interface InstalledContent {
  /** Surahs downloaded per tafsir edition. */
  tafsir: Record<string, Set<number>>;
  /** Downloaded hadith collection ids. */
  hadith: Set<string>;
  /** Surahs downloaded per reciter. */
  audio: Record<string, Set<number>>;
  /** Measured bytes on the device. */
  storage: StorageSummary;
  /** True while the store is being read for the first time. */
  loading: boolean;
}

/** Reads the whole installed-content picture, re-running whenever the store changes. */
export function useInstalledContent(): InstalledContent {
  const [state, setState] = useState<InstalledContent>({
    tafsir: {},
    hadith: new Set(),
    audio: {},
    storage: { used: 0, quota: 0 },
    loading: true,
  });

  const read = useCallback(async () => {
    const [tafsir, hadith, audioRows, storage] = await Promise.all([
      Promise.all(TAFSIR_EDITIONS.map(async (e) => [e.id, await tafsirSurahsInStore(e.id)] as const)),
      hadithBooksInStore(),
      Promise.all(AUDIO_RECITERS.map(async (reciter) => [reciter.id, await audioStatusInStore(reciter.id)] as const)),
      storageSummary(),
    ]);
    setState({
      tafsir: Object.fromEntries(tafsir),
      hadith,
      audio: Object.fromEntries(audioRows),
      storage,
      loading: false,
    });
  }, []);

  useEffect(() => {
    void read();
    return subscribeToContent(() => {
      void read();
    });
  }, [read]);

  return state;
}

export interface TafsirEditionStatus {
  editionId: string;
  /** Surahs on the device. */
  surahs: Set<number>;
  /** 0..1 across the whole edition. */
  fraction: number;
  /** Bytes the edition would occupy in full, measured from the source payloads. */
  totalBytes: number;
  /** Fraction of the edition's size that is already downloaded. */
  byteFraction: number;
  complete: boolean;
  none: boolean;
}

/** Works out how much of each tafsir edition is present. */
export function useTafsirEditionStatus(installed: Record<string, Set<number>>): TafsirEditionStatus[] {
  return TAFSIR_EDITIONS.map((edition) => {
    const surahs = installed[edition.id] ?? new Set<number>();
    let bytesDone = 0;
    for (const surah of surahs) bytesDone += edition.surahBytes[surah] ?? 0;

    const fraction = edition.surahs === 0 ? 0 : surahs.size / edition.surahs;
    return {
      editionId: edition.id,
      surahs,
      fraction,
      totalBytes: edition.totalBytes,
      byteFraction: edition.totalBytes === 0 ? 0 : bytesDone / edition.totalBytes,
      complete: edition.surahs > 0 && surahs.size >= edition.surahs,
      none: surahs.size === 0,
    };
  });
}

export interface HadithBookStatus {
  bookId: string;
  installed: boolean;
  downloadBytes: number;
}

/** Maps installed hadith collection ids onto the catalogue. */
export function useHadithBookStatus(installed: Set<string>): HadithBookStatus[] {
  return HADITH_BOOKS.map((book) => ({
    bookId: book.id,
    installed: installed.has(book.id),
    downloadBytes: book.downloadBytes,
  }));
}