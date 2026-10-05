import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Pause, Play, Square, Volume2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import type { SurahMeta } from '@/data/surahs';
import { loadSurahAudio, type SurahAudioSource } from '@/utils/quranAudio';
import { toArabicNumber } from '@/data/surahs';

export interface AyahPlaybackControls {
  selectedAyah: number | null;
  activeAyah: number | null;
  isPlaying: boolean;
  selectAyah: (ayah: number) => void;
  playSelectedAyah: () => void;
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
  const requestRef = useRef(0);
  const verseEndRef = useRef<number | null>(null);
  const repeatRemainingRef = useRef(1);
  const sourceUrlRef = useRef<string | null>(null);
  const [requestId, setRequestId] = useState(0);
  const [activeAyah, setActiveAyah] = useState<number | null>(null);
  const [selectedAyah, setSelectedAyah] = useState<number | null>(1);
  const [repeatCount, setRepeatCount] = useState(3);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SurahAudioSource | null>(null);
  const [sourceLoading, setSourceLoading] = useState(true);

  const selectAyah = useCallback((ayah: number) => {
    if (activeAyahRef.current !== null) {
      requestRef.current += 1;
      audioRef.current?.pause();
      activeAyahRef.current = null;
      continuousRef.current = false;
      setActiveAyah(null);
      setIsPlaying(false);
    }
    setSelectedAyah(ayah);
  }, []);

  const playAyah = useCallback((ayah: number, continuous = false) => {
    activeAyahRef.current = ayah;
    continuousRef.current = continuous;
    verseEndRef.current = null;
    setSelectedAyah(ayah);
    setActiveAyah(ayah);
    setError(null);
    requestRef.current += 1;
    setRequestId(requestRef.current);
  }, []);

  const startSelectedAyah = useCallback(() => {
    if (selectedAyah === null) return;
    const audio = audioRef.current;
    if (activeAyahRef.current !== selectedAyah || !audio) {
      repeatRemainingRef.current = repeatCount;
      playAyah(selectedAyah, false);
      return;
    }
    if (audio.paused) {
      void audio.play().then(
        () => setIsPlaying(true),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة'),
      );
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [playAyah, repeatCount, selectedAyah]);

  const updateRepeatCount = (count: number) => {
    setRepeatCount(count);
    if (activeAyahRef.current !== null && !continuousRef.current) {
      repeatRemainingRef.current = count;
    }
  };

  const stop = useCallback(() => {
    requestRef.current += 1;
    activeAyahRef.current = null;
    continuousRef.current = false;
    repeatRemainingRef.current = 1;
    audioRef.current?.pause();
    setActiveAyah(null);
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setSource(null);
    setSourceLoading(true);
    setError(null);
    setIsPlaying(false);
    setActiveAyah(null);
    activeAyahRef.current = null;
    continuousRef.current = false;
    void loadSurahAudio(reciterId, surah.id, controller.signal)
      .then((nextSource) => {
        if (active) {
          if (sourceUrlRef.current?.startsWith('blob:')) URL.revokeObjectURL(sourceUrlRef.current);
          sourceUrlRef.current = nextSource.blob ? nextSource.url : null;
          setSource(nextSource);
        } else if (nextSource.blob) {
          URL.revokeObjectURL(nextSource.url);
        }
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof Error && cause.name === 'AbortError')) {
          setError(cause instanceof Error ? cause.message : 'تعذّر تجهيز التلاوة');
        }
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [reciterId, surah.id]);

  useEffect(() => {
    if (activeAyah === null || requestId === 0 || !source) return;
    const audio = audioRef.current;
    if (!audio) return;
    const request = requestId;
    let cancelled = false;
    const controller = new AbortController();

    const startPlayback = async () => {
      try {
        const timing = source.verseTimings.find((item) => item.ayah === activeAyah);
        if (!timing) throw new Error(`توقيت الآية ${activeAyah} غير متاح`);
        if (audio.src !== source.url) {
          audio.src = source.url;
          await new Promise<void>((resolve, reject) => {
            const onLoaded = () => {
              audio.removeEventListener('loadedmetadata', onLoaded);
              audio.removeEventListener('error', onError);
              resolve();
            };
            const onError = () => {
              audio.removeEventListener('loadedmetadata', onLoaded);
              audio.removeEventListener('error', onError);
              reject(new Error('تعذّر تحميل ملف التلاوة'));
            };
            const onAbort = () => {
              audio.removeEventListener('loadedmetadata', onLoaded);
              audio.removeEventListener('error', onError);
              reject(new DOMException('تم إلغاء تحميل بيانات الصوت', 'AbortError'));
            };
            audio.addEventListener('loadedmetadata', onLoaded, { once: true });
            audio.addEventListener('error', onError, { once: true });
            controller.signal.addEventListener('abort', onAbort, { once: true });
            if (audio.readyState >= 1) onLoaded();
          });
        }
        if (cancelled || requestRef.current !== request) return;
        audio.currentTime = timing.startMs / 1000;
        verseEndRef.current = timing.endMs / 1000;
        await audio.play();
        if (!cancelled && requestRef.current === request) setIsPlaying(true);
      } catch (cause) {
        if (!cancelled && requestRef.current === request) {
          setIsPlaying(false);
          setError(cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة');
        }
      }
    };

    void startPlayback();
    return () => {
      cancelled = true;
      controller.abort();
      audio.pause();
    };
  }, [activeAyah, requestId, source]);

  useEffect(() => () => {
    audioRef.current?.pause();
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  const finishAyah = () => {
    const current = activeAyahRef.current;
    verseEndRef.current = null;
    if (!continuousRef.current && current !== null) {
      if (repeatRemainingRef.current === 0 || repeatRemainingRef.current > 1) {
        if (repeatRemainingRef.current > 1) repeatRemainingRef.current -= 1;
        playAyah(current, false);
        return;
      }
    }
    if (continuousRef.current && current !== null && current < surah.ayahCount) {
      repeatRemainingRef.current = 1;
      playAyah(current + 1, true);
      return;
    }
    activeAyahRef.current = null;
    continuousRef.current = false;
    setActiveAyah(null);
    setIsPlaying(false);
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (audio && verseEndRef.current !== null && audio.currentTime >= verseEndRef.current) {
      audio.pause();
      finishAyah();
    }
  };

  const toggleSurah = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setIsPlaying(false);
    } else if (activeAyah !== null) {
      continuousRef.current = true;
      repeatRemainingRef.current = 1;
      void audio.play().then(
        () => setIsPlaying(true),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : 'تعذّر تشغيل التلاوة'),
      );
    } else {
      repeatRemainingRef.current = 1;
      playAyah(1, true);
    }
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
                <option key={reciter.id} value={reciter.id}>{reciter.name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSurah}
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
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {isPlaying ? 'تُتلى الآن' : 'متوقف مؤقتاً'} — الآية {toArabicNumber(activeAyah)}
            </p>
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
                onClick={startSelectedAyah}
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
      <audio ref={audioRef} preload="metadata" onEnded={finishAyah} onTimeUpdate={handleTimeUpdate} />
      {children({ activeAyah, isPlaying, selectedAyah, selectAyah, playSelectedAyah: startSelectedAyah })}
    </>
  );
}
