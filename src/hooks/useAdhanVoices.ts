import { useEffect, useSyncExternalStore } from 'react';
import {
  downloadedAdhanVoiceIds,
  ensureAdhanVoicesLoaded,
  subscribeToAdhanVoices,
} from '@/utils/adhanStore';

/**
 * Which on-demand adhan voices are already stored on the device.
 *
 * The store keeps a stable snapshot and replaces it when a download finishes or a voice
 * is deleted, so every open view (the settings picker today) updates together.
 */
export function useDownloadedAdhanVoices(): ReadonlySet<string> {
  const ids = useSyncExternalStore(subscribeToAdhanVoices, downloadedAdhanVoiceIds);
  useEffect(() => {
    void ensureAdhanVoicesLoaded();
  }, []);
  return ids;
}
