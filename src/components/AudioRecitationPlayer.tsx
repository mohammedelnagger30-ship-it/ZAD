import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Pause, Play, RotateCcw, Square, Volume2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import type { SurahMeta } from '@/data/surahs';
import { loadSurahAudio, type SurahAudioSource, type VerseTiming } from '@/utils/quranAudio';
import { toArabicNumber } from '@/data/surahs';

export interface AyahPlaybackControls {
  selectedAyah: number | null;
  activeAyah: number | null;
  isPlaying: boolean;
  selectAyah: (ayah: number) => void;
  playSelectedAyah: () => void;
  /** Take up any ayah of the surah and hear it from where it stands. */
  playAyah: (ayah: number) => void;
}

interface AudioRecitationPlayerProps {
  surah: SurahMeta;
  reciterId: string;
  onReciterChange: (reciterId: string) => void;
  onShowTafsir: (ayah: number) => void;
  children: (controls: AyahPlaybackControls) => ReactNode;
}

export function AudioRecitationPlayer({
  surah,
  reciterId,
  onReciterChange,
  onShowTafsir,
  children,
}: AudioRecitationPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeAyahRef = useRef<number | null>(null);
  const continuousRef = useRef(false);
  const verseEndRef = useRef<number | null>(null);
  const repeatRemainingRef = useRef(1);
  const sourceUrlRef = useRef<string | null>(null);
  const currentTimingRef = useRef<VerseTiming | null>(null);

  // The prepared audio lives in a ref, not state: playback is driven from event
  // handlers whose closures would otherwise still see the old (not-yet-loaded)
  // value on the very first press after loading finishes.
  const sourceRef = useRef<SurahAudioSource | null>(null);
  const loadInFlightRef = useRef<Promise<SurahAudioSource | null> | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);

  const [activeAyah, setActiveAyah] = useState<number | null>(null);
  const [selectedAyah, setSelectedAyah] = useState<number | null>(1);
  const [repeatCount, setRepeatCount] = useState(3);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Nothing is being fetched until sound is actually asked for.
  const [sourceLoading, setSourceLoading] = useState(false);

  // Stop playback completely
  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    activeAyahRef.current = null;
    continuousRef.current = false;
    verseEndRef.current = null;
    currentTimingRef.current = null;
    repeatRemainingRef.current = 1;
    setActiveAyah(null);
    setIsPlaying(false);
  }, []);

  // Select an Ayah without playing
  const selectAyah = useCallback((ayah: number) => {
    setSelectedAyah(ayah);
  }, []);

  /**
   * Fetch the surah's recitation on first request.
   *
   * The old version loaded it the moment a surah was opened: every opened surah
   * downloaded the whole recitation, and offline that landed a red
   * «تعذّر تجهيز التلاوة» banner on a reader who had only come to read. Deferred,
   * the fetch happens behind «جار تجهيز التلاوة...» and a failure can only appear
   * after the person pressed play themselves.
   */
  const ensureSource = useCallback((): Promise<SurahAudioSource | null> => {
    if (sourceRef.current) return Promise.resolve(sourceRef.current);
    if (loadInFlightRef.current) return loadInFlightRef.current;

    const controller = new AbortController();
    loadControllerRef.current = controller;
    setSourceLoading(true);

    const load = (async (): Promise<SurahAudioSource | null> => {
      try {
        const nextSource = await loadSurahAudio(reciterId, surah.id, controller.signal);
        if (controller.signal.aborted || loadControllerRef.current !== controller) {
          // The surah or reciter changed while this fetch was running.
          if (nextSource.blob) URL.revokeObjectURL(nextSource.url);
          return null;
        }
        if (sourceUrlRef.current?.startsWith('blob:')) {
          URL.revokeObjectURL(sourceUrlRef.current);
        }
        sourceUrlRef.current = nextSource.blob ? nextSource.url : null;
        sourceRef.current = nextSource;
        setError(null);
        return nextSource;
      } catch (cause: unknown) {
        if (!(cause instanceof Error && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'تعذّر تجهيز التلاوة');
        }
        return null;
      } finally {
        // Only the load that still owns the slot may release it: a reciter/surah
        // change aborts this controller and starts the next load, whose slot this
        // stale finally must not clear.
        if (loadControllerRef.current === controller) {
          loadControllerRef.current = null;
          loadInFlightRef.current = null;
          setSourceLoading(false);
        }
      }
    })();

    loadInFlightRef.current = load;
    return load;
  }, [reciterId, surah.id]);

  // Core function to start or seek playback to a specific Ayah
  const playAyah = useCallback(
    (ayah: number, continuous = false) => {
      const prepared = sourceRef.current;
      const audio = audioRef.current;
      if (!prepared || !audio) return;

      const timing = prepared.verseTimings.find((item) => item.ayah === ayah);
      if (!timing) {
        setError(`توقيت الآية ${ayah} غير متاح`);
        return;
      }

      setError(null);
      activeAyahRef.current = ayah;
      continuousRef.current = continuous;
      currentTimingRef.current = timing;
      setSelectedAyah(ayah);
      setActiveAyah(ayah);

      // In single-ayah repeat mode, record the end time for looping/stopping
      if (!continuous) {
        verseEndRef.current = timing.endMs / 1000;
      } else {
        verseEndRef.current = null;
      }

      // Ensure audio source URL is set
      if (audio.src !== prepared.url) {
        audio.src = prepared.url;
      }

      audio.currentTime = timing.startMs / 1000;
      audio.playbackRate = playbackRate;

      audio
        .play()
        .then(() => {
          setIsPlaying(true);
        })
        .catch((cause: unknown) => {
          setIsPlaying(false);
          setError(cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة');
        });
    },
    [playbackRate]
  );

  /** Prepare the audio if needed, then hand over to `playAyah`; null aborts silently. */
  const playAyahEnsured = useCallback(
    async (ayah: number, continuous = false): Promise<void> => {
      const prepared = await ensureSource();
      if (!prepared) return;
      playAyah(ayah, continuous);
    },
    [ensureSource, playAyah]
  );

  const startSelectedAyah = useCallback(async () => {
    if (selectedAyah === null) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (activeAyahRef.current === selectedAyah && isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    const prepared = await ensureSource();
    if (!prepared) return;
    repeatRemainingRef.current = repeatCount;
    playAyah(selectedAyah, false);
  }, [ensureSource, playAyah, repeatCount, selectedAyah, isPlaying]);

  const updateRepeatCount = (count: number) => {
    setRepeatCount(count);
    repeatRemainingRef.current = count;
  };

  const replayAyah = useCallback(async () => {
    const ayah = activeAyahRef.current ?? selectedAyah;
    if (ayah === null) return;
    const prepared = await ensureSource();
    if (!prepared) return;
    repeatRemainingRef.current = repeatCount;
    playAyah(ayah, false);
  }, [ensureSource, playAyah, repeatCount, selectedAyah]);

  const updatePlaybackRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  };

  // Leaving a surah/reciter stops playback, forgets its prepared audio and aborts
  // any fetch still running for it; the object URL goes with the change.
  useEffect(() => {
    loadControllerRef.current?.abort();
    loadControllerRef.current = null;
    loadInFlightRef.current = null;
    sourceRef.current = null;
    stop();
    setError(null);
    setSourceLoading(false);

    return () => {
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      loadInFlightRef.current = null;
      sourceRef.current = null;
      stop();
      if (sourceUrlRef.current?.startsWith('blob:')) {
        URL.revokeObjectURL(sourceUrlRef.current);
      }
      sourceUrlRef.current = null;
    };
  }, [reciterId, surah.id, stop]);

  // Clean up object URLs on unmount (the effect above covers surah changes; this
  // covers the component itself being removed while the source is idle).
  useEffect(() => () => {
    if (sourceUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(sourceUrlRef.current);
    }
    sourceUrlRef.current = null;
  }, []);

  // Seamless real-time timeupdate handler
  const handleTimeUpdate = () => {
    const prepared = sourceRef.current;
    const audio = audioRef.current;
    if (!audio || !prepared) return;

    const currentMs = audio.currentTime * 1000;

    // 1. Continuous Surah Playback mode (Seamless stream, no pauses between verses!)
    if (continuousRef.current) {
      const currentVerse = prepared.verseTimings.find(
        (v) => currentMs >= v.startMs && currentMs < v.endMs
      );

      if (currentVerse && currentVerse.ayah !== activeAyahRef.current) {
        activeAyahRef.current = currentVerse.ayah;
        setActiveAyah(currentVerse.ayah);
        setSelectedAyah(currentVerse.ayah);
      }

      // Check if we've reached the end of the last verse
      const lastVerse = prepared.verseTimings[prepared.verseTimings.length - 1];
      if (currentMs >= lastVerse.endMs) {
        stop();
      }
      return;
    }

    // 2. Single Ayah repeat mode.
    //
    // `repeatRemainingRef` counts the plays left; 0 is the «مستمر» option and means
    // "no end in sight" — loop the ayah until stopped. The old `> 1` treated 0 as
    // "no plays left", so «مستمر» played exactly once and stopped at the verse end.
    if (verseEndRef.current !== null && audio.currentTime >= verseEndRef.current) {
      const remaining = repeatRemainingRef.current;
      if (remaining === 0 || remaining > 1) {
        if (remaining > 1) repeatRemainingRef.current = remaining - 1;
        if (currentTimingRef.current) {
          audio.currentTime = currentTimingRef.current.startMs / 1000;
        }
      } else {
        stop();
      }
    }
  };

  const handleEnded = () => {
    const prepared = sourceRef.current;
    // Only stop if we're not in continuous mode or if we've truly reached the end
    // In continuous mode, the audio should play until the end of the surah
    if (!continuousRef.current) {
      stop();
    } else if (prepared) {
      // In continuous mode, stop playback only if we've reached the last verse
      if (activeAyahRef.current === prepared.verseTimings[prepared.verseTimings.length - 1].ayah) {
        stop();
      } else {
        // If playback ended unexpectedly in continuous mode, try to continue
        // This handles cases where the audio file might have buffering issues
        const nextAyah = activeAyahRef.current ? activeAyahRef.current + 1 : 1;
        if (nextAyah <= prepared.verseTimings.length) {
          playAyah(nextAyah, true);
        } else {
          stop();
        }
      }
    } else {
      stop();
    }
  };

  const toggleSurah = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (activeAyahRef.current !== null && continuousRef.current) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
      return;
    }

    const prepared = await ensureSource();
    if (!prepared) return;
    repeatRemainingRef.current = 1;
    playAyah(selectedAyah || 1, true);
  };

  return (
    <>
      <Card className="bg-primary-50 dark:bg-primary-900/30">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Volume2 size={19} className="text-primary-600 dark:text-gold-400" />
            <h3 className="font-bold text-primary-800 dark:text-primary-100">تلاوة صوتية</h3>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600 dark:text-gray-300">القارئ</span>
            <select
              value={reciterId}
              onChange={(event) => onReciterChange(event.target.value)}
              className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
            >
              {AUDIO_RECITERS.map((reciter) => (
                <option key={reciter.id} value={reciter.id}>
                  {reciter.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-gray-600 dark:text-gray-300">سرعة التلاوة</span>
            <select
              value={playbackRate}
              onChange={(event) => updatePlaybackRate(Number(event.target.value))}
              className="w-full rounded-xl border border-primary-200 bg-white px-3 py-2.5 text-sm text-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-100"
            >
              <option value={0.75}>بطيئة — ٠٫٧٥×</option>
              <option value={1}>عادية — ١×</option>
              <option value={1.25}>أسرع قليلًا — ١٫٢٥×</option>
              <option value={1.5}>سريعة — ١٫٥×</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void toggleSurah()}
              disabled={sourceLoading}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              {sourceLoading
                ? 'جار تجهيز التلاوة...'
                : isPlaying
                  ? 'إيقاف مؤقت'
                  : activeAyah
                    ? 'متابعة التلاوة'
                    : 'تشغيل السورة كاملة'}
            </button>
            {activeAyah !== null && (
              <button
                onClick={stop}
                title="إيقاف التلاوة"
                aria-label="إيقاف التلاوة"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white text-gray-600 hover:bg-gray-100 dark:bg-primary-800 dark:text-gray-200 dark:hover:bg-primary-700"
              >
                <Square size={17} />
              </button>
            )}
          </div>
          {activeAyah !== null && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {isPlaying ? 'تُتلى الآن' : 'متوقف مؤقتاً'} — الآية {toArabicNumber(activeAyah)}
              </p>
              <button
                onClick={() => void replayAyah()}
                disabled={sourceLoading}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 disabled:opacity-50 dark:text-gold-300 dark:hover:bg-primary-800"
              >
                <RotateCcw size={14} /> إعادة الآية
              </button>
            </div>
          )}
          <div className="space-y-2 rounded-xl border border-primary-100 bg-white/80 p-3 dark:border-primary-800 dark:bg-primary-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">
                {selectedAyah === null
                  ? 'اختر آية من المصحف'
                  : `الآية المحددة: ${toArabicNumber(selectedAyah)}`}
              </p>
              {selectedAyah !== null && (
                <button
                  onClick={() => onShowTafsir(selectedAyah)}
                  className="min-h-9 rounded-lg px-3 text-xs font-semibold text-primary-700 hover:bg-primary-50 dark:text-gold-300 dark:hover:bg-primary-800"
                >
                  التفسير
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">تكرار الآية:</span>
              {[
                { value: 1, label: 'مرة' },
                { value: 3, label: '٣ مرات' },
                { value: 5, label: '٥ مرات' },
                { value: 10, label: '١٠ مرات' },
                { value: 0, label: 'مستمر' },
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateRepeatCount(option.value)}
                  aria-pressed={repeatCount === option.value}
                  className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                    repeatCount === option.value
                      ? 'bg-gold-500 text-white'
                      : 'bg-primary-50 text-primary-700 hover:bg-primary-100 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
              <button
                onClick={() => void startSelectedAyah()}
                disabled={selectedAyah === null || sourceLoading}
                className="mr-auto inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {activeAyah === selectedAyah && isPlaying ? <Pause size={15} /> : <Play size={15} />}
                {activeAyah === selectedAyah && isPlaying ? 'إيقاف مؤقت' : 'استمع للآية'}
              </button>
            </div>
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-xs text-error-600 dark:text-error-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      </Card>
      <audio
        ref={audioRef}
        preload="auto"
        onEnded={handleEnded}
        onTimeUpdate={handleTimeUpdate}
        onError={() => {
          const prepared = sourceRef.current;
          if (continuousRef.current && isPlaying && prepared) {
            // Try to recover from errors in continuous mode
            const nextAyah = activeAyahRef.current ? activeAyahRef.current + 1 : 1;
            if (nextAyah <= prepared.verseTimings.length) {
              playAyah(nextAyah, true);
            } else {
              stop();
            }
          }
        }}
      />
      {children({
        activeAyah,
        isPlaying,
        selectedAyah,
        selectAyah,
        playSelectedAyah: () => void startSelectedAyah(),
        playAyah: (ayah: number) => void playAyahEnsured(ayah),
      })}
    </>
  );
}
