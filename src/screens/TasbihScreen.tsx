import { useState, useEffect, useCallback, useRef } from 'react';
import { RotateCcw, Vibrate, Volume2, VolumeX, Sparkles, Check, Flame, Trophy, Layers } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { todayKey } from '@/utils/dateUtils';

const TASBIH_PRESETS = [
  { label: 'سبحان الله', text: 'سُبْحَانَ اللَّهِ', target: 33 },
  { label: 'الحمد لله', text: 'الْحَمْدُ لِلَّهِ', target: 33 },
  { label: 'الله أكبر', text: 'اللَّهُ أَكْبَرُ', target: 34 },
  { label: 'لا إله إلا الله', text: 'لَا إِلَهَ إِلَّا اللَّهُ', target: 100 },
  { label: 'أستغفر الله', text: 'أَسْتَغْفِرُ اللَّهَ وَأَتُوبُ إِلَيْهِ', target: 100 },
  { label: 'الصلاة على النبي', text: 'اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ', target: 100 },
  { label: 'سبحان الله وبحمده', text: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ ، سُبْحَانَ اللَّهِ الْعَظِيمِ', target: 100 },
  { label: 'لا حول ولا قوة إلا بالله', text: 'لَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ العَلِيِّ العَظِيمِ', target: 100 },
  { label: 'دعاء ذي النون', text: 'لَا إِلَهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ', target: 100 },
];

const STORAGE_KEY = 'hifzi-tasbih';

interface TasbihState {
  count: number;
  presetIndex: number;
  cycles: number;
  totalToday: number;
  day: string;
}

function emptyState(): TasbihState {
  return { count: 0, presetIndex: 0, cycles: 0, totalToday: 0, day: todayKey() };
}

function loadState(): TasbihState {
  const fresh = emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<TasbihState>;
    const presetIndex =
      typeof parsed.presetIndex === 'number' && TASBIH_PRESETS[parsed.presetIndex]
        ? parsed.presetIndex
        : 0;

    if (parsed.day !== fresh.day) {
      return { ...fresh, presetIndex };
    }

    const target = TASBIH_PRESETS[presetIndex].target;
    return {
      count: Math.min(Math.max(Number(parsed.count) || 0, 0), target - 1),
      presetIndex,
      cycles: Math.max(Number(parsed.cycles) || 0, 0),
      totalToday: Math.max(Number(parsed.totalToday) || 0, 0),
      day: fresh.day,
    };
  } catch {
    return fresh;
  }
}

// Tactile vibration handler across native mobile and web
function triggerHaptic(pattern: number | number[]) {
  if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignore vibration permissions or restrictions
    }
  }
}

// Web Audio click synthesizer for instant tactile audio feedback
function playClickAudio() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.03);

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.03);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.03);
  } catch {
    // Ignore audio context errors
  }
}

export function TasbihScreen() {
  const [state, setState] = useState<TasbihState>(loadState);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [fullScreenTap, setFullScreenTap] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Hide completion banner after 3 seconds
  useEffect(() => {
    if (!justCompleted) return;
    const timer = setTimeout(() => setJustCompleted(false), 3000);
    return () => clearTimeout(timer);
  }, [justCompleted]);

  // Midnight rollover check
  useEffect(() => {
    const check = setInterval(() => {
      setState((prev) => (prev.day === todayKey() ? prev : { ...emptyState(), presetIndex: prev.presetIndex }));
    }, 30000);
    return () => clearInterval(check);
  }, []);

  const currentPreset = TASBIH_PRESETS[state.presetIndex];
  const progress = state.count / currentPreset.target;

  const handleTap = useCallback(() => {
    const willComplete = state.count + 1 >= TASBIH_PRESETS[state.presetIndex].target;

    // Haptics vibration pattern: strong double-pulse on cycle completion, crisp vibration on regular tap
    if (hapticEnabled) {
      if (willComplete) {
        triggerHaptic([70, 50, 70, 50, 150]);
      } else {
        triggerHaptic(45);
      }
    }

    if (soundEnabled) {
      playClickAudio();
    }

    setIsPressing(true);
    setTimeout(() => setIsPressing(false), 100);

    setState((prev) => {
      const target = TASBIH_PRESETS[prev.presetIndex].target;
      const next = prev.count + 1;
      const newTotal = prev.totalToday + 1;

      return next >= target
        ? { ...prev, count: 0, cycles: prev.cycles + 1, totalToday: newTotal }
        : { ...prev, count: next, totalToday: newTotal };
    });

    if (willComplete) {
      setJustCompleted(true);
    }
  }, [state.count, state.presetIndex, hapticEnabled, soundEnabled]);

  const handleReset = () => {
    if (hapticEnabled) triggerHaptic(80);
    setState((prev) => ({ ...prev, count: 0 }));
    setJustCompleted(false);
  };

  const handleSwitchPreset = (index: number) => {
    if (hapticEnabled) triggerHaptic(30);
    setState((prev) => ({ ...prev, presetIndex: index, count: 0 }));
    setJustCompleted(false);
  };

  const circumference = 2 * Math.PI * 115;
  const strokeDashoffset = circumference * (1 - Math.min(progress, 1));

  return (
    <div
      ref={containerRef}
      className={`relative space-y-5 pb-6 flex flex-col min-h-[calc(100vh-7.5rem)] select-none ${
        fullScreenTap ? 'cursor-pointer' : ''
      }`}
      dir="rtl"
      onClick={fullScreenTap ? handleTap : undefined}
    >
      {/* Top Title Bar & Settings Buttons */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary-900 dark:text-primary-50 flex items-center gap-2">
            <Sparkles className="text-amber-500 animate-pulse" size={24} />
            المسبحة الإلكترونية
          </h1>
          <p className="text-xs text-primary-700/80 dark:text-primary-300 mt-0.5">
            تسبيح تفاعلي واهتزاز عالي الدقة بدون إنترنت
          </p>
        </div>

        {/* Haptic & Sound Quick Controls */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-primary-50 p-1 dark:bg-primary-900/60 border border-primary-200/60 dark:border-primary-800/60">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setHapticEnabled(!hapticEnabled);
            }}
            title={hapticEnabled ? 'إيقاف الاهتزاز' : 'تفعيل الاهتزاز'}
            aria-label="تفعيل الاهتزاز"
            className={`rounded-xl p-2 text-xs font-semibold transition ${
              hapticEnabled
                ? 'bg-primary-600 text-white shadow-md'
                : 'text-gray-400 dark:text-gray-500 hover:text-primary-700'
            }`}
          >
            <Vibrate size={18} />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSoundEnabled(!soundEnabled);
            }}
            title={soundEnabled ? 'إيقاف الصوت' : 'تفعيل الصوت'}
            aria-label="تفعيل الصوت"
            className={`rounded-xl p-2 text-xs font-semibold transition ${
              soundEnabled
                ? 'bg-primary-600 text-white shadow-md'
                : 'text-gray-400 dark:text-gray-500 hover:text-primary-700'
            }`}
          >
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>

      {/* Preset Dhikr Selector Horizontal Strip */}
      <div className="flex gap-2 overflow-x-auto pb-1.5 -mx-4 px-4 scrollbar-hide">
        {TASBIH_PRESETS.map((preset, i) => {
          const active = state.presetIndex === i;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSwitchPreset(i);
              }}
              className={`shrink-0 rounded-2xl px-4 py-2 text-xs font-bold transition-all shadow-sm ${
                active
                  ? 'bg-gradient-to-r from-primary-700 to-primary-600 text-white shadow-primary-900/30 ring-2 ring-gold-400/50 scale-[1.02]'
                  : 'bg-white text-primary-800 hover:bg-primary-50 dark:bg-primary-900/40 dark:text-primary-100 dark:hover:bg-primary-800/60 border border-primary-100 dark:border-primary-800/80'
              }`}
            >
              {preset.label}
              <span className={`mr-1.5 text-[10px] opacity-75 ${active ? 'text-amber-300' : 'text-primary-500'}`}>
                ({preset.target})
              </span>
            </button>
          );
        })}
      </div>

      {/* Main Interactive Counter Disk */}
      <div className="flex-1 flex flex-col items-center justify-center my-auto">
        <div className="relative flex items-center justify-center">
          {/* Main Counter Radial Button */}
          <button
            type="button"
            onClick={(e) => {
              if (fullScreenTap) return;
              e.stopPropagation();
              handleTap();
            }}
            aria-label={`عدّاد التسبيح، العدد الحالي ${state.count}`}
            className={`relative group rounded-full outline-none transition-transform duration-100 ${
              isPressing ? 'scale-90' : 'hover:scale-[1.02] active:scale-95'
            }`}
          >
            {/* Ambient Background Glow */}
            <div className="absolute -inset-4 rounded-full bg-gradient-to-tr from-primary-600/20 via-amber-500/20 to-primary-600/10 blur-2xl opacity-80 group-hover:opacity-100 transition-opacity" />

            {/* SVG Ring Progress Art */}
            <svg width="270" height="270" viewBox="0 0 270 270" className="relative z-10 drop-shadow-xl">
              <defs>
                <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" />
                  <stop offset="50%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#059669" />
                </linearGradient>
              </defs>

              {/* Background Outer Ring */}
              <circle
                cx="135"
                cy="135"
                r="115"
                fill="none"
                stroke="currentColor"
                strokeWidth="10"
                className="text-primary-100/70 dark:text-primary-900/60"
              />

              {/* Progress Animated Ring */}
              <circle
                cx="135"
                cy="135"
                r="115"
                fill="none"
                stroke={justCompleted ? '#10b981' : 'url(#ringGradient)'}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                transform="rotate(-90 135 135)"
                className="transition-all duration-300 ease-out"
              />
            </svg>

            {/* Inner Content Display */}
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center pointer-events-none">
              <span className="text-xs font-semibold text-primary-600 dark:text-gold-400 bg-primary-100/70 dark:bg-primary-900/80 px-3 py-0.5 rounded-full mb-1">
                الهدف: {currentPreset.target}
              </span>

              {/* Main Big Count Number */}
              <p className="text-6xl font-black text-primary-900 dark:text-primary-50 tracking-tight font-sans my-1">
                {state.count}
              </p>

              {/* Dhikr Arabic Phrase */}
              <p className="text-base font-serif font-bold text-primary-800 dark:text-gold-300 max-w-[190px] leading-snug">
                {currentPreset.text}
              </p>

              {/* Completion Celebratory Toast */}
              {justCompleted && (
                <div className="mt-2 flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white shadow-lg animate-bounce">
                  <Check size={14} /> تمّت الدورة بنجاح!
                </div>
              )}
            </div>
          </button>
        </div>

        {/* Quick Mode & Reset Bar */}
        <div className="mt-6 flex items-center justify-between w-full max-w-xs gap-3">
          <Button
            variant="secondary"
            onClick={handleReset}
            className="flex-1 flex items-center justify-center gap-2 font-bold text-xs py-2.5 rounded-xl border border-primary-200 dark:border-primary-800"
          >
            <RotateCcw size={16} /> تصفير العداد
          </Button>

          {/* Tap Anywhere Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setFullScreenTap(!fullScreenTap);
            }}
            className={`flex-1 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
              fullScreenTap
                ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md font-extrabold'
                : 'bg-white dark:bg-primary-900/50 border-primary-200 dark:border-primary-800 text-primary-800 dark:text-primary-100'
            }`}
          >
            <Layers size={15} />
            {fullScreenTap ? 'الضغط في أي مكان: مفعل' : 'الضغط بأي مكان'}
          </button>
        </div>
      </div>

      {/* Stats Dashboard Card */}
      <Card className="border border-primary-200/80 dark:border-primary-800/80 shadow-md bg-white/90 dark:bg-primary-950/80 backdrop-blur-sm">
        <div className="grid grid-cols-3 gap-2 text-center divide-x divide-x-reverse divide-primary-100 dark:divide-primary-800/60">
          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-amber-500 mb-1">
              <Trophy size={16} />
            </div>
            <p className="text-xl font-extrabold text-primary-900 dark:text-primary-50">{state.cycles}</p>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">دورات مكتملة اليوم</p>
          </div>

          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-emerald-500 mb-1">
              <Flame size={16} />
            </div>
            <p className="text-xl font-extrabold text-primary-900 dark:text-primary-50">{state.totalToday}</p>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">مجموع تسبيحات اليوم</p>
          </div>

          <div className="px-2">
            <div className="flex items-center justify-center gap-1 text-primary-600 dark:text-gold-400 mb-1">
              <Sparkles size={16} />
            </div>
            <p className="text-xl font-extrabold text-primary-900 dark:text-primary-50">{Math.round(progress * 100)}%</p>
            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">التقدم بالدورة</p>
          </div>
        </div>
      </Card>
    </div>
  );
}