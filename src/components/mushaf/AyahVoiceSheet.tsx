import type { CSSProperties, RefObject } from 'react';
import { BookOpen, Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { getAyah } from '@/data/quranText';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { type VoiceScope } from '@/components/mushaf/readerConfig';

interface AyahVoiceSheetProps {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  closeAyahChoice: () => void;
  ayahPanelRef: RefObject<HTMLDivElement>;
  setTafsirAyah: (ayah: { surahId: number; ayahNumber: number } | null) => void;
  openVoice: () => void;
  voiceEngaged: boolean;
  voiceWholeFile: boolean;
  voiceHint: string;
  voiceScope: VoiceScope;
  handleVoiceScope: (scope: VoiceScope) => void;
  reciterId: string;
  handleVoiceReciter: (reciterId: string) => void;
  replayVoice: () => void;
  voicePhase: 'idle' | 'loading' | 'ready' | 'error';
  voiceTime: { current: number; duration: number };
  playbackRate: number;
  repeatCount: number;
  handleVoiceRate: (rate: number) => void;
  handleRepeatCount: (count: number) => void;
  seekVoice: (current: number) => void;
  voicePrimaryDisabled: boolean;
  voicePrimaryLabel: string;
  voiceError: string | null;
  voiceAudioRef: RefObject<HTMLAudioElement>;
  setVoicePlaying: (playing: boolean) => void;
  handleVoiceTime: () => void;
  handleVoiceEnded: () => void;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '٠:٠٠';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${toArabicNumber(minutes)}:${toArabicNumber(remainder).padStart(2, '٠')}`;
}

export function AyahVoiceSheet({
  ayahChoice,
  closeAyahChoice,
  ayahPanelRef,
  setTafsirAyah,
  openVoice,
  voiceEngaged,
  voiceWholeFile,
  voiceHint,
  voiceScope,
  handleVoiceScope,
  reciterId,
  handleVoiceReciter,
  replayVoice,
  voicePhase,
  voiceTime,
  playbackRate,
  repeatCount,
  handleVoiceRate,
  handleRepeatCount,
  seekVoice,
  voicePrimaryDisabled,
  voicePrimaryLabel,
  voiceError,
  voiceAudioRef,
  setVoicePlaying,
  handleVoiceTime,
  handleVoiceEnded,
}: AyahVoiceSheetProps) {
  const ayahWords = ayahChoice
    ? getAyah(ayahChoice.surahId, ayahChoice.ayahNumber)?.text.split(' ') ?? []
    : [];

  return (
    <>
      {/* ── The pressed ayah: what it is needed for ───────────────────────── */}
      {ayahChoice && (
        <Sheet
          open
          title={`الآية ${toArabicNumber(ayahChoice.ayahNumber)} · ${getSurah(ayahChoice.surahId)?.name ?? ''}`}
          onClose={closeAyahChoice}
          panelRef={ayahPanelRef}
        >
          <div className="mushaf-seg">
            <button className="mushaf-seg__item" onClick={() => setTafsirAyah(ayahChoice)}>
              <BookOpen size={18} aria-hidden="true" />
              <span>التفسير</span>
            </button>
            <button className="mushaf-seg__item" aria-pressed={voiceEngaged} onClick={openVoice}>
              <Volume2 size={18} aria-hidden="true" />
              <span>التلاوة</span>
            </button>
          </div>
          {!voiceEngaged && <p className="mushaf-hint">{voiceHint}</p>}

          {voiceEngaged && (
            <section className="mushaf-voice" aria-label="مشغل التلاوة">
              <div className="mushaf-voice__now-playing" aria-live="polite">
                <span className="mushaf-voice__track">
                  <strong>تلاوة الآية {toArabicNumber(ayahChoice.ayahNumber)}</strong>
                  <small>
                    {getSurah(ayahChoice.surahId)?.name ?? ''} · {AUDIO_RECITERS.find((reciter) => reciter.id === reciterId)?.name ?? ''}
                  </small>
                </span>
                <span className={`mushaf-voice__status${voicePhase === 'loading' ? ' is-loading' : ''}`}>
                  {voicePhase === 'loading' ? 'جارٍ التحضير' : voicePhase === 'error' ? 'تعذّر التشغيل' : 'تلاوة'}
                </span>
              </div>

              <p className="mushaf-body mushaf-voice__ayah" dir="rtl">
                {ayahWords.slice(0, -1).map((word, index) => (
                  <span key={index}>{word} </span>
                ))}
                {ayahWords.length > 0 && (
                  <span className="mushaf-ayah-tail">
                    {ayahWords[ayahWords.length - 1]}
                    <span
                      className="mushaf-ayah-mark"
                      role="img"
                      aria-label={`الآية ${toArabicNumber(ayahChoice.ayahNumber)}`}
                    >
                      {toArabicNumber(ayahChoice.ayahNumber)}
                    </span>
                  </span>
                )}
              </p>

              {!voiceWholeFile && (
                <div className="mushaf-seg mushaf-voice__scope" role="group" aria-label="نطاق التلاوة">
                  <button
                    className="mushaf-seg__item"
                    aria-pressed={voiceScope === 'ayah'}
                    onClick={() => handleVoiceScope('ayah')}
                  >
                    <span>الآية</span>
                  </button>
                  <button
                    className="mushaf-seg__item"
                    aria-pressed={voiceScope === 'surah'}
                    onClick={() => handleVoiceScope('surah')}
                  >
                    <span>السورة</span>
                  </button>
                </div>
              )}

              <label className="mushaf-voice__reciter">
                <span>القارئ</span>
                <select
                  className="mushaf-select"
                  value={reciterId}
                  onChange={(event) => handleVoiceReciter(event.target.value)}
                >
                  {AUDIO_RECITERS.map((reciter) => (
                    <option key={reciter.id} value={reciter.id}>
                      {reciter.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mushaf-voice__timeline">
                <input
                  className="mushaf-voice__seek"
                  type="range"
                  min={0}
                  max={voiceTime.duration || 0}
                  step={0.1}
                  value={Math.min(voiceTime.current, voiceTime.duration || 0)}
                  onChange={(event) => seekVoice(Number(event.target.value))}
                  disabled={voicePhase !== 'ready' || voiceTime.duration === 0}
                  aria-label="موضع التلاوة"
                  style={{
                    '--voice-progress': `${voiceTime.duration ? (voiceTime.current / voiceTime.duration) * 100 : 0}%`,
                  } as CSSProperties}
                />
                <div className="mushaf-voice__time" aria-live="off">
                  <span>{formatTime(voiceTime.current)}</span>
                  <span>{formatTime(voiceTime.duration)}</span>
                </div>
              </div>

              <div className="mushaf-voice__transport">
                <button
                  className="mushaf-voice__replay"
                  onClick={replayVoice}
                  disabled={voicePhase !== 'ready'}
                  aria-label="إعادة الآية"
                  title="إعادة الآية"
                >
                  <RotateCcw size={18} aria-hidden="true" />
                </button>
                <button
                  className="mushaf-voice__play"
                  onClick={openVoice}
                  disabled={voicePrimaryDisabled}
                >
                  {voicePrimaryLabel === 'إيقاف مؤقت'
                    ? <Pause size={19} fill="currentColor" aria-hidden="true" />
                    : <Play size={19} fill="currentColor" aria-hidden="true" />}
                  <span>{voicePrimaryLabel}</span>
                </button>
                <span className="mushaf-voice__transport-spacer" aria-hidden="true" />
              </div>

              <div className="mushaf-voice__settings">
                <label>
                  <span>سرعة التلاوة</span>
                  <select
                    className="mushaf-select"
                    value={playbackRate}
                    onChange={(event) => handleVoiceRate(Number(event.target.value))}
                  >
                    <option value={0.75}>بطيئة · ٠٫٧٥×</option>
                    <option value={1}>عادية · ١×</option>
                    <option value={1.25}>أسرع · ١٫٢٥×</option>
                    <option value={1.5}>سريعة · ١٫٥×</option>
                  </select>
                </label>
                <label>
                  <span>إجمالي مرات تشغيل الآية</span>
                  <select
                    className="mushaf-select"
                    value={repeatCount}
                    onChange={(event) => handleRepeatCount(Number(event.target.value))}
                    disabled={voiceWholeFile}
                  >
                    <option value={1}>مرة واحدة</option>
                    <option value={2}>مرتان</option>
                    <option value={3}>٣ مرات</option>
                    <option value={5}>٥ مرات</option>
                    <option value={10}>١٠ مرات</option>
                  </select>
                </label>
              </div>

              {voiceWholeFile && (
                <p className="mushaf-hint">
                  هذا التسجيل للسورة كاملة ولا يحتوي توقيتًا منفصلًا للآيات؛ لذلك لا يتاح تكرار الآية أو التنقل داخلها.
                </p>
              )}
              {!voiceWholeFile && repeatCount > 1 && (
                <p className="mushaf-voice__repeat-note">
                  سيُشغّل مقطع الآية {toArabicNumber(repeatCount)} مرات إجمالًا
                  {voiceScope === 'surah' ? ' ثم ينتقل للآية التالية.' : ' ثم يتوقف.'}
                </p>
              )}
              {voicePhase === 'error' && voiceError && (
                <p className="mushaf-hint" role="alert">
                  {voiceError}
                </p>
              )}
            </section>
          )}

          {/* Outside the choice on purpose: whichever button is taken, the element
              the recitation plays through already exists to be aimed at. Playing is
              the element's own word, not the click's: a seek, a stall or a system
              pause all move the transport without the code asking for it. The end
              event is the cut's backstop — the last ayah of a file reaches it
              before a final timeupdate can report that it stopped.

              `handleVoiceTime` is wrapped rather than passed for a reason of its
              own: React hands every handler its event as the first argument, and
              that handler reads its first argument as «the ayah has run out».
              Passed bare, every tick of playback looked like an ending — a
              one-ayah listen stopped on its first timeupdate, and a whole-surah
              one leapt an ayah per tick. The event is of no interest here; the
              element's own currentTime is. */}
          <audio
            ref={voiceAudioRef}
            preload="auto"
            onPlay={() => setVoicePlaying(true)}
            onPause={() => setVoicePlaying(false)}
            onTimeUpdate={() => handleVoiceTime()}
            onEnded={handleVoiceEnded}
          />
        </Sheet>
      )}
    </>
  );
}
