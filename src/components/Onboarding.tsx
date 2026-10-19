import { useEffect, useState } from 'react';
import { Bell, MapPin, BookOpen, Check, ChevronLeft, Heart, Search, Palette } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui';
import { requestNotificationPermission } from '@/utils/notifications';
import { getProtectionStatus, openProtectionSettings } from '@/utils/adhanOverlay';
import { CITY_PRESETS } from '@/utils/prayerTimes';
import { COLOR_PALETTES } from '@/utils/colorThemes';
import { useTheme } from '@/hooks/useApp';
import type { Settings } from '@/db/database';

interface OnboardingProps {
  settings: Settings;
  onComplete: (patch: Partial<Settings>) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { colorPalette, changeColorPalette } = useTheme();
  const [step, setStep] = useState(0);
  const [selectedCity, setSelectedCity] = useState<string>('القاهرة');
  const [citySearch, setCitySearch] = useState('');
  const [notifGranted, setNotifGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  // Whether the device still holds the adhan back via battery optimisation. Read on
  // native once the notification step is reached; on web it stays false and no prompt
  // is ever shown.
  const [batteryRestricted, setBatteryRestricted] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let removeListener: (() => void) | undefined;

    CapApp.addListener('backButton', () => {
      setStep((current) => current > 0 ? current - 1 : 0);
    })
      .then((handle) => {
        // Released at once if the step screen was already left behind.
        if (disposed) void handle.remove();
        else removeListener = () => void handle.remove();
      })
      .catch(() => {
        // Ignore native-back behavior when the platform API is unavailable.
      });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  // Apply selected palette in real-time during onboarding
  useEffect(() => {
    document.documentElement.dataset.palette = colorPalette;
  }, [colorPalette]);

  const steps: Array<{
    icon: React.ReactNode;
    title: string;
    description: string;
    tips?: string[];
    extra?: React.ReactNode;
    action: () => void;
    actionLabel: string;
  }> = [
    // Welcome
    {
      icon: <Heart size={64} style={{ color: 'var(--brand-from, #1f734e)' }} />,
      title: 'مرحباً بك في قُرّة',
      description: 'تطبيقك الشامل لحفظ القرآن الكريم وتتبع العبادات اليومية. يعمل بالكامل بدون إنترنت.',
      tips: [
        '📖 القرآن الكريم مع التلاوة الصوتية',
        '🕌 مواقيت الصلاة مع التنبيهات',
        '📚 خطط الحفظ والمراجعة الذكية',
        '📖 مكتبة أحاديث كاملة أوفلاين',
        '🤲 أذكار ومسبحة إلكترونية',
        '📊 تتبع التقدم والإحصائيات',
      ],
      action: () => setStep((current) => current + 1),
      actionLabel: 'ابدأ',
    },
    // Notifications
    {
      icon: <Bell size={64} style={{ color: 'var(--brand-from, #1f734e)' }} />,
      title: 'تفعيل التنبيهات',
      description: 'تنبيهات لمواعيد الحفظ والمراجعة وأوقات الصلاة. نحتاج إذنك لإرسالها في الوقت المحدد حتى لو كان التطبيق مغلقاً.',
      tips: [
        '⏰ تنبيهات الأذان لكل صلاة',
        '📝 تذكيرات المهام اليومية',
        '🤲 تذكيرات الأذكار',
        '🔔 تنبيهات قابلة للتخصيص',
        // Shown only on the devices that asked for the battery exemption above — it
        // explains the extra system page instead of leaving it a mystery.
        ...(batteryRestricted
          ? ['🔋 أضف التطبيق إلى قائمة الاستثناء ليُرنّ الأذان والتطبيق مغلق']
          : []),
      ],
      action: async () => {
        setNotificationError(null);
        setRequesting(true);
        try {
          const granted = await requestNotificationPermission();
          setNotifGranted(granted);
          // The permission alone does not let the adhan ring while the phone sleeps:
          // battery optimisation still freezes the exact alarms. Surface that now,
          // while the reader is already granting adhan reliability, so the page opens
          // only on the devices that actually need it (checked, not assumed).
          if (granted && Capacitor.isNativePlatform()) {
            try {
              const protection = await getProtectionStatus();
              if (protection && !protection.ignoringBatteryOptimizations) {
                setBatteryRestricted(true);
                await openProtectionSettings('battery');
              }
            } catch {
              // Protection probe is best-effort; never block onboarding on it.
            }
          }
          setStep((current) => current + 1);
        } catch (error) {
          setNotificationError(error instanceof Error ? error.message : 'تعذّر طلب إذن الإشعارات.');
          setStep((current) => current + 1);
        } finally {
          setRequesting(false);
        }
      },
      actionLabel: requesting ? 'جارٍ الطلب...' : notifGranted ? 'تم التفعيل - متابعة' : 'السماح بالتنبيهات',
    },
    // Color Palette
    {
      icon: <Palette size={64} style={{ color: 'var(--brand-from, #1f734e)' }} />,
      title: 'اختر لونك المفضل',
      description: 'اختر نغمة ألوان تناسب ذوقك. يمكنك تغييرها لاحقاً من الإعدادات.',
      action: () => setStep((current) => current + 1),
      actionLabel: 'متابعة',
      extra: (
        <div className="w-full mb-4">
          <div className="grid grid-cols-3 gap-3">
            {COLOR_PALETTES.map((palette) => {
              const selected = colorPalette === palette.id;
              return (
                <button
                  key={palette.id}
                  type="button"
                  onClick={() => changeColorPalette(palette.id)}
                  className="group relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-300 hover:scale-105 active:scale-95"
                  style={{
                    background: selected ? palette.gradient : '#ffffff',
                    boxShadow: selected
                      ? `0 8px 24px ${palette.glow}, 0 0 0 2px ${palette.color}40`
                      : '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className="h-3 w-3 rounded-full ring-2 ring-white/30"
                      style={{ backgroundColor: palette.color }}
                    />
                    <span
                      className="h-3 w-3 rounded-full ring-2 ring-white/30"
                      style={{ backgroundColor: palette.accent }}
                    />
                  </div>
                  <div className="flex flex-col items-center text-center leading-tight">
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: selected ? '#ffffff' : palette.color }}
                    >
                      {palette.name}
                    </span>
                    <span
                      className="text-[8px] font-medium tracking-wide"
                      style={{ color: selected ? 'rgba(255,255,255,0.8)' : '#9ca3af' }}
                    >
                      {palette.latin}
                    </span>
                  </div>
                  {selected && (
                    <div className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center rounded-full bg-white shadow-md">
                      <Check size={12} style={{ color: palette.color }} strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ),
    },
    // Location
    // This step only advances. It used to also call `onComplete`, which dismissed the
    // whole flow the moment a city was picked — making the "أنت جاهز!" step and its
    // progress dot unreachable. The chosen city is applied on the final step instead.
    {
      icon: <MapPin size={64} style={{ color: 'var(--brand-from, #1f734e)' }} />,
      title: 'حدد موقعك',
      description: 'اختر مدينتك لضبط مواقيت الصلاة بدقة. القاهرة محددة افتراضياً، ويمكنك البحث بين مدن ومحافظات مصر.',
      action: () => setStep((current) => current + 1),
      actionLabel: 'متابعة',
      extra: (
        <div className="w-full mb-4">
          <label className="relative mb-2 block">
            <Search size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--brand-from, #1f734e)' }} />
            <input
              type="search"
              value={citySearch}
              onChange={(event) => setCitySearch(event.target.value)}
              placeholder="ابحث عن مدينتك..."
              aria-label="ابحث عن مدينة"
              className="w-full rounded-xl border py-2.5 pr-10 pl-3 text-sm outline-none focus:ring-2 bg-white dark:bg-primary-950 transition-all"
              style={{
                borderColor: 'var(--brand-from, #1f734e)',
                color: 'var(--brand-from, #1f734e)',
                '--tw-ring-color': 'var(--brand-from, #1f734e)'
              } as React.CSSProperties}
            />
          </label>
          <div role="radiogroup" aria-label="المدن المصرية" className="max-h-48 md:max-h-80 overflow-y-auto space-y-1">
          {CITY_PRESETS.filter((city) => city.name.includes(citySearch.trim())).map((city) => (
            <button
              key={city.name}
              onClick={() => setSelectedCity(city.name)}
              role="radio"
              aria-checked={selectedCity === city.name}
              className="w-full text-right p-3 rounded-xl flex items-center justify-between transition-smooth"
              style={{
                background: selectedCity === city.name
                  ? 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))'
                  : '#f9fafb',
                color: selectedCity === city.name ? 'white' : '#374151'
              }}
            >
              <span className="text-sm">{city.name}</span>
              {selectedCity === city.name && <Check size={16} />}
            </button>
          ))}
          {CITY_PRESETS.every((city) => !city.name.includes(citySearch.trim())) && (
            <p className="py-4 text-center text-sm text-gray-500">لا توجد مدينة بهذا الاسم.</p>
          )}
          </div>
        </div>
      ),
    },
    // Ready
    {
      icon: <BookOpen size={64} style={{ color: 'var(--brand-from, #1f734e)' }} />,
      title: 'أنت جاهز!',
      description: 'كل شيء جاهز. ابدأ بإنشاء خطة حفظ، تصفح القرآن، أو تتبع صلواتك.',
      action: () => {
        // Applied here rather than on the location step, so picking a city does not skip
        // this screen. Cairo is preselected; the user can choose another city.
        const city = selectedCity ? CITY_PRESETS.find((c) => c.name === selectedCity) : undefined;
        // `randomDhikrEnabled` is deliberately left untouched: onboarding no longer asks for
        // the random dhikr reminders, so they stay off until the reader opts in from the
        // in-app notice or from Settings.
        onComplete(
          city
            ? {
                latitude: city.latitude,
                longitude: city.longitude,
                cityName: city.name,
                timeZone: city.timeZone,
                locationMethod: 'manual',
                colorPalette: colorPalette,
              }
            : { colorPalette: colorPalette },
        );
      },
      actionLabel: 'ابدأ التطبيق',
    },
  ];

  const current = steps[step] as {
    icon: React.ReactNode;
    title: string;
    description: string;
    tips?: string[];
    extra?: React.ReactNode;
    action: () => void;
    actionLabel: string;
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))'
      }}
    >
      <div className="max-w-md sm:max-w-lg md:max-w-xl w-full">
        <div className="bg-white/95 dark:bg-primary-900/95 backdrop-blur-xl rounded-3xl p-8 shadow-2xl animate-scale-in border border-white/20">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 mt-2 relative">
              <div
                className="absolute inset-0 blur-3xl opacity-30 rounded-full"
                style={{ background: 'var(--brand-from, #1f734e)' }}
              />
              <div className="relative">{current.icon}</div>
            </div>
            <h1
              className="text-2xl md:text-3xl font-bold mb-3"
              style={{ color: 'var(--brand-from, #1f734e)' }}
            >
              {current.title}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">{current.description}</p>
            {current.tips && (
              <div
                className="w-full text-right rounded-xl p-4 mb-6"
                style={{
                  background: 'var(--brand-soft, #eef7f1)',
                  border: '1px solid var(--brand-from, #1f734e)',
                  borderWidth: '0.5px'
                }}
              >
                <p
                  className="text-xs font-semibold mb-2"
                  style={{ color: 'var(--brand-from, #1f734e)' }}
                >
                  الميزات الرئيسية:
                </p>
                <ul className="space-y-1">
                  {current.tips.map((tip, i) => (
                    <li key={i} className="text-xs text-gray-600 dark:text-gray-300">{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {current.extra}
          {notificationError && step === 3 && (
            <p className="mb-4 text-sm text-red-600 dark:text-red-300" role="alert">
              {notificationError} يمكنك المتابعة وتفعيلها لاحقاً من الإعدادات.
            </p>
          )}
          <Button
            fullWidth
            size="lg"
            variant="primary"
            onClick={current.action}
            disabled={requesting}
            className="shadow-lg"
            style={{
              background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))'
            }}
          >
            {current.actionLabel}
            {step < steps.length - 1 && <ChevronLeft size={20} />}
          </Button>
          {/* Progress dots */}
          <div className="flex justify-center gap-2 mt-6">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all ${
                  i === step ? 'w-8' : 'w-2'
                }`}
                style={{
                  background: i === step
                    ? 'var(--brand-to, #b84414)'
                    : i < step
                    ? 'var(--brand-from, #1f734e)'
                    : '#e5e7eb'
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
