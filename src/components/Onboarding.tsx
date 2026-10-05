import { useEffect, useState } from 'react';
import { Bell, MapPin, BookOpen, Check, ChevronLeft, Heart } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui';
import { requestNotificationPermission } from '@/utils/notifications';
import { CITY_PRESETS } from '@/utils/prayerTimes';
import type { Settings } from '@/db/database';

interface OnboardingProps {
  settings: Settings;
  onComplete: (patch: Partial<Settings>) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [selectedCity, setSelectedCity] = useState<string>('القاهرة');
  const [notifGranted, setNotifGranted] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeListener: (() => void) | undefined;
    const register = async () => {
      try {
        const handle = await CapApp.addListener('backButton', () => {
          setStep((current) => current > 0 ? current - 1 : 0);
        });
        removeListener = () => {
          void handle.remove();
        };
      } catch {
        // Ignore native-back behavior when the platform API is unavailable.
      }
    };

    void register();
    return () => removeListener?.();
  }, []);

  const steps = [
    // Welcome
    {
      icon: <Heart size={64} className="text-gold-500" />,
      title: 'مرحباً بك في نور زاد',
      description: 'تطبيقك الشامل لحفظ القرآن الكريم وتتبع العبادات اليومية. يعمل بالكامل بدون إنترنت.',
      action: () => setStep(1),
      actionLabel: 'ابدأ',
    },
    // Notifications
    {
      icon: <Bell size={64} className="text-primary-600" />,
      title: 'تفعيل التنبيهات',
      description: 'تنبيهات لمواعيد الحفظ والمراجعة وأوقات الصلاة. نحتاج إذنك لإرسالها في الوقت المحدد حتى لو كان التطبيق مغلقاً.',
      action: async () => {
        setNotificationError(null);
        setRequesting(true);
        try {
          const granted = await requestNotificationPermission();
          setNotifGranted(granted);
          setStep(2);
        } catch (error) {
          setNotificationError(error instanceof Error ? error.message : 'تعذّر طلب إذن الإشعارات.');
          setStep(2);
        } finally {
          setRequesting(false);
        }
      },
      actionLabel: requesting ? 'جارٍ الطلب...' : notifGranted ? 'تم التفعيل - متابعة' : 'السماح بالتنبيهات',
    },
    // Location
    // This step only advances. It used to also call `onComplete`, which dismissed the
    // whole flow the moment a city was picked — making the "أنت جاهز!" step and its
    // progress dot unreachable. The chosen city is applied on the final step instead.
    {
      icon: <MapPin size={64} className="text-primary-600" />,
      title: 'حدد موقعك',
      description: 'القاهرة محددة افتراضياً لحساب مواقيت الصلاة واتجاه القبلة. يمكنك اختيار مدينة أخرى أو ترك القاهرة كما هي.',
      action: () => setStep(3),
      actionLabel: 'متابعة',
      extra: (
        <div className="max-h-48 overflow-y-auto space-y-1 mb-4">
          {CITY_PRESETS.map((city) => (
            <button
              key={city.name}
              onClick={() => setSelectedCity(city.name)}
              className={`w-full text-right p-3 rounded-xl flex items-center justify-between transition-smooth ${
                selectedCity === city.name
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-50 dark:bg-primary-800/30 text-gray-700 dark:text-gray-200'
              }`}
            >
              <span className="text-sm">{city.name}</span>
              {selectedCity === city.name && <Check size={16} />}
            </button>
          ))}
        </div>
      ),
    },
    // Ready
    {
      icon: <BookOpen size={64} className="text-gold-500" />,
      title: 'أنت جاهز!',
      description: 'كل شيء جاهز. ابدأ بإنشاء خطة حفظ، تصفح القرآن، أو تتبع صلواتك.',
      action: () => {
        // Applied here rather than on the location step, so picking a city does not skip
        // this screen. Cairo is preselected; the user can choose another city.
        const city = selectedCity ? CITY_PRESETS.find((c) => c.name === selectedCity) : undefined;
        onComplete(
          city
            ? {
                latitude: city.latitude,
                longitude: city.longitude,
                cityName: city.name,
                timeZone: city.timeZone,
                locationMethod: 'manual',
              }
            : {},
        );
      },
      actionLabel: 'ابدأ التطبيق',
    },
  ];

  const current = steps[step];

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 to-surface-light dark:from-primary-950 dark:to-surface-dark flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-primary-900 rounded-3xl p-8 shadow-xl animate-scale-in">
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 mt-2">{current.icon}</div>
            <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100 mb-3">{current.title}</h1>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">{current.description}</p>
          </div>
          {current.extra}
          {notificationError && step === 2 && (
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
          >
            {current.actionLabel}
            {step < 3 && <ChevronLeft size={20} />}
          </Button>
          {/* Progress dots */}
          <div className="flex justify-center gap-2 mt-6">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-2 rounded-full transition-all ${
                  i === step ? 'w-8 bg-primary-600' : i < step ? 'w-2 bg-primary-400' : 'w-2 bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
