import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Compass, RotateCcw, X } from 'lucide-react';
import { Card } from '@/components/ui';
import { toArabicNumber } from '@/data/surahs';
import {
  CALIBRATION_TARGET_BINS,
  CALIBRATION_TARGET_ROTATION_DEG,
  calibrationProgress as progressOf,
  emptyTally,
  isCalibrated,
  tallyHeading,
  type CalibrationTally,
} from '@/utils/qiblaCalibration';

interface QiblaCompassProps {
  /** Qibla bearing in degrees clockwise from true north. */
  qiblaDirection: number;
  /** Optional context line, e.g. the selected city. */
  contextLabel?: string;
}

/**
 * How far the phone may point from the qibla before it counts as aligned —
 * a phone magnetometer is noisy to ±4° on a good day, so anything tighter
 * makes the "aligned" state flicker and buzz constantly.
 */
const ALIGN_TOLERANCE_DEG = 6;

/*
 * The wizard's criteria live in `@/utils/qiblaCalibration` — the two bars, what
 * counts towards them, and the proof that neither alone is enough.
 */

type CompassState = 'idle' | 'active' | 'denied' | 'unsupported';

/** Shortest signed difference between two bearings, in [-180, 180]. */
function angleDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Safari/iOS-only extension of the orientation event, absent from lib.dom.
 * Declared here rather than cast ad hoc at every use.
 */
interface WebkitDeviceOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}

function normalise(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * A live qibla compass.
 *
 * The screen used to show a static number — «١٣٦° من الشمال» — and left the user
 * to aim a phone that has a compass built in. This turns that number into an
 * instrument: a dial that counter-rotates against the device heading, a qibla
 * marker riding the ring, and an aligned state (within 6°) that lights up and
 * buzzes once so the phone can be held at arm's length.
 *
 * Platform notes handled here:
 * - iOS 13+ only fires orientation events after `DeviceOrientationEvent.requestPermission()`,
 *   which must run inside a user gesture — hence the «تفعيل البوصلة» button instead
 *   of auto-starting.
 * - Android/Chrome fire events without any permission; we start on mount.
 * - Desktops have no magnetometer: the component says so rather than showing a
 *   dial frozen at a made-up heading.
 *
 * The bearing math is deliberately boring: iOS exposes `webkitCompassHeading`
 * directly, everything else exposes `alpha` (counter-clockwise from north), and
 * both are folded into one clockwise `heading` the rest of the component uses.
 */
export function QiblaCompass({ qiblaDirection, contextLabel }: QiblaCompassProps) {
  const [state, setState] = useState<CompassState>('idle');
  const [heading, setHeading] = useState<number | null>(null);
  const headingRef = useRef<number | null>(null);
  const alignedRef = useRef(false);
  const listenerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  /**
   * The figure-8 wizard. `calibrationRef` gates whether sensor readings are
   * counted — refs, not state, because the orientation handler runs at sensor
   * rate and must not re-subscribe itself to stay current.
   */
  const [calibration, setCalibration] = useState<'idle' | 'running' | 'done'>('idle');
  const [tally, setTally] = useState<CalibrationTally>(emptyTally);
  const calibrationRef = useRef(false);
  const tallyRef = useRef<CalibrationTally>(emptyTally());

  const handleOrientation = useCallback((event: DeviceOrientationEvent) => {
    const webkitEvent = event as WebkitDeviceOrientationEvent;
    const raw =
      typeof webkitEvent.webkitCompassHeading === 'number' &&
      !Number.isNaN(webkitEvent.webkitCompassHeading)
        ? webkitEvent.webkitCompassHeading // iOS: degrees clockwise from magnetic north.
        : typeof event.alpha === 'number'
          ? 360 - event.alpha // Everyone else: alpha runs counter-clockwise.
          : null;
    if (raw === null) return;
    const next = normalise(raw);
    const previous = headingRef.current;
    // deviceorientation fires at sensor rate; skip sub-degree noise so the dial
    // does not trigger a React render for an invisible change.
    if (previous !== null && Math.abs(angleDelta(previous, next)) < 1) return;
    headingRef.current = next;
    setHeading(next);
    // While the wizard runs, every reading it keeps counts towards both bars:
    // how far the phone has been turned, and how many directions it pointed
    // through. The 1° filter above already stands in for the noise floor, so
    // a hand trembling in place cannot climb either one.
    if (calibrationRef.current) {
      const step = previous === null ? 0 : Math.abs(angleDelta(previous, next));
      tallyRef.current = tallyHeading(tallyRef.current, step, next);
      setTally(tallyRef.current);
    }
  }, []);

  const startListening = useCallback(() => {
    window.addEventListener('deviceorientation', handleOrientation, true);
    listenerRef.current = handleOrientation;
    setState('active');
  }, [handleOrientation]);

  const stopListening = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('deviceorientation', listenerRef.current, true);
      listenerRef.current = null;
    }
  }, []);

  /** iOS permission prompt — must be called from a click handler. */
  const requestPermission = useCallback(async () => {
    // `typeof` guards the identifier itself: a browser without the API at all
    // would throw a ReferenceError on a bare reference.
    const api =
      typeof DeviceOrientationEvent !== 'undefined'
        ? (DeviceOrientationEvent as unknown as {
            requestPermission?: () => Promise<'granted' | 'denied'>;
          })
        : null;
    if (!api) {
      setState('unsupported');
      return;
    }
    if (typeof api.requestPermission !== 'function') {
      startListening();
      return;
    }
    try {
      const result = await api.requestPermission();
      if (result === 'granted') startListening();
      else setState('denied');
    } catch {
      setState('denied');
    }
  }, [startListening]);

  // Auto-start where no permission gate exists (Android/desktop), and always
  // detach on unmount so a backgrounded screen keeps no live sensor subscription.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      setState('unsupported');
      return undefined;
    }
    const api = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof api.requestPermission !== 'function') {
      startListening();
      // A device with no magnetometer simply never fires events — give it a
      // grace period, then report that instead of a frozen dial.
      const timer = window.setTimeout(() => {
        if (headingRef.current === null) setState('unsupported');
      }, 1500);
      return () => {
        window.clearTimeout(timer);
        stopListening();
      };
    }
    // iOS: idle until the button grants permission.
    return stopListening;
  }, [startListening, stopListening]);

  // One buzz when entering the aligned state — not on every sensor tick.
  useEffect(() => {
    if (heading === null) return;
    const aligned = Math.abs(angleDelta(heading, qiblaDirection)) <= ALIGN_TOLERANCE_DEG;
    if (aligned && !alignedRef.current) {
      try {
        navigator.vibrate?.(35);
      } catch {
        // Vibration is a nicety; some platforms refuse it.
      }
    }
    alignedRef.current = aligned;
  }, [heading, qiblaDirection]);

  /** How far between the two bars the wizard currently sits, 0–1. */
  const calibrationProgress = progressOf(tally);

  // The wizard closes itself the moment both bars are met — with the same one
  // buzz the aligned state gets, so the phone can confirm it at arm's length.
  useEffect(() => {
    if (calibration !== 'running' || !isCalibrated(tally)) return;
    calibrationRef.current = false;
    setCalibration('done');
    try {
      navigator.vibrate?.(35);
    } catch {
      // Vibration is a nicety; some platforms refuse it.
    }
  }, [calibration, tally]);

  const startCalibration = useCallback(() => {
    tallyRef.current = emptyTally();
    setTally(emptyTally());
    calibrationRef.current = true;
    setCalibration('running');
  }, []);

  const cancelCalibration = useCallback(() => {
    calibrationRef.current = false;
    tallyRef.current = emptyTally();
    setTally(emptyTally());
    setCalibration('idle');
  }, []);

  const aligned =
    heading !== null && Math.abs(angleDelta(heading, qiblaDirection)) <= ALIGN_TOLERANCE_DEG;
  const delta = heading !== null ? angleDelta(heading, qiblaDirection) : null;

  return (
    <Card className="p-5!">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">اتجاه القبلة</p>
          <p className="mt-1 text-2xl font-bold text-primary-800 dark:text-primary-100">
            {toArabicNumber(Math.round(qiblaDirection))}° من الشمال
          </p>
          {contextLabel && (
            <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{contextLabel}</p>
          )}
        </div>
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-gold-100 to-gold-200 dark:from-gold-900/30 dark:to-gold-900/50">
          <Compass size={26} className="text-gold-600 dark:text-gold-400" aria-hidden="true" />
        </div>
      </div>

      {state === 'idle' && (
        <button
          type="button"
          onClick={() => void requestPermission()}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <Compass size={17} aria-hidden="true" />
          تفعيل البوصلة الحية
        </button>
      )}

      {state === 'denied' && (
        <p className="mt-4 rounded-xl bg-error-50 px-3 py-2.5 text-sm text-error-700 dark:bg-error-900/20 dark:text-error-300">
          رُفض إذن البوصلة. فعّله من إعدادات المتصفح/التطبيق لاستخدام البوصلة الحية.
        </p>
      )}

      {state === 'unsupported' && (
        <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600 dark:bg-gray-800/40 dark:text-gray-300">
          {'جهازك لا يوفّر مستشعر اتجاه — وجّه أعلى هاتفك باتجاه '}
          {toArabicNumber(Math.round(qiblaDirection))}
          {'° من الشمال، أو اتبع الزاوية أعلاه.'}
        </p>
      )}

      {state === 'active' && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <div
            role="img"
            aria-label={
              heading === null
                ? 'بوصلة القبلة بانتظار بيانات المستشعر'
                : aligned
                  ? 'الهاتف في اتجاه القبلة'
                  : `فرق ${toArabicNumber(Math.abs(Math.round(delta ?? 0)))} درجة عن القبلة`
            }
            className={`relative h-52 w-52 select-none rounded-full border-4 transition-colors duration-300 ${
              aligned
                ? 'border-success-400 bg-success-50 shadow-[0_0_30px_rgba(16,185,129,0.35)] dark:border-success-500 dark:bg-success-900/20'
                : 'border-primary-200 bg-white shadow-lg dark:border-primary-700 dark:bg-primary-900/50'
            }`}
          >
            {/* Rotating cardinal ring — counter-rotates against the device heading. */}
            {heading !== null && (
              <div
                className="absolute inset-1"
                style={{ transform: `rotate(${-heading}deg)` }}
                aria-hidden="true"
              >
                {[
                  { label: 'ش', deg: 0, tone: 'text-error-500 font-bold' },
                  { label: 'ق', deg: 90, tone: 'text-gray-500 dark:text-gray-300 font-semibold' },
                  { label: 'ج', deg: 180, tone: 'text-gray-500 dark:text-gray-300 font-semibold' },
                  { label: 'غ', deg: 270, tone: 'text-gray-500 dark:text-gray-300 font-semibold' },
                ].map((cardinal) => (
                  <div
                    key={cardinal.label}
                    className="absolute inset-0 flex items-start justify-center pt-1"
                    style={{ transform: `rotate(${cardinal.deg}deg)` }}
                  >
                    <span className={`text-sm ${cardinal.tone}`}>{cardinal.label}</span>
                  </div>
                ))}
                {/* Tick marks every 30° for orientation. */}
                {Array.from({ length: 12 }, (_, i) => i * 30).map((deg) => (
                  <div
                    key={deg}
                    className="absolute inset-0 flex items-start justify-center pt-0.5"
                    style={{ transform: `rotate(${deg}deg)` }}
                  >
                    <span className="h-2 w-px bg-primary-300 dark:bg-primary-600" />
                  </div>
                ))}
              </div>
            )}

            {/* Qibla marker rides the ring at its own bearing. */}
            {heading !== null && (
              <div
                className="absolute inset-0 transition-transform duration-150 ease-out"
                style={{ transform: `rotate(${qiblaDirection - heading}deg)` }}
                aria-hidden="true"
              >
                <div className="absolute left-1/2 top-2 -translate-x-1/2">
                  {/* A small Kaaba-shaped marker: black cube, gold band. */}
                  <div className="relative h-7 w-7 rounded-[5px] border border-black/40 bg-primary-950 shadow-md">
                    <span className="absolute inset-x-0 top-2 h-1 bg-gold-400" />
                  </div>
                </div>
                {/* Line from centre to the marker. */}
                <div className="absolute left-1/2 top-9 h-14 w-0.5 -translate-x-1/2 bg-gold-400/70" />
              </div>
            )}

            {/* Fixed pointer: the top edge of the phone. */}
            <div
              className={`absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 border-x-[7px] border-t-[10px] border-x-transparent transition-colors ${
                aligned ? 'border-t-success-500' : 'border-t-primary-700 dark:border-t-primary-200'
              }`}
              aria-hidden="true"
            />

            {/* Centre readout. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
              {heading === null ? (
                <p className="px-6 text-center text-xs text-gray-400 dark:text-gray-500">
                  جارٍ انتظار المستشعر…
                </p>
              ) : aligned ? (
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-success-500 text-white shadow-lg">
                  <Check size={20} strokeWidth={3} aria-hidden="true" />
                </span>
              ) : (
                <>
                  <span className="text-2xl font-bold text-primary-800 dark:text-primary-100">
                    {toArabicNumber(Math.abs(Math.round(delta ?? 0)))}°
                  </span>
                  <span className="text-[0.6875rem] text-gray-500 dark:text-gray-400">
                    {delta !== null && delta > 0 ? 'ادر يمينًا' : 'ادر يسارًا'}
                  </span>
                </>
              )}
            </div>
          </div>

          <p
            aria-live="polite"
            className={`text-sm font-bold ${aligned ? 'text-success-600 dark:text-success-400' : 'text-gray-500 dark:text-gray-400'}`}
          >
            {aligned
              ? 'أنت في اتجاه القبلة'
              : heading === null
                ? 'حرّك هاتفك على شكل ٨ لمعايرة البوصلة'
                : `اتجاه الهاتف الآن ${toArabicNumber(Math.round(heading))}°`}
          </p>

          {calibration === 'done' && (
            <p
              role="status"
              className="rounded-xl bg-success-50 px-3 py-2 text-center text-xs font-bold text-success-700 dark:bg-success-900/20 dark:text-success-300"
            >
              اكتملت المعايرة — يمكنك توجيه الهاتف نحو القبلة الآن.
            </p>
          )}

          {calibration === 'running' ? (
            /* The wizard: the dial stays live behind it, so the motion being
               measured is the motion being watched. */
            <div className="w-full space-y-2.5" aria-live="polite">
              <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                حرّك الهاتف ببطء على شكل ٨ — ثلاث أو أربع دورات، ثم توقّف.
              </p>
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-primary-100 dark:bg-primary-800"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(calibrationProgress * 100)}
                aria-label="تقدّم المعايرة"
              >
                <div
                  className="h-full rounded-full bg-gold-400 transition-[width] duration-200"
                  style={{ width: `${Math.round(calibrationProgress * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[0.6875rem] text-gray-500 dark:text-gray-400">
                <span>
                  دُوران {toArabicNumber(Math.round(tally.sweptDeg))}° من{' '}
                  {toArabicNumber(CALIBRATION_TARGET_ROTATION_DEG)}°
                </span>
                <span>
                  اتجاهات {toArabicNumber(tally.bins.size)}/
                  {toArabicNumber(CALIBRATION_TARGET_BINS)}
                </span>
              </div>
              <button
                type="button"
                onClick={cancelCalibration}
                className="mx-auto flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-50 px-3 text-xs font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700"
              >
                <X size={13} aria-hidden="true" />
                إلغاء
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startCalibration}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-50 px-3 text-xs font-bold text-primary-700 hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700"
            >
              <RotateCcw size={13} aria-hidden="true" />
              {calibration === 'done' ? 'أعد المعايرة' : 'معايرة البوصلة'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
