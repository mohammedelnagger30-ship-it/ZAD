import { useState, useCallback, useRef } from 'react';
import { Volume2, VolumeX, Play, ArrowLeft, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, Button } from '@/components/ui';
import { IQAMAH_SOUNDS, iqamahPlayUrl, iqamahSoundAttribution } from '@/data/iqamahSound';
import type { Settings } from '@/db/database';

export interface IqamahScreenProps {
  settings: Settings;
  onSaveSettings: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function IqamahScreen({ settings, onSaveSettings, onClose }: IqamahScreenProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playPreview = useCallback((soundId: string) => {
    const url = iqamahPlayUrl(soundId);
    if (playingId === soundId && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.addEventListener('ended', () => setPlayingId(null));
    audio.play().catch(() => setPlayingId(null));
    setPlayingId(soundId);
  }, [playingId]);

  

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 md:p-6 gap-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="h-10 w-10 p-0"
          aria-label="العودة"
        >
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h1 className="text-xl md:text-2xl font-bold">صفحة الإقامة</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            اختيار صوت الإقامة وضبط سلوك صفحة الجماعة
          </p>
        </div>
      </div>

      {/* Sound Picker */}
      <section aria-labelledby="sound-heading">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-bold">صوت الإقامة</span>
          <Volume2 size={18} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {IQAMAH_SOUNDS.map((sound) => (
            <Card
              key={sound.id}
              className={`relative flex flex-col items-stretch p-4 transition-all ${
                settings.iqamahSoundId === sound.id
                  ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-950/50'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-base">{sound.name}</h3>
                {settings.iqamahSoundId === sound.id && (
                  <CheckCircle2 size={18} className="text-primary-500" aria-hidden="true" />
                )}
              </div>

              <div className="flex items-center gap-2 mb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 min-h-[40px]"
                  onClick={() => playPreview(sound.id)}
                  aria-label={playingId === sound.id ? 'إيقاف المعاينة' : `معاينة ${sound.name}`}
                  disabled={playingId !== null && playingId !== sound.id}
                >
                  {playingId === sound.id ? (
                    <VolumeX size={16} className="mx-auto" />
                  ) : (
                    <Play size={16} className="mx-auto" />
                  )}
                </Button>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 flex-1">
                {iqamahSoundAttribution(sound.id)}
              </p>

              <Button
                variant={settings.iqamahSoundId === sound.id ? 'primary' : 'ghost'}
                size="sm"
                className="w-full min-h-[40px]"
                onClick={() => onSaveSettings({ iqamahSoundId: sound.id })}
              >
                {settings.iqamahSoundId === sound.id ? 'مُختار' : 'اختيار'}
              </Button>

              {sound.sourceUrl && (
                <a
                  href={sound.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  <ExternalLink size={10} /> المصدر
                </a>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Master Switch */}
      <section aria-labelledby="master-heading">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-bold">تشغيل صوت الإقامة</span>
          <Volume2 size={18} />
        </div>
        <Card className="p-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="font-medium">تفعيل صوت الإقامة عند وقت الجماعة</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                يُشغَّل صوت الإقامة المختار أعلاه عند دخول وقت الجماعة، بعد الأذان بفترة يحددها المسجد
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.iqamahSound}
              onChange={(e) => onSaveSettings({ iqamahSound: e.target.checked })}
              className="h-5 w-5 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
          </label>
        </Card>
      </section>

      {/* Info about the automatic page */}
      <section aria-labelledby="info-heading">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg font-bold">صفحة الإقامة التلقائية</span>
          <Volume2 size={18} />
        </div>
        <Card className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800">
          <div className="space-y-3 text-sm text-emerald-900 dark:text-emerald-100">
            <p>
              <strong>عند دخول وقت الجماعة:</strong> ستفتح هذه الصفحة تلقائيًا بصوت الإقامة المختار.
            </p>
            <p>
              <strong>على الهاتف:</strong> صفحة كاملة تظهر فوق القفل، وتشتغل بصوت الإقامة (وليس الأذان).
            </p>
            <p>
              <strong>بدون إنترنت:</strong> الأصوات مضمّنة في التطبيق وتعمل فورًا.
            </p>
          </div>
        </Card>
      </section>
    </div>
  );
}