import { useState, useCallback, useEffect, useRef } from 'react';
import { Bell, BellRing, Download, Play, Sparkles, Square, Trash2, Volume2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Card, Button, ToggleRow } from '@/components/ui';
import { TimeOptionButton } from '@/components/TimeOptionButton';
import { SectionTitle } from '@/components/settings/SectionTitle';
import {
  ADHAN_SOUNDS,
  DEFAULT_ADHAN_SOUND_ID,
  adhanDownloadUrl,
  getAdhanSound,
  isAdhanSoundReady,
  type AdhanSound,
} from '@/data/adhanSounds';
import { useDownloadedAdhanVoices } from '@/hooks/useAdhanVoices';

import {
  DEFAULT_NOTIFICATION_VOICE_ID,
  NOTIFICATION_VOICES,
  getNotificationVoice,
  isNotificationVoiceReady,
} from '@/data/notificationSounds';
import {
  AdhanDownloadError,
  deleteAdhanVoice,
  downloadAdhanVoice,
  resolveAdhanPlayUrl,
  resolveAdhanSoundPath,
} from '@/utils/adhanStore';
import { rescheduleAllNotifications, adhanChannelId } from '@/utils/notificationScheduler';
import { armTestAdhanAlarm } from '@/utils/adhanOverlay';
import { canScheduleExactAlarms, hasNotificationPermission, NOTIFICATION_WARNING_EVENT, requestExactAlarms, requestNotificationPermission } from '@/utils/notifications';
import { type Settings } from '@/db/database';

interface NotificationsSectionProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
}

/** "3.1 ميجا" — how the download list states what a voice will cost the user. */
function adhanSizeLabel(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميجا`;
}

export function NotificationsSection({ settings, onSaveSettings }: NotificationsSectionProps) {
  const [adhanPreviewStatus, setAdhanPreviewStatus] = useState('');
  const [previewingAdhanId, setPreviewingAdhanId] = useState<string | null>(null);
  /**
   * The reminder-voice picker auditions with the same element as the adhan picker —
   * but a separate key, because the two lists share ids: «مشاري العفاسي» is both an
   * adhan voice and a reminder voice, and a shared key would make the stop button of
   * one light up while the other was playing.
   */
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const adhanAudioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * On-demand voices: which are already on the device, which one is downloading right
   * now, and how far it got. Everything else in this section assumes the selected voice
   * can actually play — the picker only offers voices that are ready.
   */
  const downloadedAdhanVoices = useDownloadedAdhanVoices();
  const [adhanDownloadingId, setAdhanDownloadingId] = useState<string | null>(null);
  const [adhanProgress, setAdhanProgress] = useState<{ received: number; total: number } | null>(null);
  const [adhanNotice, setAdhanNotice] = useState('');
  const adhanAbortRef = useRef<AbortController | null>(null);
  const [dhikrPermissionStatus, setDhikrPermissionStatus] = useState('');

  /**
   * State of the exact-alarm permission that makes the adhan sound at the prayer
   * minute while the app is closed.
   *
   * Checked once on mount and re-raised by the scheduler whenever a rebuild had to
   * back off (see `NOTIFICATION_WARNING_EVENT`), so the fix — one tap into the system
   * page — sits exactly where the sound settings are.
   */
  const [exactAlarmNotice, setExactAlarmNotice] = useState<
    '' | 'denied' | 'inexact' | 'failed' | 'channel-failed' | 'channel-silent'
  >('');
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    void canScheduleExactAlarms().then((ok) => {
      if (alive && !ok) setExactAlarmNotice('denied');
    });
    const onWarning = (event: Event) => {
      const type = (event as CustomEvent).detail;
      if (type === 'exact-alarm-denied') setExactAlarmNotice('denied');
      else if (type === 'scheduled-inexact') setExactAlarmNotice('inexact');
      else if (type === 'schedule-failed') setExactAlarmNotice('failed');
      else if (type === 'channel-failed') setExactAlarmNotice('channel-failed');
      else if (type === 'channel-silent') setExactAlarmNotice('channel-silent');
      else if (type === 'schedule-ready') setExactAlarmNotice('');
    };
    window.addEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    };
  }, []);

  /**
   * The «اختبار الأذان» self-test.
   *
   * The only honest answer to «هل الأذان شغّال على ده الموبايل؟» is to run the whole
   * chain and listen: the platform's alarm-clock registration, the receiver, the prayer
   * channel's sound, the full-screen takeover, the page. All of that is normally only
   * exercised at the next prayer — which may be hours away, and which a person who has
   * just been handed a silent phone cannot use to find out *why*. This arms one
   * throwaway alarm a few seconds out through the very same receiver.
   *
   * It is a preview end to end: the page it raises carries `type: 'test'`, so the
   * trigger opens it as a preview that writes no prayer record, and its id sits in the
   * range reserved for the native side, outside every queued notification.
   */
  const [testStatus, setTestStatus] = useState('');
  const [testing, setTesting] = useState(false);
  const runAdhanSelfTest = useCallback(async () => {
    if (!Capacitor.isNativePlatform() || testing) return;
    setTesting(true);
    setTestStatus('');
    try {
      const adhan = getAdhanSound(settings.adhanVoiceId);
      // The voice may be one the reader downloaded; the alarm carries the stored path
      // so the receiver can build the channel *with* a sound if the channel is missing.
      // Exactly one of the two carries it: a bundled voice is its res/raw name, a
      // downloaded one has no res/raw entry and travels as its stored path.
      let soundPath: string | undefined;
      if (!adhan.bundled) {
        try {
          soundPath = (await resolveAdhanSoundPath(adhan)) ?? undefined;
        } catch {
          soundPath = undefined;
        }
      }
      const delayMs = 10_000;
      const result = await armTestAdhanAlarm({
        channelId: adhanChannelId(settings),
        prayerKey: 'fajr',
        prayerName: 'الفجر',
        title: 'حان وقت صلاة الفجر — اختبار',
        body: 'اختبار الأذان: إن سمعت هذا التنبيه فالأذان يعمل على هاتفك.',
        delayMs,
        sound: adhan.bundled ? adhan.file : undefined,
        soundPath,
      });
      if (!result) {
        setTestStatus('تعذّر تشغيل الاختبار على هذا الجهاز.');
        return;
      }
      setTestStatus(
        result.inexact
          ? 'تم إرسال تنبيه الاختبار، لكن الهاتف لا يسمح بالمنبهات الدقيقة — قد يتأخر ثوانٍ. انتظر عشر ثوانٍ: إن لم يصل، فالمشكلة من إعدادات الهاتف.'
          : 'تم إرسال تنبيه الاختبار — انتظر عشر ثوانٍ. إن لم يصل، فالمشكلة من إعدادات الهاتف، وستجدها في التحذيرات أعلاه.',
      );
    } catch (error) {
      setTestStatus(
        error instanceof Error ? `تعذّر تشغيل الاختبار: ${error.message}` : 'تعذّر تشغيل الاختبار.',
      );
    } finally {
      setTesting(false);
    }
  }, [settings, testing]);

  /**
   * Silences every preview this section can start.
   *
   * One element covers both pickers deliberately: auditioning a reminder voice while
   * an adhan recording is still running would put two recitations on top of each other,
   * which is never what the user meant by tapping «استماع».
   */
  const stopPreview = useCallback(() => {
    const audio = adhanAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      adhanAudioRef.current = null;
    }
    setPreviewingAdhanId(null);
    setPreviewingVoiceId(null);
  }, []);

  /** Mounts the element for one preview, replacing whatever was playing. */
  const beginPreview = useCallback(
    (url: string): HTMLAudioElement => {
      stopPreview();
      const audio = new Audio(url);
      audio.preload = 'auto';
      adhanAudioRef.current = audio;
      return audio;
    },
    [stopPreview],
  );

  const playAdhanPreview = useCallback(async () => {
    const sound = ADHAN_SOUNDS.find((item) => item.id === settings.adhanVoiceId) ?? ADHAN_SOUNDS[0];
    if (previewingAdhanId === sound.id) {
      stopPreview();
      setAdhanPreviewStatus('تم إيقاف الاستماع.');
      return;
    }

    stopPreview();
    setAdhanPreviewStatus('');
    let url: string;
    try {
      // Bundled voices play from the app package; downloaded ones from the stored file.
      url = await resolveAdhanPlayUrl(sound);
    } catch {
      setAdhanPreviewStatus('تعذّق الوصول إلى ملف الصوت. أعد تنزيل الصوت ثم حاول مجددًا.');
      return;
    }
    const audio = beginPreview(url);
    audio.onended = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
        setAdhanPreviewStatus('انتهى تشغيل تسجيل الأذان.');
      }
    };
    audio.onerror = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
        setAdhanPreviewStatus('تعذّر تشغيل ملف الأذان. تحقّق من توفر الملف ثم أعد المحاولة.');
      }
    };
    setPreviewingAdhanId(sound.id);

    try {
      await audio.play();
      setAdhanPreviewStatus(`يُشغّل تسجيل ${sound.name} كاملًا الآن.`);
    } catch (error) {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingAdhanId(null);
      }
      setAdhanPreviewStatus(error instanceof Error ? `تعذّر تشغيل الأذان: ${error.message}` : 'تعذّر تشغيل الأذان.');
    }
  }, [beginPreview, previewingAdhanId, settings.adhanVoiceId, stopPreview]);

  /**
   * Auditions the iqamah recording — what the جماعة's minute will actually sound like.
   *
   * Its own button because it is not the adhan: the picker above plays a full call to
   * prayer, this one plays the twenty-odd seconds of takbirs that follow it, and a
   * person choosing one wants to hear that difference rather than guess it.
   */

  /**
   * Auditions the reminder voice — the sound a task, a review, the hadith of the day or
   * a dhikr reminder will make. The adhan picker next to it is a different choice
   * entirely, so it gets its own button rather than borrowing that one.
   */
  const playVoicePreview = useCallback(async () => {
    const voice = getNotificationVoice(settings.notificationVoiceId);
    if (voice.silent) return;
    if (previewingVoiceId === voice.id) {
      stopPreview();
      setAdhanPreviewStatus('تم إيقاف الاستماع.');
      return;
    }

    stopPreview();
    setAdhanPreviewStatus('');
    let url: string;
    try {
      url = voice.adhan
        ? await resolveAdhanPlayUrl(voice.adhan)
        : `/audio/${voice.file}`;
    } catch {
      setAdhanPreviewStatus('تعذّر الوصول إلى ملف الصوت. أعد تنزيل الصوت ثم حاول مجددًا.');
      return;
    }
    const audio = beginPreview(url);
    audio.onended = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingVoiceId(null);
        setAdhanPreviewStatus('انتهى تشغيل صوت التنبيه.');
      }
    };
    audio.onerror = () => {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingVoiceId(null);
        setAdhanPreviewStatus('تعذّر تشغيل ملف التنبيه. تحقّق من توفر الملف ثم أعد المحاولة.');
      }
    };
    setPreviewingVoiceId(voice.id);

    try {
      await audio.play();
      setAdhanPreviewStatus(`يُشغّل «${voice.name}» كصوت لتنبيهات المهام والحفظ.`);
    } catch (error) {
      if (adhanAudioRef.current === audio) {
        adhanAudioRef.current = null;
        setPreviewingVoiceId(null);
      }
      setAdhanPreviewStatus(error instanceof Error ? `تعذّر تشغيل الصوت: ${error.message}` : 'تعذّر تشغيل الصوت.');
    }
  }, [beginPreview, previewingVoiceId, settings.notificationVoiceId, stopPreview]);

  useEffect(() => {
    if (previewingAdhanId && previewingAdhanId !== settings.adhanVoiceId) {
      stopPreview();
      setAdhanPreviewStatus('تم إيقاف التسجيل بعد تغيير صوت الأذان.');
    }
  }, [previewingAdhanId, settings.adhanVoiceId, stopPreview]);

  /** Fetches one on-demand voice, one file, exactly like the content library does. */
  const downloadAdhan = useCallback(async (sound: AdhanSound) => {
    const url = adhanDownloadUrl(sound);
    if (!url || adhanDownloadingId) return;
    setAdhanNotice('');
    setAdhanDownloadingId(sound.id);
    setAdhanProgress(null);
    const controller = new AbortController();
    adhanAbortRef.current = controller;
    try {
      await downloadAdhanVoice(sound, setAdhanProgress, controller.signal);
      setAdhanNotice(`تم تنزيل «${sound.name}» — صار جاهزًا للاستعمال.`);
      if (sound.id === settings.adhanVoiceId) {
        // The voice was already chosen: the prayer channel must now ring the stored
        // file instead of falling back to the bundled Makkah adhan.
        void rescheduleAllNotifications();
      } else if (sound.id === settings.notificationVoiceId) {
        // The same voice can also be the reminder sound; its channels point at the
        // stored file from here on.
        void rescheduleAllNotifications();
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        setAdhanNotice('تم إيقاف التنزيل.');
      } else if (error instanceof AdhanDownloadError) {
        setAdhanNotice(error.message);
      } else {
        setAdhanNotice('تعذّر تنزيل الصوت. تحقّق من الاتصال ثم أعد المحاولة.');
      }
    } finally {
      adhanAbortRef.current = null;
      setAdhanDownloadingId(null);
      setAdhanProgress(null);
    }
  }, [adhanDownloadingId, settings.adhanVoiceId, settings.notificationVoiceId]);

  const cancelAdhanDownload = useCallback(() => {
    adhanAbortRef.current?.abort();
  }, []);

  /**
   * Drops a downloaded voice — and the choice itself when it was the selected one: an
   * adhan that can no longer play must fall back to the bundled Makkah voice on the
   * spot, not at the next prayer.
   */
  const removeAdhan = useCallback(async (sound: AdhanSound) => {
    await deleteAdhanVoice(sound);
    if (settings.adhanVoiceId === sound.id) {
      onSaveSettings({ adhanVoiceId: DEFAULT_ADHAN_SOUND_ID });
      setAdhanNotice('حُذف الصوت، ورجع الأذان لصوت المسجد الحرام الافتراضي.');
    } else if (settings.notificationVoiceId === sound.id) {
      // The reminder voice has nowhere left to point: fall back to the app's own chime
      // now, rather than letting the next reminder arrive with no sound at all.
      onSaveSettings({ notificationVoiceId: DEFAULT_NOTIFICATION_VOICE_ID });
      setAdhanNotice('حُذف الصوت، ورجعت تنبيهات المهام والحفظ لنغمة التطبيق.');
    } else {
      setAdhanNotice('حُذف الصوت من الجهاز.');
    }
  }, [onSaveSettings, settings.adhanVoiceId, settings.notificationVoiceId]);

  useEffect(() => () => {
    adhanAbortRef.current?.abort();
  }, []);

  // Every voice is offered in the picker: a bundled one is ready at once, the rest are
  // ready only after the user downloads them — picking one that isn't on the device yet
  // simply puts its download button under the picker.
  const selectedAdhan = getAdhanSound(settings.adhanVoiceId);
  const selectedAdhanReady = isAdhanSoundReady(selectedAdhan, downloadedAdhanVoices);

  /**
   * The reminder voice. The picker offers every voice in `NOTIFICATION_VOICES`, and a
   * downloaded adhan voice that is not on the device yet simply shows its download
   * button — the same behaviour the adhan picker above has.
   */
  const selectedVoice = getNotificationVoice(settings.notificationVoiceId);

  useEffect(() => () => {
    adhanAudioRef.current?.pause();
    adhanAudioRef.current = null;
  }, []);

  const enableRandomDhikrNotifications = useCallback(async () => {
    // Scheduled reminders are armed by the native scheduler only; on the web build this
    // button has nothing to do, so it stays silent.
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (!(await requestNotificationPermission())) {
        setDhikrPermissionStatus('لم تُمنح صلاحية الإشعارات. يمكنك تفعيلها من إعدادات الهاتف.');
        return;
      }
      await rescheduleAllNotifications();
      setDhikrPermissionStatus('تم تفعيل الإشعارات وإعادة جدولة التذكيرات.');
    } catch (error) {
      setDhikrPermissionStatus(
        error instanceof Error ? `تعذّر تفعيل التذكيرات: ${error.message}` : 'تعذّر تفعيل التذكيرات.'
      );
    }
  }, []);

  /**
   * The switch turns the *same* setting the onboarding step writes, so flipping it on
   * has to do what onboarding does: make sure the notification permission exists, and
   * only then leave it on. Saving the flag first and hoping the permission follows is
   * what left the toggle showing "on" while the queue stayed empty — the reschedule
   * bails silently when the grant is missing.
   */
  const handleRandomDhikrToggle = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      setDhikrPermissionStatus('');
      onSaveSettings({ randomDhikrEnabled: false });
      return;
    }
    // Only the native scheduler can arm the reminders, so the web build leaves the
    // switch as it is rather than showing it on with an empty queue behind it.
    if (!Capacitor.isNativePlatform()) return;
    try {
      if (!(await requestNotificationPermission())) {
        // Snapping back to off is honest: nothing can be scheduled without the grant.
        setDhikrPermissionStatus('لم تُمنح صلاحية الإشعارات، فبقيت التذكيرات متوقفة. فعّلها من إعدادات الهاتف ثم أعد المحاولة.');
        return;
      }
      onSaveSettings({ randomDhikrEnabled: true });
      await rescheduleAllNotifications();
      setDhikrPermissionStatus('تم تفعيل الإشعارات وإعادة جدولة التذكيرات.');
    } catch (error) {
      setDhikrPermissionStatus(
        error instanceof Error ? `تعذّر تفعيل التذكيرات: ${error.message}` : 'تعذّر تفعيل التذكيرات.'
      );
    }
  }, [onSaveSettings]);

  /**
   * Opening the app cannot pop the permission dialog by itself (and should not), but a
   * switch left on with the permission revoked arms nothing at all. Surface that where
   * the switch lives instead of leaving the user with a silent, reminder-free phone.
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !settings.randomDhikrEnabled) return;
    let alive = true;
    void hasNotificationPermission()
      .then((granted) => {
        if (alive && !granted) {
          setDhikrPermissionStatus(
            'التذكيرات مفعّلة، لكن صلاحية الإشعارات غير ممنوحة — لن تصل التذكيرات حتى تسمح بها من إعدادات الهاتف.'
          );
        }
      })
      .catch(() => {
        // Permission state unavailable: the toggle itself still reflects the setting.
      });
    return () => {
      alive = false;
    };
  }, [settings.randomDhikrEnabled]);

  const triggerAzanOverlayPreview = () => {
    window.dispatchEvent(
      new CustomEvent('zad:trigger-azan', {
        detail: {
          prayerKey: 'fajr',
          prayerName: 'الفجر',
          isPreview: true,
        },
      })
    );
  };

  return (
    <>
      {/* Notifications & Azan Settings */}
      <section id="settings-notifications" className="space-y-2">
        <SectionTitle icon={<Bell size={20} />} title="التنبيهات وصوت الأذان" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          {exactAlarmNotice !== '' && (
            <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-700 dark:bg-amber-900/30">
              <p className="text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
                {exactAlarmNotice === 'denied'
                  ? 'تنبيهات الأذان الدقيقة موقوفة من إعدادات الجهاز — الأذان قد يتأخر دقائق أثناء السكون.'
                  : exactAlarmNotice === 'inexact'
                    ? 'شُغّلت تنبيهات هذا الدور بنظام تقريبي — الأذان قد يتأخر دقائق أثناء السكون.'
                    : exactAlarmNotice === 'channel-failed'
                      ? 'تعذّر تجهيز قناة صوت الأذان؛ أبقينا التنبيهات السابقة كما هي لتجنب جدولة أذان صامت.'
                      : exactAlarmNotice === 'channel-silent'
                        ? 'قناة صوت الأذان كانت بلا صوت على هذا الهاتف، فتم إصلاحها وتجهيزها من جديد — الصوت سيعود في التنبيه القادم.'
                        : 'تعذّرت جدولة تنبيهات هذا الدور، وعادت التنبيهات السابقة إلى مكانها؛ ستُعاد المحاولة عند فتح التطبيق.'}
              </p>
              {exactAlarmNotice === 'channel-failed' || exactAlarmNotice === 'channel-silent' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void rescheduleAllNotifications()}
                  className="font-semibold text-xs"
                >
                  إعادة محاولة تجهيز التنبيهات
                </Button>
              ) : exactAlarmNotice !== 'failed' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    const granted = await requestExactAlarms();
                    setExactAlarmNotice(granted ? '' : 'denied');
                    if (granted) await rescheduleAllNotifications();
                  }}
                  className="font-semibold text-xs"
                >
                  فتح إعدادات تنبيهات الأذان الدقيقة
                </Button>
              ) : null}
            </div>
          )}

          {/* Two columns once the card is wide enough (2xl+): sounds on the right, reminders
              and daily times on the left. Stacked into one column this card measured ~1212px
              tall - a screen of scrolling for two independent groups of settings. Below 2xl
              the card sits in a narrower page column, and two sub-columns here would starve
              the selects, time inputs and buttons of width. */}
          <div className="2xl:flex 2xl:items-start 2xl:gap-6">
            <div className="space-y-4 2xl:flex-1 2xl:min-w-0">
              <ToggleRow
                label="أصوات تنبيهات المهام والحفظ"
                icon={<Volume2 size={18} className="text-primary-600 dark:text-gold-400" />}
                value={settings.notificationSound}
                onChange={(v) => onSaveSettings({ notificationSound: v })}
              />

              {settings.notificationSound && (
                <div className="mt-3 space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                  <div>
                    <label
                      htmlFor="notification-voice"
                      className="text-xs font-semibold text-primary-900 dark:text-primary-100 mb-1.5 block"
                    >
                      صوت التنبيه
                    </label>
                    <select
                      id="notification-voice"
                      value={selectedVoice.id}
                      onChange={(e) => onSaveSettings({ notificationVoiceId: e.target.value })}
                      className="w-full md:max-w-md bg-white dark:bg-primary-900 border border-primary-200 dark:border-primary-700 rounded-xl py-2.5 px-3 text-sm text-primary-900 dark:text-primary-100 font-semibold focus:outline-hidden focus:ring-2 focus:ring-primary-500"
                    >
                      {NOTIFICATION_VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.name}
                          {isNotificationVoiceReady(voice, downloadedAdhanVoices) ? '' : ' — تنزيل'}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-[0.625rem] md:text-xs text-primary-700 dark:text-primary-300">
                    يُطبَّق على تذكيرات المراجعة والحفظ وحديث اليوم والأذكار. أما صوت الأذان نفسه فله
                    اختياره الخاص أدناه.
                  </p>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void playVoicePreview()}
                    disabled={selectedVoice.silent}
                    className="font-semibold text-xs"
                  >
                    {previewingVoiceId === selectedVoice.id ? <Square size={15} /> : <Play size={15} />}
                    {previewingVoiceId === selectedVoice.id ? 'إيقاف الصوت' : 'استماع للصوت'}
                  </Button>
                </div>
              )}

              <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
                <ToggleRow
                  label="تفعيل صوت الأذان عند وقت الصلاة"
                  icon={<Volume2 size={18} className="text-primary-600 dark:text-gold-400" />}
                  value={settings.adhanSound}
                  onChange={(v) => onSaveSettings({ adhanSound: v })}
                />

                {settings.adhanSound && (
                  <div className="mt-3 space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                    <div>
                      <label htmlFor="adhan-sound" className="text-xs font-semibold text-primary-900 dark:text-primary-100 mb-1.5 block">
                        صوت وشكل الأذان
                      </label>
                      <select
                        id="adhan-sound"
                        value={selectedAdhan.id}
                        onChange={(e) => onSaveSettings({ adhanVoiceId: e.target.value })}
                        className="w-full md:max-w-md bg-white dark:bg-primary-900 border border-primary-200 dark:border-primary-700 rounded-xl py-2.5 px-3 text-sm text-primary-900 dark:text-primary-100 font-semibold focus:outline-hidden focus:ring-2 focus:ring-primary-500"
                      >
                        {ADHAN_SOUNDS.map((sound) => (
                          <option key={sound.id} value={sound.id}>
                            {sound.name}
                            {isAdhanSoundReady(sound, downloadedAdhanVoices) ? '' : ' — تنزيل'}
                          </option>
                        ))}
                      </select>
                    </div>

                    {!selectedAdhanReady && (
                      <div className="space-y-2 rounded-2xl border border-primary-100 bg-white/70 p-3 dark:border-primary-800/80 dark:bg-primary-900/20">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 text-[0.6875rem] md:text-xs font-semibold text-primary-900 dark:text-primary-100">
                            {selectedAdhan.name}
                            {selectedAdhan.remote ? ` — ${adhanSizeLabel(selectedAdhan.remote.sizeBytes)}` : ''}
                          </span>
                          {adhanDownloadingId === selectedAdhan.id ? (
                            <button
                              type="button"
                              onClick={cancelAdhanDownload}
                              className="rounded-lg bg-amber-100 px-2.5 py-1 text-[0.6875rem] md:text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                            >
                              {adhanProgress && adhanProgress.total > 0
                                ? `${Math.floor((adhanProgress.received / adhanProgress.total) * 100)}٪ — إيقاف`
                                : 'جارٍ التنزيل — إيقاف'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void downloadAdhan(selectedAdhan)}
                              className="flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-[0.6875rem] md:text-xs font-bold text-white hover:bg-primary-700"
                            >
                              <Download size={12} /> تنزيل
                            </button>
                          )}
                        </div>
                        <p className="text-[0.625rem] md:text-xs text-primary-700 dark:text-primary-300">
                          يُنزَّل مرة واحدة فيصير صالحًا للأذان وصفحة الصلاة والإشعار بلا إنترنت — وحتى يكتمل التنزيل يواصل إشعار الصلاة بصوت المسجد الحرام.
                        </p>
                      </div>
                    )}

                    {selectedAdhanReady && !selectedAdhan.bundled && (
                      <div className="flex items-center gap-2 rounded-2xl border border-primary-100 bg-white/70 px-3 py-2.5 dark:border-primary-800/80 dark:bg-primary-900/20">
                        <span className="flex-1 text-[0.6875rem] md:text-xs font-semibold text-primary-900 dark:text-primary-100">
                          {selectedAdhan.name} — مُنزَّل على الجهاز
                        </span>
                        <button
                          type="button"
                          onClick={() => void removeAdhan(selectedAdhan)}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-[0.6875rem] md:text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={12} /> حذف
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      {/* Play audio preview */}
                      <Button variant="secondary" size="sm" onClick={() => void playAdhanPreview()} className="font-semibold text-xs">
                        {previewingAdhanId === settings.adhanVoiceId ? <Square size={15} /> : <Play size={15} />}
                        {previewingAdhanId === settings.adhanVoiceId ? 'إيقاف الصوت' : 'استماع للصوت'}
                      </Button>

                      {/* Trigger Fullscreen Azan Overlay Preview */}
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={triggerAzanOverlayPreview}
                        className="font-bold text-xs bg-linear-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950"
                      >
                        <Sparkles size={15} /> معاينة صفحة الأذان
                      </Button>
                    </div>

                    {/*
                      The self test: the one button that answers «هل الأذان شغّال على ده
                      الموبايل؟» without waiting for the next prayer. It runs the real chain —
                      the platform's alarm-clock registration, the receiver, the prayer
                      channel's sound, the takeover, the page — so a silent phone can be
                      diagnosed in ten seconds by whoever is holding it.
                    */}
                    {Capacitor.isNativePlatform() && (
                      <div className="space-y-2 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void runAdhanSelfTest()}
                          disabled={testing}
                          className="w-full font-semibold text-xs"
                        >
                          <BellRing size={15} /> {testing ? 'جارٍ إرسال الاختبار…' : 'اختبار الأذان على هذا الهاتف'}
                        </Button>
                        <p className="text-[0.625rem] md:text-xs text-primary-700 dark:text-primary-300">
                          يرسل تنبيهًا حقيقيًا بعد عشر ثوانٍ عبر نفس مسار الأذان تمامًا: نفس المنبه،
                          نفس القناة، نفس فتح الصفحة. إن لم يرن الصوت، فالمشكلة من إعدادات الهاتف
                          وستجدها مذكورة في التحذيرات أعلاه.
                        </p>
                        {testStatus && (
                          <p role="status" className="text-xs font-semibold text-primary-700 dark:text-gold-300">
                            {testStatus}
                          </p>
                        )}
                      </div>
                    )}


                    {adhanNotice && (
                      <p role="status" className="text-xs font-semibold text-primary-700 dark:text-gold-300 text-center">
                        {adhanNotice}
                      </p>
                    )}

                    {adhanPreviewStatus && (
                      <p role="status" className="text-xs font-semibold text-primary-700 dark:text-gold-300 text-center">
                        {adhanPreviewStatus}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4 2xl:flex-1 2xl:min-w-0">
              {/* Random Dhikr Notifications */}
              <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3 2xl:border-t-0 2xl:pt-0">
                <ToggleRow
                  label="تذكير عشوائي بالأذكار"
                  icon={<Bell size={18} className="text-primary-600 dark:text-gold-400" />}
                  value={settings.randomDhikrEnabled}
                  onChange={(v) => void handleRandomDhikrToggle(v)}
                />

                <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  تذكيرات لطيفة تذكّرك بالله على مدار اليوم: أذكار الصباح والمساء والاستيقاظ
                  والنوم، والاستغفار، وأذكار بعد الصلاة والمنزل والطعام والأذكار العامة —
                  وحديثٌ ورسالةٌ من القرآن وسننٌ عن النبي ﷺ ومعجزاته ضمن تذكيرات اليوم.
                  وأذكار يوم الجمعة تصل تلقائيًا كل جمعة في مواعيدها، مهما اخترت هنا.
                </p>

                {dhikrPermissionStatus && (
                  <p role="status" className="mt-2 text-xs text-primary-600 dark:text-gold-400 font-semibold">
                    {dhikrPermissionStatus}
                  </p>
                )}

                {settings.randomDhikrEnabled && (
                  <div className="mt-3 space-y-3 rounded-2xl border border-primary-100 bg-primary-50/50 p-3.5 dark:border-primary-800/80 dark:bg-primary-900/30">
                    <label htmlFor="dhikr-reminder-category" className="block text-xs font-semibold text-primary-900 dark:text-primary-100">
                      نوع رسائل التذكير
                      <select
                        id="dhikr-reminder-category"
                        value={settings.randomDhikrCategory ?? 'varied'}
                        onChange={(e) =>
                          onSaveSettings({
                            randomDhikrCategory: e.target.value as Settings['randomDhikrCategory'],
                          })
                        }
                        className="mt-1.5 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100 font-semibold"
                      >
                        <option value="varied">متنوع حسب الوقت</option>
                        <option value="morning">أذكار الصباح</option>
                        <option value="evening">أذكار المساء</option>
                        <option value="istighfar">الاستغفار</option>
                      </select>
                    </label>

                    <TimeOptionButton
                      label="الفاصل الزمني (دقيقة)"
                      value={settings.randomDhikrIntervalMinutes}
                      options={[15, 30, 60, 120]}
                      onSelect={(v) => onSaveSettings({ randomDhikrIntervalMinutes: v })}
                    />

                    <TimeOptionButton
                      label="أقصى عدد في اليوم"
                      value={settings.randomDhikrMaxPerDay ?? 16}
                      options={[4, 8, 12, 16, 24, 32, 48]}
                      onSelect={(v) => onSaveSettings({ randomDhikrMaxPerDay: v })}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        من الساعة
                        <input
                          type="time"
                          value={settings.randomDhikrStartTime}
                          onChange={(e) => onSaveSettings({ randomDhikrStartTime: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                        />
                      </label>
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        إلى الساعة
                        <input
                          type="time"
                          value={settings.randomDhikrEndTime}
                          onChange={(e) => onSaveSettings({ randomDhikrEndTime: e.target.value })}
                          className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                        />
                      </label>
                    </div>

                    <Button variant="secondary" size="sm" onClick={enableRandomDhikrNotifications} className="w-full md:w-auto md:px-5 font-semibold">
                      <Bell size={16} /> تفعيل صلاحية الإشعارات للهاتف
                    </Button>
                  </div>
                )}
              </div>

              <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
                <TimeOptionButton
                  label="مدة تأجيل التذكيرات (دقائق)"
                  value={settings.snoozeMinutes}
                  options={[5, 10, 15, 30]}
                  onSelect={(v) => onSaveSettings({ snoozeMinutes: v })}
                />
              </div>

              <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
                <TimeOptionButton
                  label="التذكير المسبق قبل وقت الصلاة (دقائق)"
                  value={settings.prePrayerReminder}
                  options={[0, 5, 10, 15, 20]}
                  onSelect={(v) => onSaveSettings({ prePrayerReminder: v })}
                />
              </div>

              {/* The four daily content notifications, each at the hour the reader chose.
                  The defaults are the hours they had before these rows existed, so an
                  install that never opens this block keeps the schedule it already had. */}
              <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3 space-y-2">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  مواقيت الإشعارات اليومية
                </p>
                <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  حديث اليوم ورسالة من القرآن، وثلاث سنن عن النبي ﷺ، وثلاث من معجزاته وشمائله —
                  تُجدول لسبعة أيام قادمة، فتصل حتى لو فتحت التطبيق بعد يوم. وما زاد على واحد في
                  اليوم يتوزّع على الساعة نفسها كل بضع دقائق.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    حديث اليوم
                    <input
                      type="time"
                      value={settings.hadithNotificationTime ?? '09:00'}
                      onChange={(e) => onSaveSettings({ hadithNotificationTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    رسالة من القرآن
                    <input
                      type="time"
                      value={settings.quranMessageTime ?? '10:00'}
                      onChange={(e) => onSaveSettings({ quranMessageTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    سنن عن النبي ﷺ (٣ يوميًا)
                    <input
                      type="time"
                      value={settings.sunnahNotificationTime ?? '14:00'}
                      onChange={(e) => onSaveSettings({ sunnahNotificationTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    معجزاته وشمائله ﷺ (٣ يوميًا)
                    <input
                      type="time"
                      value={settings.prophetNotificationTime ?? '16:00'}
                      onChange={(e) => onSaveSettings({ prophetNotificationTime: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-primary-200 bg-white px-3 py-2 text-sm text-primary-900 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </>
  );
}

