import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Vibrate } from 'lucide-react';
import { Button } from '@/components/ui';
import { todayKey } from '@/utils/dateUtils';

const TASBIH_PRESETS = [
  { label: 'سبحان الله', text: 'سُبْحَانَ اللَّهِ', target: 33 },
  { label: 'الحمد لله', text: 'الْحَمْدُ لِلَّهِ', target: 33 },
  { label: 'الله أكبر', text: 'اللَّهُ أَكْبَرُ', target: 34 },
  { label: 'لا إله إلا الله', text: 'لَا إِلَهَ إِلَّا اللَّهُ', target: 100 },
  { label: 'استغفر الله', text: 'أَسْتَغْفِرُ اللَّهَ', target: 100 },
  { label: 'اللهم صل على محمد', text: 'اللَّهُمَّ صَلِّ عَلَى مُحَمَّدٍ', target: 100 },
];

const STORAGE_KEY = 'hifzi-tasbih';

interface TasbihState {
  /** Repetitions in the current cycle. Always < the preset target. */
  count: number;
  presetIndex: number;
  /** Cycles completed *today* — reset at midnight, see `day`. */
  cycles: number;
  /** YYYY-MM-DD that `cycles` belongs to. */
  day: string;
}

function emptyState(): TasbihState {
  return { count: 0, presetIndex: 0, cycles: 0, day: todayKey() };
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
    // A stored counter belongs to the day it was written on. Rolling over to a new day
    // must start the day's cycle tally from zero — otherwise "دورات اليوم" kept
    // accumulating forever across days and weeks.
    if (parsed.day !== fresh.day) {
      return { ...fresh, presetIndex };
    }
    const target = TASBIH_PRESETS[presetIndex].target;
    return {
      count: Math.min(Math.max(Number(parsed.count) || 0, 0), target - 1),
      presetIndex,
      cycles: Math.max(Number(parsed.cycles) || 0, 0),
      day: fresh.day,
    };
  } catch {
    return fresh;
  }
}

/** Short haptic pulse. `navigator.vibrate` is optional and throws on some browsers. */
function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // ignore — haptics are a nicety, never a failure
  }
}

export function TasbihScreen() {
  const [state, setState] = useState<TasbihState>(loadState);
  const [hapticEnabled, setHapticEnabled] = useState(true);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Hide the completion banner a couple of seconds after it appears.
  useEffect(() => {
    if (!justCompleted) return;
    const timer = setTimeout(() => setJustCompleted(false), 2500);
    return () => clearTimeout(timer);
  }, [justCompleted]);

  // Crossing midnight while the screen is open must also roll the counter over.
  useEffect(() => {
    const check = setInterval(() => {
      setState((prev) => (prev.day === todayKey() ? prev : { ...emptyState(), presetIndex: prev.presetIndex }));
    }, 60000);
    return () => clearInterval(check);
  }, []);

  const currentPreset = TASBIH_PRESETS[state.presetIndex];
  const progress = state.count / currentPreset.target;

  const handleTap = useCallback(() => {
    const willComplete = state.count + 1 >= TASBIH_PRESETS[state.presetIndex].target;

    // Kept outside the state updater: React may invoke updaters more than once
    // (StrictMode, concurrent replay), which fired the haptics twice per tap.
    if (hapticEnabled) vibrate(willComplete ? 200 : 30);

    setState((prev) => {
      const target = TASBIH_PRESETS[prev.presetIndex].target;
      const next = prev.count + 1;
      // Reaching the target completes the cycle and rolls straight into the next one,
      // so the counter never climbs past the target.
      return next >= target
        ? { ...prev, count: 0, cycles: prev.cycles + 1 }
        : { ...prev, count: next };
    });

    if (willComplete) setJustCompleted(true);
  }, [state.count, state.presetIndex, hapticEnabled]);

  const handleReset = () => {
    setState((prev) => ({ ...prev, count: 0 }));
    setJustCompleted(false);
  };

  const handleSwitchPreset = (index: number) => {
    setState((prev) => ({ ...prev, presetIndex: index, count: 0 }));
    setJustCompleted(false);
  };

  const circumference = 2 * Math.PI * 120;
  const strokeDashoffset = circumference * (1 - Math.min(progress, 1));

  return (
    <div className="space-y-4 pb-4 flex flex-col min-h-[calc(100vh-8rem)]">
      <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">المسبحة</h1>

      {/* Preset selector */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
        {TASBIH_PRESETS.map((preset, i) => (
          <button
            key={preset.label}
            onClick={() => handleSwitchPreset(i)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-smooth ${
              state.presetIndex === i
                ? 'bg-primary-600 text-white'
                : 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Counter circle.
          A real <button>, not a div: this is the screen's only control, so without a
          role, a tab stop and Enter/Space handling the counter is unusable from a
          keyboard or a screen reader. The svg stays as the visible artwork. */}
      <div className="flex-1 flex flex-col items-center justify-center">
        <button
          type="button"
          onClick={handleTap}
          aria-label={`عدّاد التسبيح، العدد الحالي ${state.count}`}
          className="relative rounded-full"
        >
          <svg width="280" height="280" viewBox="0 0 280 280" className="cursor-pointer active:scale-95 transition-transform">
            {/* Background circle */}
            <circle
              cx="140"
              cy="140"
              r="120"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-gray-100 dark:text-gray-800"
            />
            {/* Progress circle */}
            <circle
              cx="140"
              cy="140"
              r="120"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 140 140)"
              className={justCompleted ? 'text-success-500' : 'text-primary-600 dark:text-gold-400'}
              style={{ transition: 'stroke-dashoffset 0.3s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-5xl font-bold text-primary-800 dark:text-primary-100">
              {state.count}
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
              الهدف: {currentPreset.target}
            </p>
            <p className="text-lg quran-text text-primary-600 dark:text-gold-400 mt-2">
              {currentPreset.text}
            </p>
            {justCompleted && (
              <p className="text-xs text-success-500 mt-1 animate-fade-in">
                تمّت الدورة — تقبّل الله
              </p>
            )}
          </div>
        </button>

        {/* Stats */}
        <div className="flex gap-6 mt-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-200">{state.cycles}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">دورات اليوم</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-700 dark:text-primary-200">{state.count}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">التكرار الحالي</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={handleReset} className="flex items-center gap-2">
          <RotateCcw size={18} />
          <span>تصفير</span>
        </Button>
        <button
          onClick={() => setHapticEnabled(!hapticEnabled)}
          aria-pressed={hapticEnabled}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-smooth ${
            hapticEnabled
              ? 'bg-primary-100 dark:bg-primary-800 text-primary-600 dark:text-primary-300'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
          }`}
        >
          <Vibrate size={18} />
          <span>الاهتزاز</span>
        </button>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
        اضغط على الدائرة للعدّ — يُحفظ العد تلقائياً ويتصفّر مع بداية اليوم
      </p>
    </div>
  );
}