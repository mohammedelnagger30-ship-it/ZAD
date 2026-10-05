import { useEffect, useState, useCallback } from 'react';
import { getSettings, updateSettings, type Settings } from '@/db/database';

/** Hook for loading and updating user settings */
export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const s = await getSettings();
    setSettings(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (patch: Partial<Settings>) => {
    await updateSettings(patch);
    const updated = await getSettings();
    setSettings(updated);
  }, []);

  return { settings, loading, save, reload: load };
}
