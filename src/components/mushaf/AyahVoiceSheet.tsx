import type { ReactNode, RefObject } from 'react';
import { BookOpen, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { type VoiceScope } from '@/components/mushaf/readerConfig';
import { AyahVoicePanel } from '@/components/mushaf/AyahVoicePanel';

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
  /**
   * Anything else this screen keeps with an ayah, drawn under the recitation.
   *
   * The reader holds marks — a bookmark, a colour, a note — and used to keep them in
   * a sheet of its own, which meant the reader needed a second window with its own
   * copy of «التفسير / التلاوة» at the top of it. One window with a place for the
   * extras is the same screen everywhere: the mushaf passes nothing, the reader passes
   * its marks, and a reader who moves between the two meets the same ayah every time.
   */
  extra?: ReactNode;
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
  extra,
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
          {!voiceEngaged && <p className="mushaf-hint">{voiceHint}</p>}

          {voiceEngaged && (
            <AyahVoicePanel
              ayahChoice={ayahChoice}
              voiceWholeFile={voiceWholeFile}
              voiceScope={voiceScope}
              handleVoiceScope={handleVoiceScope}
              reciterId={reciterId}
              handleVoiceReciter={handleVoiceReciter}
              replayVoice={replayVoice}
              openVoice={openVoice}
              voicePhase={voicePhase}
              voiceTime={voiceTime}
              playbackRate={playbackRate}
              repeatCount={repeatCount}
              handleVoiceRate={handleVoiceRate}
              handleRepeatCount={handleRepeatCount}
              seekVoice={seekVoice}
              voicePrimaryDisabled={voicePrimaryDisabled}
              voicePrimaryLabel={voicePrimaryLabel}
              voiceError={voiceError}
            />
          )}

          {extra}

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
