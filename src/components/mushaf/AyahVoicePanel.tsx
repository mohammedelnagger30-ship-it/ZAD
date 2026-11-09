import type { CSSProperties } from 'react';
import { Pause, Play, RotateCcw, SkipForward, Music2 } from 'lucide-react';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { getAyah } from '@/data/quranText';
import { type VoiceScope } from '@/components/mushaf/readerConfig';

export interface AyahVoicePanelProps {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  voiceWholeFile: boolean;
  voiceScope: VoiceScope;
  handleVoiceScope: (scope: VoiceScope) => void;
  reciterId: string;
  handleVoiceReciter: (reciterId: string) => void;
  replayVoice: () => void;
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
  followedAyah: { surahId: number; ayahNumber: number } | null;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '٠:٠٠';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${toArabicNumber(minutes)}:${toArabicNumber(remainder).padStart(2, '٠')}`;
}

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
  followedAyah,
}: AyahVoicePanelProps) {
  const surah = getSurah(ayahChoice?.surahId ?? 1);
  const reciter = AUDIO_RECITERS.find((r) => r.id === reciterId);
  const currentAyahNumber = followedAyah?.ayahNumber ?? ayahChoice?.ayahNumber ?? 1;

  let currentAyahText: string | null = null;
  if (surah && currentAyahNumber >= 1 && currentAyahNumber <= surah.ayahCount) {
    const ayah = getAyah(ayahChoice?.surahId ?? 1, currentAyahNumber);
    currentAyahText = ayah?.text ?? null;
  }

  const isFollowingDifferentAyah =
    followedAyah && ayahChoice &&
    (followedAyah.surahId !== ayahChoice.surahId ||
      followedAyah.ayahNumber !== ayahChoice.ayahNumber);

  const modeLabel = voiceWholeFile ? 'سورة كاملة' : 'آية واحدة';

  return (
    <section className="mushaf-voice" aria-label="مشغل التلاوة">
      <div className="mushaf-voice__header">
        <div className="mushaf-voice__icon">
          <Music2 size={20} aria-hidden="true" />
        </div>
        <div className="mushaf-voice__info">
          <div className="mushaf-voice__surah">{surah?.name ?? ''}</div>
          <div className="mushaf-voice__ayah-row">
            <span className="mushaf-voice__ayah-label">الآية</span>
            <span className="mushaf-voice__ayah-number">{toArabicNumber(currentAyahNumber)}</span>
            {isFollowingDifferentAyah && (
              <span className="mushaf-voice__follow-badge">متابعة</span>
            )}
          </div>
        </div>
        <div className="mushaf-voice__mode-badge">
          <span className="mushaf-voice__mode-label">{modeLabel}</span>
        </div>
        <div className={`mushaf-voice__status${voicePhase === 'loading' ? ' is-loading' : ''}`}>
          {voicePhase === 'loading'
            ? 'جارٍ التحضير…'
            : voicePhase === 'error'
              ? 'تعذّر التشغيل'
              : 'تلاوة'}
        </div>
      </div>

      {voiceError && (
        <p className="mushaf-hint" role="alert">{voiceError}</p>
      )}

      {currentAyahText && !voiceWholeFile && (
        <div className="mushaf-voice__ayah-card">
          <div className="mushaf-verse">{currentAyahText}</div>
          <div className="mushaf-verse-meta">
            سورة {surah?.name} · الآية {toArabicNumber(currentAyahNumber)}
          </div>
        </div>
      )}

      <div className="mushaf-voice__reciter-row">
        <span className="mushaf-voice__reciter-label">القارئ</span>
        <span className="mushaf-voice__reciter-value">{reciter?.name ?? ''}</span>
      </div>

      {!voiceWholeFile && (
        <div className="mushaf-seg mushaf-voice__scope" role="group" aria-label="نطاق التلاوة">
          <button
            className={`mushaf-seg__item${voiceScope === 'ayah' ? ' mushaf-seg__item--active' : ''}`}
            aria-pressed={voiceScope === 'ayah'}
            onClick={() => handleVoiceScope('ayah')}
          >
            <span>الآية</span>
          </button>
          <button
            className={`mushaf-seg__item${voiceScope === 'surah' ? ' mushaf-seg__item--active' : ''}`}
            aria-pressed={voiceScope === 'surah'}
            onClick={() => handleVoiceScope('surah')}
          >
            <span>السورة</span>
          </button>
        </div>
      )}

      <label className="mushaf-voice__reciter-select">
        <span>اختر القارئ</span>
        <select
          className="mushaf-select"
          value={reciterId}
          onChange={(event) => handleVoiceReciter(event.target.value)}
        >
          {AUDIO_RECITERS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
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
          {voicePrimaryLabel === 'إيقاف مؤقت' ? (
            <Pause size={20} fill="currentColor" aria-hidden="true" />
          ) : (
            <Play size={20} fill="currentColor" aria-hidden="true" />
          )}
          <span>{voicePrimaryLabel}</span>
        </button>
        {!voiceWholeFile && surah && currentAyahNumber < surah.ayahCount && (
          <button
            className="mushaf-voice__next"
            onClick={() => {}}
            disabled={voicePrimaryDisabled}
            aria-label="الآية التالية"
          >
            <SkipForward size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mushaf-voice__settings-grid">
        <label className="mushaf-voice__setting">
          <span>السرعة</span>
          <select
            className="mushaf-select"
            value={playbackRate}
            onChange={(event) => handleVoiceRate(Number(event.target.value))}
          >
            <option value={0.75}>٠٫٧٥×</option>
            <option value={1}>١×</option>
            <option value={1.25}>١٫٢٥×</option>
            <option value={1.5}>١٫٥×</option>
          </select>
        </label>
        {!voiceWholeFile && (
          <label className="mushaf-voice__setting">
            <span>التكرار</span>
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
        )}
      </div>

      {voiceWholeFile && (
        <p className="mushaf-hint">
          هذا التسجيل للسورة كاملة ولا يحتوي توقيتًا منفصلًا للآيات؛ يُشغَّل من أول السورة إلى آخرها.
        </p>
      )}
      {!voiceWholeFile && repeatCount > 1 && (
        <p className="mushaf-voice__repeat-note">
          سيُشغّل مقطع الآية {toArabicNumber(repeatCount)} مرات إجمالاً
          {voiceScope === 'surah' ? ' ثم ينتقل للآية التالية.' : ' ثم يتوقف.'}
        </p>
      )}
    </section>
  );
}
