import type { RefObject } from 'react';
import { BookOpen, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { AUDIO_RECITERS } from '@/data/audioReciters';
import { type VoiceScope } from '@/components/mushaf/readerConfig';

interface AyahVoiceSheetProps {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  closeAyahChoice: () => void;
  ayahPanelRef: RefObject<HTMLDivElement>;
  setTafsirAyah: (ayah: { surahId: number; ayahNumber: number } | null) => void;
  openVoice: () => void;
  voiceEngaged: boolean;
  voiceHint: string;
  voiceScope: VoiceScope;
  handleVoiceScope: (scope: VoiceScope) => void;
  reciterId: string;
  handleVoiceReciter: (reciterId: string) => void;
  replayVoice: () => void;
  voicePhase: 'idle' | 'loading' | 'ready' | 'error';
  voicePrimaryDisabled: boolean;
  voicePrimaryLabel: string;
  voiceError: string | null;
  voiceAudioRef: RefObject<HTMLAudioElement>;
  setVoicePlaying: (playing: boolean) => void;
  handleVoiceTime: () => void;
  finishVoice: () => void;
}

export function AyahVoiceSheet({
  ayahChoice,
  closeAyahChoice,
  ayahPanelRef,
  setTafsirAyah,
  openVoice,
  voiceEngaged,
  voiceHint,
  voiceScope,
  handleVoiceScope,
  reciterId,
  handleVoiceReciter,
  replayVoice,
  voicePhase,
  voicePrimaryDisabled,
  voicePrimaryLabel,
  voiceError,
  voiceAudioRef,
  setVoicePlaying,
  handleVoiceTime,
  finishVoice,
}: AyahVoiceSheetProps) {
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
          <p className="mushaf-hint">{voiceHint}</p>

          {voiceEngaged && (
            <div className="mushaf-voice">
              <div className="mushaf-seg" role="group" aria-label="نطاق التلاوة">
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

              <div className="mushaf-tools">
                <button
                  className="mushaf-tool"
                  onClick={replayVoice}
                  disabled={voicePhase !== 'ready'}
                >
                  إعادة
                </button>
                <button
                  className="mushaf-tool mushaf-tool--primary"
                  onClick={openVoice}
                  disabled={voicePrimaryDisabled}
                >
                  {voicePrimaryLabel}
                </button>
              </div>

              {voicePhase === 'error' && voiceError && (
                <p className="mushaf-hint" role="alert">
                  {voiceError}
                </p>
              )}
            </div>
          )}

          {/* Outside the choice on purpose: whichever button is taken, the element
              the recitation plays through already exists to be aimed at. Playing is
              the element's own word, not the click's: a seek, a stall or a system
              pause all move the transport without the code asking for it. The end
              event is the cut's backstop — the last ayah of a file reaches it
              before a final timeupdate can report that it stopped. */}
          <audio
            ref={voiceAudioRef}
            preload="auto"
            onPlay={() => setVoicePlaying(true)}
            onPause={() => setVoicePlaying(false)}
            onTimeUpdate={handleVoiceTime}
            onEnded={finishVoice}
          />
        </Sheet>
      )}
    </>
  );
}
