import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_RECITERS, loadPreferredReciter, savePreferredReciter } from '@/data/audioReciters';
import { getSurah } from '@/data/surahs';
import { isSurahEnd, type MushafPrefs, type VoiceScope } from '@/components/mushaf/readerConfig';
import { useRecitation, useRecitationProgress } from '@/hooks/useRecitation';
import {
  ensureSource,
  pauseRecitation,
  playAyah,
  resumeAyah,
  seekTo,
  selectAyah,
  setContinuousPlayback,
  setTrack,
  updatePlaybackRate,
  updateRepeatCount,
} from '@/utils/recitationEngine';

interface UseAyahVoiceOptions {
  ayahChoice: { surahId: number; ayahNumber: number } | null;
  setAyahChoice: (choice: { surahId: number; ayahNumber: number } | null) => void;
  showAyah: (surahId: number, ayahNumber: number) => void;
  updatePrefs: (patch: Partial<MushafPrefs>) => void;
  voiceScope: VoiceScope;
}

/**
 * The ayah sheet and the app-wide player are two views of the same recitation.
 * The engine owns playback so the mini-player, Android notification and lock-screen
 * controls all stay in sync when a recitation starts in either Quran reader.
 */
export function useAyahVoice({
  ayahChoice,
  setAyahChoice,
  showAyah,
  updatePrefs,
  voiceScope,
}: UseAyahVoiceOptions) {
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  const [voiceEngaged, setVoiceEngaged] = useState(false);
  const [voiceStarted, setVoiceStarted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [repeatCount, setRepeatCount] = useState(1);
  const requestIdRef = useRef(0);
  const recitation = useRecitation();
  const progress = useRecitationProgress();

  const trackMatches = Boolean(
    ayahChoice &&
      recitation.surahId === ayahChoice.surahId &&
      recitation.reciterId === reciterId,
  );
  const voicePlaying = trackMatches && recitation.isPlaying;
  const voiceWholeFile = trackMatches && recitation.wholeFile;
  const voicePhase: 'idle' | 'loading' | 'ready' | 'error' = !voiceStarted
    ? 'idle'
    : !trackMatches || recitation.sourceLoading
      ? 'loading'
      : recitation.error
        ? 'error'
        : 'ready';
  const voiceError = trackMatches ? recitation.error : null;
  const voiceTime = {
    current: progress.positionMs / 1000,
    duration: progress.durationMs / 1000,
  };
  const voiceDone =
    voiceStarted &&
    trackMatches &&
    !recitation.sourceLoading &&
    !recitation.sessionOpen &&
    !recitation.isPlaying &&
    recitation.activeAyah === null;

  useEffect(() => {
    if (
      !voiceEngaged ||
      !voiceStarted ||
      !recitation.activeAyah ||
      recitation.activeAyah !== recitation.selectedAyah ||
      recitation.surahId === null
    ) return;
    showAyah(recitation.surahId, recitation.activeAyah);
  }, [
    voiceEngaged,
    voiceStarted,
    recitation.surahId,
    recitation.activeAyah,
    recitation.selectedAyah,
    showAyah,
  ]);

  const startVoice = useCallback(
    (scope: VoiceScope = voiceScope, nextReciterId = reciterId, ayahNumber?: number) => {
      if (!ayahChoice) return;
      const surah = getSurah(ayahChoice.surahId);
      if (!surah) return;

      const ayah = Math.min(surah.ayahCount, Math.max(1, ayahNumber ?? ayahChoice.ayahNumber));
      const requestId = ++requestIdRef.current;
      setVoiceEngaged(true);
      setVoiceStarted(true);
      if (scope !== voiceScope) updatePrefs({ scope });

      setTrack({
        surahId: surah.id,
        surahName: surah.name,
        reciterId: nextReciterId,
      });
      selectAyah(ayah);
      updatePlaybackRate(playbackRate);
      updateRepeatCount(repeatCount);

      void ensureSource().then((source) => {
        if (requestId !== requestIdRef.current || !source) return;
        playAyah(ayah, scope === 'surah');
      });
    },
    [ayahChoice, reciterId, repeatCount, updatePrefs, playbackRate, voiceScope],
  );

  /**
   * The first tap opens the recitation choices. Once a choice is made, this control
   * resumes or pauses the shared session rather than creating a second audio player.
   */
  const openVoice = useCallback(() => {
    if (!voiceEngaged) {
      setVoiceEngaged(true);
      return;
    }
    if (voicePlaying) {
      pauseRecitation();
      return;
    }
    if (voiceDone && ayahChoice) {
      const nextAyah = ayahChoice.ayahNumber + 1;
      if (voiceScope === 'surah' && isSurahEnd(ayahChoice)) {
        startVoice('surah', reciterId, 1);
      } else if (voiceScope === 'ayah' && !isSurahEnd(ayahChoice)) {
        startVoice('ayah', reciterId, nextAyah);
      }
      return;
    }
    if (voiceStarted) {
      void resumeAyah(voiceScope === 'surah');
    }
  }, [voiceEngaged, voicePlaying, voiceDone, ayahChoice, voiceScope, reciterId, startVoice, voiceStarted]);

  const replayVoice = useCallback(() => {
    if (ayahChoice) startVoice(voiceScope, reciterId, ayahChoice.ayahNumber);
  }, [ayahChoice, reciterId, startVoice, voiceScope]);

  const handleVoiceScope = useCallback(
    (next: VoiceScope) => {
      if (next === voiceScope) return;
      updatePrefs({ scope: next });
      if (voiceStarted && trackMatches) {
        setContinuousPlayback(next === 'surah');
      }
    },
    [trackMatches, updatePrefs, voiceScope, voiceStarted],
  );

  const handleVoiceReciter = useCallback(
    (nextReciterId: string) => {
      if (nextReciterId === reciterId) return;
      setReciterId(nextReciterId);
      savePreferredReciter(nextReciterId);
      if (voiceStarted && ayahChoice) {
        startVoice(voiceScope, nextReciterId, ayahChoice.ayahNumber);
      }
    },
    [ayahChoice, reciterId, startVoice, voiceScope, voiceStarted],
  );

  const closeAyahChoice = useCallback(() => {
    requestIdRef.current += 1;
    setVoiceEngaged(false);
    setVoiceStarted(false);
    setAyahChoice(null);
  }, [setAyahChoice]);

  const resetVoice = useCallback(() => {
    requestIdRef.current += 1;
    setVoiceEngaged(false);
    setVoiceStarted(false);
  }, []);

  const handleVoiceRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    updatePlaybackRate(rate);
  }, []);

  const handleRepeatCount = useCallback((count: number) => {
    setRepeatCount(count);
    updateRepeatCount(count);
  }, []);

  const seekVoice = useCallback((current: number) => {
    seekTo(current * 1000);
  }, []);

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
          : voiceDone
            ? 'متابعة'
            : voicePhase === 'ready'
              ? 'متابعة'
              : 'استماع';
  const voicePrimaryDisabled =
    voicePhase === 'loading' || (voiceDone && atLastAyah && voiceScope === 'ayah');
  const reciterName = AUDIO_RECITERS.find((item) => item.id === reciterId)?.name ?? '';
  const voiceHint = !voiceEngaged
    ? 'اضغط «التلاوة» لاختيار سماع الآية وحدها أو السورة كاملة.'
    : !voiceStarted
      ? 'اختر نطاق التلاوة: الآية المحددة فقط أو السورة كاملة من موضع القراءة.'
      : voiceWholeFile
        ? `تسجيل السورة بصوت ${reciterName} ملف واحد، وسيظهر في مشغل التطبيق وإشعار الهاتف.`
        : voiceDone && voiceScope === 'surah' && atLastAyah
          ? 'انتهت السورة — «من الأول» يعيد تشغيلها كاملة.'
          : voiceScope === 'surah'
            ? `تستمر التلاوة من موضعك حتى نهاية السورة بصوت ${reciterName}.`
            : voiceDone && !atLastAyah
              ? 'انتهت الآية — «متابعة» تشغّل الآية التالية.'
              : `تُتلى الآية المحددة بصوت ${reciterName}.`;

  return {
    voiceEngaged,
    voiceWholeFile,
    voicePhase,
    voiceError,
    voiceTime,
    playbackRate,
    repeatCount,
    reciterId,
    handleVoiceReciter,
    openVoice,
    startVoice,
    replayVoice,
    handleVoiceScope,
    closeAyahChoice,
    resetVoice,
    handleVoiceRate,
    handleRepeatCount,
    seekVoice,
    voicePrimaryLabel,
    voicePrimaryDisabled,
    voiceHint,
    voicePlaying,
  };
}
