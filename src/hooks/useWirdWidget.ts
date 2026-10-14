import { useEffect, useMemo, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { Settings } from '@/db/database';
import { syncWirdWidget } from '@/utils/wirdWidget';

/**
 * Keeps the launcher's home-screen widget fed.
 *
 * A widget cannot ask the app for anything — it is drawn from the last thing
 * written down, on a schedule the launcher owns. So the app has to leave that
 * record behind without being asked, and this hook is where the asking-not
 * happens.
 *
 * Two moments matter and both are here: the settings that change the answer
 * (a new city moves every prayer on the widget), and the moment the person
 * stops looking at the app — which is the only moment at which "what they
 * have just done" becomes "what the widget should say". Pushing on every
 * toggle instead would write the snapshot a dozen times an hour for a widget
 * that is not on screen to see any of them.
 */
export function useWirdWidget(settings: Settings | null) {
  // Only what changes the *answer*. Tasks are re-read from the database on
  // every push, so they need no key here — and keying on the whole row would
  // push a snapshot on every font-size tick.
  const fingerprint = useMemo(() => {
    if (!settings) return '';
    return [
      settings.latitude,
      settings.longitude,
      settings.calcMethod,
      settings.asrMadhab,
      settings.timeZone,
      settings.cityName,
    ].join('|');
  }, [settings]);

  // The push wants the whole row but must not re-run when the row's identity
  // changes for a reason the widget cannot see. A ref keeps the latest value
  // without joining the key.
  const settingsRef = useRef<Settings | null>(null);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!fingerprint || !Capacitor.isNativePlatform()) return;

    const push = () => {
      const current = settingsRef.current;
      if (current) void syncWirdWidget(current);
    };

    push();

    let disposed = false;
    let removeListener: (() => void) | undefined;

    void CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive && !disposed) push();
    })
      .then((handle) => {
        // The listener can land after this effect was torn down — a fast
        // navigate-away on first render does exactly that — so the handle is
        // either used at once or released at once.
        if (disposed) void handle.remove();
        else removeListener = () => void handle.remove();
      })
      .catch(() => {
        // No App plugin (the web build). The visibilitychange fallback below
        // still covers a browser tab being hidden.
      });

    const onHidden = () => {
      if (document.visibilityState === 'hidden' && !disposed) push();
    };
    document.addEventListener('visibilitychange', onHidden);

    return () => {
      disposed = true;
      removeListener?.();
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [fingerprint]);
}
