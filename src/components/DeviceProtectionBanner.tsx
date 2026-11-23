import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  BellOff,
  BatteryWarning,
  TimerOff,
  Rocket,
  ExternalLink,
  Maximize,
  Moon,
  VolumeX,
  BellRing,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import {
  getProtectionStatus,
  openProtectionSettings,
  type ProtectionStatus,
  type ProtectionTarget,
} from '@/utils/adhanOverlay';
import { getSettings, type Settings } from '@/db/database';
import { adhanChannelId } from '@/utils/notificationScheduler';

/**
 * A banner that appears only while something *on the device* can silence the
 * adhan — notifications switched off, exact alarms revoked, battery
 * optimisation holding everything hostage — and opens the system screen that
 * lifts it, one tap per problem. A healthy phone never sees it: the point is a
 * loud warning at the moment it matters and no furniture at all otherwise.
 *
 * The status is re-read whenever the app comes back to the foreground, because
 * the fix happens in *another* app (Settings) — nothing here can know it
 * worked until the reader returns.
 */
interface Issue {
  key: string;
  label: string;
  hint: string;
  fix: string;
  target: ProtectionTarget;
  icon: typeof BellOff;
}

/** MIUI-family autostart is invisible to apps; its brand is the only tell we get. */
function looksLikeMiuiFamily(): boolean {
  return /xiaomi|redmi|poco|miui|huawei|harmonyos|coloros|funtouch|realme/i.test(
    navigator.userAgent,
  );
}

export function DeviceProtectionBanner() {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);

  /**
   * The channel the adhan rings on, read once. Three of the checks below are only
   * answerable with it — a channel muted in the system settings, a channel born without
   * a sound — and asking without it would report on a channel nothing rings on.
   */
  const channelIdRef = useRef<string | undefined>(undefined);
  const [channelId, setChannelId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    void getSettings()
      .then((settings: Settings) => {
        if (cancelled) return;
        const id = adhanChannelId(settings);
        channelIdRef.current = id;
        setChannelId(id);
      })
      .catch(() => {
        // No channel id: the three channel checks stay off, the rest still report.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(() => {
    void getProtectionStatus(channelIdRef.current)
      .then((next) => {
        // A status that arrives late (the system page is still open, or the
        // native side has not caught up yet) must not erase a status we already
        // hold: keep the last known answer until a fresh one replaces it.
        if (next) setStatus(next);
      })
      .catch(() => {
        // Leave the last known status in place; a failed read is not a fix.
      });
  }, []);

  useEffect(() => {
    refresh();
    // The fix happens in *another* app — the system dialog, the settings screen —
    // so nothing here can know it worked until the reader comes back. `resume` is
    // the hook that fires even when the fix was a dialog that never fully hid
    // this window (a plain visibilitychange would miss those).
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    // Some ROMs never deliver `resume`/`visibilitychange` after a settings page
    // (or deliver them before the system has actually recorded the new grant), so
    // poll while the banner is mounted: a permission flipped in Settings is
    // sensed within a second instead of staying stuck on the old answer.
    const poll = window.setInterval(refresh, 1000);
    let disposed = false;
    const removals: Array<() => void> = [];
    // Two explicit calls rather than one over a union of event names: the plugin's
    // overloads cannot be resolved against `'pause' | 'resume'` as a value.
    const subscribe = (handlePromise: Promise<PluginListenerHandle>) => {
      void handlePromise.then((handle) => {
        if (disposed) handle.remove();
        else removals.push(() => handle.remove());
      });
    };
    subscribe(CapacitorApp.addListener('pause', refresh));
    subscribe(CapacitorApp.addListener('resume', refresh));
    return () => {
      disposed = true;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      removals.forEach((remove) => remove());
    };
    // Re-armed when the channel id lands: the three channel checks cannot report until
    // the probe knows which channel the adhan actually rings on.
  }, [refresh, channelId]);

  if (!status) return null;

  const issues: Issue[] = [];
  if (!status.notificationsEnabled) {
    issues.push({
      key: 'notifications',
      label: 'الإشعارات مغلقة من إعدادات الهاتف',
      hint: 'لن يرن الأذان ولا يصل تنبيه الصلاة إطلاقًا',
      fix: 'السماح بالإشعارات',
      target: 'notifications',
      icon: BellOff,
    });
  }
  if (!status.exactAlarmsAllowed) {
    issues.push({
      key: 'exact',
      label: 'المنبهات الدقيقة غير مسموحة',
      hint: 'قد يتأخر الأذان دقائق بعد معاده',
      fix: 'السماح بالمنبهات',
      target: 'exact',
      icon: TimerOff,
    });
  }
  if (!status.fullScreenIntentAllowed) {
    issues.push({
      key: 'full-screen',
      label: 'فتح صفحة الأذان بملء الشاشة غير مسموح',
      hint: 'سيظهر إشعار الأذان، لكن قد لا تفتح صفحته تلقائيًا عند قفل الهاتف',
      fix: 'السماح بملء الشاشة',
      target: 'full-screen',
      icon: Maximize,
    });
  }
  if (!status.ignoringBatteryOptimizations) {
    issues.push({
      key: 'battery',
      label: 'توفير البطارية مفعّل على التطبيق',
      hint: 'قد يجمّد الهاتف الأذان والشاشة ساكنة',
      fix: 'إيقاف التوفير',
      target: 'battery',
      icon: BatteryWarning,
    });
  }
  /*
   * The three silencers — and the three that explain «التنبيه بيوصل من غير صوت» most
   * often. Each one posts a perfect card and lets nothing out of the speaker, and none
   * of them is visible from inside a WebView, so the app could only ever guess. These
   * are the device's own answers.
   */
  if (status.dndActive) {
    issues.push({
      key: 'dnd',
      label: 'وضع «عدم الإزعاج» مفعّل',
      hint: 'سيصل تنبيه الصلاة صامتًا — لن يُسمع الأذان إطلاقًا',
      fix: 'إيقاف عدم الإزعاج',
      target: 'dnd',
      icon: Moon,
    });
  }
  if (status.ringerSilent) {
    issues.push({
      key: 'sound',
      label: 'الهاتف على وضع الصامت أو الاهتزاز',
      hint: 'الأذان يُشغَّل لكن السماعة صامتة',
      fix: 'تشغيل الصوت',
      target: 'sound',
      icon: VolumeX,
    });
  }
  if (status.channelMuted) {
    // The reader's own switch in the system settings — reported, never undone. Someone
    // who silenced this channel said what they want; deleting it to bring the sound
    // back would be overriding them.
    issues.push({
      key: 'channel-muted',
      label: 'قناة الأذان صامتة من إعدادات الهاتف',
      hint: 'الأذان لا يُسمع حتى مع السماح بالإشعارات',
      fix: 'فتح قناة الأذان',
      target: 'notifications',
      icon: BellRing,
    });
  }
  // On the skins that kill background apps by brand, autostart is the switch
  // that decides everything — and its state is unreadable, so it is offered
  // once, gently, whenever nothing else is already shouting. Once the reader
  // has opened that page we stop offering it: the grant cannot be read back,
  // but asking again every launch just looks like the app never noticed.
  const autostartDismissed =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('zad:autostart-prompted') === '1';
  if (issues.length === 0 && looksLikeMiuiFamily() && !autostartDismissed) {
    issues.push({
      key: 'autostart',
      label: 'قد يمنع نظام هاتفك تشغيل التطبيق في الخلفية',
      hint: '«التشغيل التلقائي» في إعدادات الهاتف يضمن رنين الأذان والتطبيق مغلق',
      fix: 'فتح الإذن',
      target: 'autostart',
      icon: Rocket,
    });
  }

  if (issues.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-amber-300/80 bg-amber-50/60 shadow-xs dark:border-amber-500/40 dark:bg-amber-500/[0.06]">
      <div className="flex items-center gap-2 border-b border-amber-200/60 px-4 py-2.5 dark:border-amber-500/25">
        <Rocket size={16} className="text-amber-600 dark:text-amber-400" />
        <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
          أذان موثوق على هذا الهاتف
        </p>
      </div>
      <ul className="divide-y divide-amber-200/50 dark:divide-amber-500/20">
        {issues.map((issue) => (
          <li key={issue.key} className="flex items-center gap-3 px-4 py-3">
            <issue.icon size={18} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-amber-900 dark:text-amber-200">
                {issue.label}
              </span>
              <span className="mt-0.5 block text-xs text-amber-700/80 dark:text-amber-400/80">
                {issue.hint}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (issue.target === 'autostart') {
                  try {
                    localStorage.setItem('zad:autostart-prompted', '1');
                  } catch {
                    // Storage unavailable: the prompt simply keeps appearing.
                  }
                }
                void openProtectionSettings(issue.target);
                // The grant is recorded by the system a beat after the settings
                // page closes; re-read a few times so the banner disappears on
                // its own instead of waiting for a manual reload.
                window.setTimeout(refresh, 500);
                window.setTimeout(refresh, 1500);
                window.setTimeout(refresh, 3000);
              }}
              className="flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
            >
              <ExternalLink size={13} />
              {issue.fix}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
