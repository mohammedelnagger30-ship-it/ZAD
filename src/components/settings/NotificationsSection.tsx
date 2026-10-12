import { useState, useCallback, useEffect, useRef } from 'react';
import { Bell, Download, Play, Sparkles, Square, Trash2, Volume2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Card, Button } from '@/components/ui';
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
  AdhanDownloadError,
  deleteAdhanVoice,
  downloadAdhanVoice,
  resolveAdhanPlayUrl,
} from '@/utils/adhanStore';
import { rescheduleAllNotifications } from '@/utils/notificationScheduler';
import { canScheduleExactAlarms, NOTIFICATION_WARNING_EVENT, requestExactAlarms, requestNotificationPermission } from '@/utils/notifications';
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
  const [exactAlarmNotice, setExactAlarmNotice] = useState<'' | 'denied' | 'inexact' | 'failed'>('');
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
    };
    window.addEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    return () => {
      alive = false;
      window.removeEventListener(NOTIFICATION_WARNING_EVENT, onWarning);
    };
  }, []);

  const stopAdhanPreview = useCallback(() => {
    const audio = adhanAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      adhanAudioRef.current = null;
    }
    setPreviewingAdhanId(null);
  }, []);

  const playAdhanPreview = useCallback(async () => {
    const sound = ADHAN_SOUNDS.find((item) => item.id === settings.adhanVoiceId) ?? ADHAN_SOUNDS[0];
    if (previewingAdhanId === sound.id) {
      stopAdhanPreview();
      setAdhanPreviewStatus('تم إيقاف الاستماع.');
      return;
    }

    stopAdhanPreview();
    setAdhanPreviewStatus('');
    let url: string;
    try {
      // Bundled voices play from the app package; downloaded ones from the stored file.
      url = await resolveAdhanPlayUrl(sound);
    } catch {
      setAdhanPreviewStatus('تعذّق الوصول إلى ملف الصوت. أعد تنزيل الصوت ثم حاول مجددًا.');
      return;
    }
    const audio = new Audio(url);
    audio.preload = 'auto';
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
    adhanAudioRef.current = audio;
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
  }, [previewingAdhanId, settings.adhanVoiceId, stopAdhanPreview]);

  useEffect(() => {
    if (previewingAdhanId && previewingAdhanId !== settings.adhanVoiceId) {
      stopAdhanPreview();
      setAdhanPreviewStatus('تم إيقاف التسجيل بعد تغيير صوت الأذان.');
    }
  }, [previewingAdhanId, settings.adhanVoiceId, stopAdhanPreview]);

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
  }, [adhanDownloadingId, settings.adhanVoiceId]);

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
    } else {
      setAdhanNotice('حُذف الصوت من الجهاز.');
    }
  }, [onSaveSettings, settings.adhanVoiceId]);

  useEffect(() => () => {
    adhanAbortRef.current?.abort();
  }, []);

  // Every voice is offered in the picker: a bundled one is ready at once, the rest are
  // ready only after the user downloads them — picking one that isn't on the device yet
  // simply puts its download button under the picker.
  const selectedAdhan = getAdhanSound(settings.adhanVoiceId);
  const selectedAdhanReady = isAdhanSoundReady(selectedAdhan, downloadedAdhanVoices);

  useEffect(() => () => {
    adhanAudioRef.current?.pause();
    adhanAudioRef.current = null;
  }, []);

  const enableRandomDhikrNotifications = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setDhikrPermissionStatus('التذكيرات المجدولة تعمل في تطبيق أندرويد، وليس في معاينة المتصفح.');
      return;
    }
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
      <section className="space-y-2">
        <SectionTitle icon={<Bell size={20} />} title="التنبيهات وصوت الأذان" />
        <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md space-y-4">
          {exactAlarmNotice !== '' && (
            <div className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-700 dark:bg-amber-900/30">
              <p className="text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
                {exactAlarmNotice === 'denied'
                  ? 'تنبيهات الأذان الدقيقة موقوفة من إعدادات الجهاز — الأذان قد يتأخر دقائق أثناء السكون.'
                  : exactAlarmNotice === 'inexact'
                    ? 'شُغّلت تنبيهات هذا الدور بنظام تقريبي — الأذان قد يتأخر دقائق أثناء السكون.'
                    : 'تعذّرت جدولة تنبيهات هذا الدور، وعادت التنبيهات السابقة إلى مكانها؛ ستُعاد المحاولة عند فتح التطبيق.'}
              </p>
              {exactAlarmNotice !== 'failed' && (
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
              )}
            </div>
          )}

          <ToggleRow
            label="أصوات تنبيهات المهام والحفظ"
            icon={<Volume2 size={18} className="text-primary-600 dark:text-gold-400" />}
            value={settings.notificationSound}
            onChange={(v) => onSaveSettings({ notificationSound: v })}
          />

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
                      <span className="flex-1 text-[11px] md:text-xs font-semibold text-primary-900 dark:text-primary-100">
                        {selectedAdhan.name}
                        {selectedAdhan.remote ? ` — ${adhanSizeLabel(selectedAdhan.remote.sizeBytes)}` : ''}
                      </span>
                      {adhanDownloadingId === selectedAdhan.id ? (
                        <button
                          type="button"
                          onClick={cancelAdhanDownload}
                          className="rounded-lg bg-amber-100 px-2.5 py-1 text-[11px] md:text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                        >
                          {adhanProgress && adhanProgress.total > 0
                            ? `${Math.floor((adhanProgress.received / adhanProgress.total) * 100)}٪ — إيقاف`
                            : 'جارٍ التنزيل — إيقاف'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void downloadAdhan(selectedAdhan)}
                          className="flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1 text-[11px] md:text-xs font-bold text-white hover:bg-primary-700"
                        >
                          <Download size={12} /> تنزيل
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] md:text-xs text-primary-700 dark:text-primary-300">
                      يُنزَّل مرة واحدة فيصير صالحًا للأذان وصفحة الصلاة والإشعار بلا إنترنت — وحتى يكتمل التنزيل يواصل إشعار الصلاة بصوت المسجد الحرام.
                    </p>
                  </div>
                )}

                {selectedAdhanReady && !selectedAdhan.bundled && (
                  <div className="flex items-center gap-2 rounded-2xl border border-primary-100 bg-white/70 px-3 py-2.5 dark:border-primary-800/80 dark:bg-primary-900/20">
                    <span className="flex-1 text-[11px] md:text-xs font-semibold text-primary-900 dark:text-primary-100">
                      {selectedAdhan.name} — مُنزَّل على الجهاز
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeAdhan(selectedAdhan)}
                      className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-[11px] md:text-xs font-bold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-950/40"
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

          {/* Random Dhikr Notifications */}
          <div className="border-t border-primary-100 dark:border-primary-800/60 pt-3">
            <ToggleRow
              label="تذكير عشوائي بالأذكار"
              icon={<Bell size={18} className="text-primary-600 dark:text-gold-400" />}
              value={settings.randomDhikrEnabled}
              onChange={(v) => onSaveSettings({ randomDhikrEnabled: v })}
            />

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
                {dhikrPermissionStatus && (
                  <p role="status" className="text-xs text-primary-600 dark:text-gold-400 font-semibold text-center">
                    {dhikrPermissionStatus}
                  </p>
                )}
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
        </Card>
      </section>
    </>
  );
}

function ToggleRow({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-primary-900 dark:text-primary-100">
        {icon}
        <span>{label}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
          value ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-700'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
            value ? '-translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
