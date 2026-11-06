import type { ReactNode, RefObject } from 'react';
import { BookOpen, BookOpenCheck, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { getAyahs } from '@/data/quranText';
import { type VoiceScope } from '@/components/mushaf/readerConfig';
import { AyahVoicePanel } from '@/components/mushaf/AyahVoicePanel';

interface AyahVoiceSheetProps {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  closeAyahChoice: () => void;
  ayahPanelRef: RefObject<HTMLDivElement>;
  setTafsirAyah: (ayah: { surahId: number; ayahNumber: number } | null) => void;
  openVoice: () => void;
  startVoice: (scope: VoiceScope) => void;
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
  startVoice,
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
  extra,
}: AyahVoiceSheetProps) {
  const selectedAyah = ayahChoice
    ? getAyahs(ayahChoice.surahId, ayahChoice.ayahNumber, ayahChoice.ayahNumber)[0]
    : undefined;

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
          {selectedAyah && (
            <p className="mushaf-body mushaf-voice__ayah" dir="rtl">
              {selectedAyah.text}
            </p>
          )}
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

          {voiceEngaged && voicePhase === 'idle' && (
            <div className="space-y-2.5" aria-label="اختيار نطاق التلاوة">
              <p className="mushaf-hint">{voiceHint}</p>
              <div className="mushaf-seg" role="group" aria-label="اختر ما تريد الاستماع إليه">
                <button
                  className="mushaf-seg__item"
                  aria-pressed={voiceScope === 'ayah'}
                  onClick={() => startVoice('ayah')}
                >
                  <Volume2 size={18} aria-hidden="true" />
                  <span>تلاوة الآية</span>
                </button>
                <button
                  className="mushaf-seg__item"
                  aria-pressed={voiceScope === 'surah'}
                  onClick={() => startVoice('surah')}
                >
                  <BookOpenCheck size={18} aria-hidden="true" />
                  <span>السورة كاملة</span>
                </button>
              </div>
            </div>
          )}

          {voiceEngaged && voicePhase !== 'idle' && (
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
        </Sheet>
      )}
    </>
  );
}
