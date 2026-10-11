import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AUDIO_RECITERS, loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { getSurah } from '@/data/surahs';
import { loadSurahAudio, type SurahAudioSource, type VerseTiming } from '@/utils/quranAudio';
import { isSurahEnd, type MushafPrefs, type VoiceScope } from '@/components/mushaf/readerConfig';

interface UseAyahVoiceOptions {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  setAyahChoice: (choice: { surahId: number; ayahNumber: number } | null) => void;
  showAyah: (surahId: number, ayahNumber: number) => void;
  updatePrefs: (patch: Partial<MushafPrefs>) => void;
  voiceScope: VoiceScope;
}

export function useAyahVoice({
  ayahChoice,
  setAyahChoice,
  showAyah,
  updatePrefs,
  voiceScope,
}: UseAyahVoiceOptions) {
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  const [voiceEngaged, setVoiceEngaged] = useState(false);
  const [voicePhase, setVoicePhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [voicePlaying, setVoicePlaying] = useState(false);
  /** Set when this ayah has run to its end: «متابعة» then means the one after it. */
  const [voiceDone, setVoiceDone] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  /** The surah's file, held once per reciter and read for every ayah in it. */
  const voiceSourceRef = useRef<{ surahId: number; source: SurahAudioSource } | null>(null);
  const voiceTimingRef = useRef<VerseTiming | null>(null);
  /** The blob URL's only handle — nothing else can release the file it maps to. */
  const voiceUrlRef = useRef<string | null>(null);
  const pauseVoice = useCallback(() => {
    voiceAudioRef.current?.pause();
    setVoicePlaying(false);
  }, []);

  /** The file is held only for as long as the ayah is being asked about. */
  const releaseVoice = useCallback(() => {
    if (voiceUrlRef.current) URL.revokeObjectURL(voiceUrlRef.current);
    voiceUrlRef.current = null;
    voiceSourceRef.current = null;
    voiceTimingRef.current = null;
  }, []);

  const closeAyahChoice = useCallback(() => {
    // The audio element leaves with the sheet, and an element no longer in the
    // document is not paused for us — stop it while it can still be reached.
    pauseVoice();
    releaseVoice();
    setAyahChoice(null);
  }, [pauseVoice, releaseVoice, setAyahChoice]);

  /**
   * One ayah at a time, out of the surah's own file: playback opens at the
   * millisecond this ayah opens and is cut at the millisecond the next one does.
   * A pause inside the ayah resumes where it stopped; a finished ayah, or a
   * deliberate replay, starts from the top of it.
   */
  const playAyahFrom = useCallback((source: SurahAudioSource, ayah: number, restart = false) => {
    const audio = voiceAudioRef.current;
    const timing = source.verseTimings.find((entry) => entry.ayah === ayah);
    if (!audio || !timing) {
      setVoicePhase('error');
      setVoiceError('لم يُعثر على تلاوة لهذه الآية داخل ملف السورة.');
      return;
    }
    voiceTimingRef.current = timing;
    if (audio.src !== source.url) audio.src = source.url;
    const start = timing.startMs / 1000;
    const end = timing.endMs / 1000;
    // A file that already ran out plays its last ayah again from that ayah, not
    // from the surah's beginning — `ended` outranks a stale position inside it.
    if (restart || audio.ended || audio.currentTime < start || audio.currentTime >= end) {
      audio.currentTime = start;
    }
    audio.play().catch(() => {
      setVoicePhase('error');
      setVoiceError('تعذّر تشغيل التلاوة — أعد المحاولة.');
    });
    setVoiceDone(false);
  }, []);

  /**
   * Get the surah's file, then play this ayah out of it. The reader's own reciter
   * starts from the first tap; one never heard before needs the network first, so
   * the transport says so instead of looking broken.
   */
  const startVoice = useCallback(
    (reciter = reciterId, ayahNumber?: number) => {
      if (!ayahChoice) return;
      // The recitation opens at the ayah being asked about — where the reader is
      // now, not back at the top — and the scope only says where it is to stop:
      // at this ayah's end, or at the surah's.
      const ayah = ayahNumber ?? ayahChoice.ayahNumber;
      const cached = voiceSourceRef.current;
      if (cached && cached.surahId === ayahChoice.surahId) {
        setVoicePhase('ready');
        playAyahFrom(cached.source, ayah);
        return;
      }
      const { surahId } = ayahChoice;
      setVoicePhase('loading');
      setVoiceError(null);
      void loadSurahAudio(reciter, surahId)
        .then((source) => {
          // The reader may have closed the sheet while the file was on its way.
          if (!voiceAudioRef.current) {
            if (source.blob) URL.revokeObjectURL(source.url);
            return;
          }
          releaseVoice();
          if (source.blob) voiceUrlRef.current = source.url;
          voiceSourceRef.current = { surahId, source };
          setVoicePhase('ready');
          playAyahFrom(source, ayah);
        })
        .catch((cause: unknown) => {
          setVoicePhase('error');
          setVoiceError(cause instanceof Error ? cause.message : 'تعذّر تجهيز التلاوة.');
        });
    },
    [ayahChoice, reciterId, playAyahFrom, releaseVoice],
  );

  /**
   * This ayah has had its full stretch: stop here, and offer what follows rather
   * than the same ayah a second time.
   */
  const finishVoice = useCallback(() => {
    voiceAudioRef.current?.pause();
    setVoicePlaying(false);
    setVoiceDone(true);
  }, []);

  /**
   * The recitation moves down one ayah without being asked. The boundary this ayah
   * ended on is the next one's, so the timing is replaced before React has committed
   * anything — the transport asks on the very next tick — and the sheet, the
   * highlight and the page follow the voice down the surah.
   */
  const advanceAyah = useCallback(
    (surahId: number, ayahNumber: number) => {
      const timing = voiceSourceRef.current?.source.verseTimings.find((entry) => entry.ayah === ayahNumber);
      if (timing) voiceTimingRef.current = timing;
      showAyah(surahId, ayahNumber);
    },
    [showAyah],
  );

  /**
   * The cut at the millisecond an ayah ends is where a one-ayah listen stops — and
   * where a whole-surah listen simply turns over: the next ayah of the file already
   * in hand takes over with nothing to fetch and nothing to press.
   */
  const handleVoiceTime = useCallback(() => {
    const audio = voiceAudioRef.current;
    const timing = voiceTimingRef.current;
    if (!audio || !timing) return;
    if (audio.currentTime < timing.endMs / 1000) return;
    const choice = ayahChoice;
    const surah = choice ? getSurah(choice.surahId) : undefined;
    if (voiceScope === 'surah' && choice && surah && choice.ayahNumber < surah.ayahCount) {
      advanceAyah(choice.surahId, choice.ayahNumber + 1);
      return;
    }
    finishVoice();
  }, [finishVoice, advanceAyah, ayahChoice, voiceScope]);

  /**
   * Carry on with the next ayah out of the file already in hand — no refetch, the
   * same recitation simply moves down one, taking the sheet, the highlight and the
   * printed page with it. A surah's last ayah has nothing after it, and says so.
   */
  const playNextAyah = useCallback(() => {
    const choice = ayahChoice;
    const surah = choice ? getSurah(choice.surahId) : undefined;
    if (!choice || !surah) return;
    const next = choice.ayahNumber + 1;
    if (next > surah.ayahCount) return;
    showAyah(choice.surahId, next);
    setVoiceDone(false);
    const cached = voiceSourceRef.current;
    if (cached && cached.surahId === choice.surahId) {
      playAyahFrom(cached.source, next);
      return;
    }
    startVoice(reciterId, next);
  }, [ayahChoice, showAyah, playAyahFrom, startVoice, reciterId]);

  /**
   * The whole surah from its opening ayah — «من الأول», offered only once a
   * whole-surah listen has run the full length of it. Getting there by hand is
   * simply pressing its first ayah.
   */
  const startSurah = useCallback(() => {
    const choice = ayahChoice;
    if (!choice) return;
    showAyah(choice.surahId, 1);
    startVoice(reciterId, 1);
  }, [ayahChoice, showAyah, startVoice, reciterId]);

  /**
   * One ayah, or the whole of it. The choice says only where the recitation is to
   * stop, so taking the whole surah carries on from the ayah the reader is on —
   * where they left off, rather than jumping back to the top — and leaves alone
   * whatever is already playing. It is kept: the reader need not choose again.
   */
  const handleVoiceScope = useCallback(
    (next: VoiceScope) => {
      if (next === voiceScope) return;
      updatePrefs({ scope: next });
    },
    [voiceScope, updatePrefs],
  );

  /**
   * Play or pause while it runs; once it has run out, the same button takes the
   * reader on — to the ayah after this one, or, where a whole-surah listen has
   * reached the end of its surah, back to the opening of it, which is why it
   * reads «من الأول» there.
   */
  const toggleVoice = useCallback(() => {
    if (voicePlaying) {
      pauseVoice();
      return;
    }
    if (voiceDone && isSurahEnd(ayahChoice)) {
      // The whole of it has been heard, and is offered again; a one-ayah listen
      // standing here has nothing after it, and its button is disabled anyway.
      if (voiceScope === 'surah') startSurah();
      return;
    }
    if (voiceDone) {
      // In the surah's scope that step is simply the next one, and it keeps going
      // from there to the end of the surah.
      playNextAyah();
      return;
    }
    const cached = voiceSourceRef.current;
    if (!cached) {
      startVoice(); // a first run, or a retry after an error
      return;
    }
    if (!ayahChoice) return;
    playAyahFrom(cached.source, ayahChoice.ayahNumber);
  }, [
    voicePlaying,
    voiceDone,
    voiceScope,
    pauseVoice,
    startSurah,
    playNextAyah,
    startVoice,
    ayahChoice,
    playAyahFrom,
  ]);

  const replayVoice = useCallback(() => {
    const cached = voiceSourceRef.current;
    if (!cached || !ayahChoice) return;
    playAyahFrom(cached.source, ayahChoice.ayahNumber, true);
  }, [ayahChoice, playAyahFrom]);

  /** The first tap opens the voice; every tap after it plays or pauses this ayah. */
  const openVoice = () => {
    if (voiceEngaged) {
      toggleVoice();
      return;
    }
    setVoiceEngaged(true);
    startVoice();
  };

  /** Mid-listen the reader switches voice: the same ayah is picked up in the new one. */
  const handleVoiceReciter = (nextReciterId: string) => {
    if (nextReciterId === reciterId) return;
    pauseVoice();
    releaseVoice();
    setReciterId(nextReciterId);
    savePreferredReciter(nextReciterId);
    // The new voice picks up the ayah being heard, not the top of the surah.
    startVoice(nextReciterId, ayahChoice?.ayahNumber);
  };

  /** A newly pressed ayah starts from silence: the transport is idle again. */
  const resetVoice = useCallback(() => {
    setVoiceEngaged(false);
    setVoicePhase('idle');
    setVoicePlaying(false);
    setVoiceDone(false);
    setVoiceError(null);
  }, []);

  // Leaving the reader while the ayah's voice is up must not leave the recitation
  // behind it: the element goes out of the document, and that alone never stops it.
  useLayoutEffect(() => () => void voiceAudioRef.current?.pause(), []);

  const voiceReciterName = AUDIO_RECITERS.find((reciter) => reciter.id === reciterId)?.name ?? '';
  /** Nothing follows the surah's own last ayah, so the transport stops offering it. */
  const atLastAyah = isSurahEnd(ayahChoice);
  const voicePrimaryLabel =
    voicePhase === 'loading'
      ? 'جارٍ التجهيز…'
      : voicePlaying
        ? 'إيقاف مؤقت'
        : voiceDone && atLastAyah
          ? voiceScope === 'surah'
            ? 'من الأول'
            : 'آخر آية'
          : voicePhase === 'ready'
            ? 'متابعة'
            : 'استماع';
  // A whole-surah listen that reached the end of its surah offers itself again,
  // which is what «من الأول» is for; a one-ayah one has nothing after the last.
  const voicePrimaryDisabled =
    voicePhase === 'loading' || (voiceDone && atLastAyah && voiceScope === 'ayah');
  /** What the block is telling the reader: what is being listened to, and what happens when it runs out. */
  const voiceScopeHint =
    voiceDone && voiceScope === 'surah' && atLastAyah
      ? 'انتهت السورة — «من الأول» تُشغّلها من أولها.'
      : voiceScope === 'surah'
        ? `تستمر التلاوة من حيث وقفت حتى آخر السورة بصوت ${voiceReciterName} — تتبع الصفحة مع التلاوة.`
        : voiceDone && !atLastAyah
          ? 'انتهت تلاوة الآية — «متابعة» تُشغّل التي تليها.'
          : `تُتلى الآية بصوت ${voiceReciterName} — بدّل القارئ متى شئت.`;
  const voiceHint = voiceEngaged
    ? voiceScopeHint
    : 'اختر ما تحتاجه لهذه الآية: تفسيرها، أو تلاوتها بالصوت الذي تفضله.';

  return {
    voiceEngaged,
    voicePhase,
    voiceError,
    voiceAudioRef,
    setVoicePlaying,
    reciterId,
    handleVoiceReciter,
    openVoice,
    replayVoice,
    handleVoiceScope,
    closeAyahChoice,
    resetVoice,
    finishVoice,
    handleVoiceTime,
    voicePrimaryLabel,
    voicePrimaryDisabled,
    voiceHint,
  };
}
