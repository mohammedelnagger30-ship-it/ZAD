import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { getAyah } from '@/data/quranText';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { type VoiceScope } from '@/components/mushaf/readerConfig';

export interface AyahVoicePanelProps {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  voiceWholeFile: boolean;
  voiceScope: VoiceScope;
  handleVoiceScope: (scope: VoiceScope) => void;
  reciterId: string;
  handleVoiceReciter: (reciterId: string) => void;
  replayVoice: () => void;
  /** The transport's main button: first tap opens the voice, later ones play or pause. */
  openVoice: () => void;
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
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '٠:٠٠';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${toArabicNumber(minutes)}:${toArabicNumber(remainder).padStart(2, '٠')}`;
}

/**
 * The recitation half of a pressed ayah: the ayah's own words, then the scope, the
 * reciter, the timeline, the transport, the speed and the repeat count.
 *
 * It used to live inside `AyahVoiceSheet` alone, which is why the reader screen had
 * to keep a second, always-visible panel of the same controls above its text: the
 * reader had no way to put a recitation *inside* an ayah's window, so it put one
 * outside it instead. The panel is now shared, and both screens ask for a recitation
 * the same way — by pressing the ayah.
 *
 * The `<audio>` element itself stays with whichever sheet draws this panel: it has to
 * exist from the moment an ayah is opened, not from the moment sound is asked for, so
 * that a play request never arrives at an element that is not there yet.
 */
export function AyahVoicePanel({
  ayahChoice,
  voiceWholeFile,
  voiceScope,
  handleVoiceScope,
  reciterId,
  handleVoiceReciter,
  replayVoice,
  openVoice,
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
}: AyahVoicePanelProps) {
  const ayahWords = ayahChoice
    ? getAyah(ayahChoice.surahId, ayahChoice.ayahNumber)?.text.split(' ') ?? []
    : [];

  return (
    <section className="mushaf-voice" aria-label="مشغل التلاوة">
      <div className="mushaf-voice__now-playing" aria-live="polite">
        <span className="mushaf-voice__track">
          <strong>تلاوة الآية {toArabicNumber(ayahChoice?.ayahNumber ?? 1)}</strong>
          <small>
            {getSurah(ayahChoice?.surahId ?? 1)?.name ?? ''} ·{' '}
            {AUDIO_RECITERS.find((reciter) => reciter.id === reciterId)?.name ?? ''}
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
              aria-label={`الآية ${toArabicNumber(ayahChoice?.ayahNumber ?? 1)}`}
            >
              {toArabicNumber(ayahChoice?.ayahNumber ?? 1)}
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
          style={
            {
              '--voice-progress': `${voiceTime.duration ? (voiceTime.current / voiceTime.duration) * 100 : 0}%`,
            } as CSSProperties
          }
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
        <button className="mushaf-voice__play" onClick={openVoice} disabled={voicePrimaryDisabled}>
          {voicePrimaryLabel === 'إيقاف مؤقت' ? (
            <Pause size={19} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={19} fill="currentColor" aria-hidden="true" />
          )}
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
  );
}
