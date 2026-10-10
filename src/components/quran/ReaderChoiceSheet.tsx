import type { RefObject } from 'react';
import { BookOpen, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { toArabicNumber, type SurahMeta } from '@/data/surahs';

interface ReaderChoiceSheetProps {
  ayahChoice: number | null;
  setAyahChoice: (ayah: number | null) => void;
  selectedSurah: SurahMeta;
  setTafsirAyah: (target: { surahId: number; ayah: number } | null) => void;
  playAyah: (ayah: number) => void;
  ayahChoicePanelRef: RefObject<HTMLDivElement>;
}

export function ReaderChoiceSheet({
  ayahChoice,
  setAyahChoice,
  selectedSurah,
  setTafsirAyah,
  playAyah,
  ayahChoicePanelRef,
}: ReaderChoiceSheetProps) {
  return (
    <>
                {/* The reader's own question, put to this screen's ayahs: which is it
                    wanted for — its meaning, or its voice? Same sheet, same pair of
                    answers, same line of hint underneath them.

                    The host is `display: contents` because this screen sets its
                    vertical rhythm with `space-y`, which gives every later sibling a
                    full step of margin — and a fixed sheet caught in that rhythm would
                    hang a step below the bottom of the screen. The wrapper keeps the
                    sheet out of the rhythm without taking it out of this screen's tree,
                    where the tafsir still renders after it and so still wins the tie. */}
                <div className="contents">
                  {ayahChoice !== null && (
                    <Sheet
                      open
                      title={`الآية ${toArabicNumber(ayahChoice)} · ${selectedSurah.name}`}
                      onClose={() => setAyahChoice(null)}
                      panelRef={ayahChoicePanelRef}
                    >
                      <div className="mushaf-seg">
                        <button
                          className="mushaf-seg__item"
                          onClick={() => setTafsirAyah({ surahId: selectedSurah.id, ayah: ayahChoice })}
                        >
                          <BookOpen size={18} aria-hidden="true" />
                          <span>التفسير</span>
                        </button>
                        <button
                          className="mushaf-seg__item"
                          onClick={() => {
                            playAyah(ayahChoice);
                            setAyahChoice(null);
                          }}
                        >
                          <Volume2 size={18} aria-hidden="true" />
                          <span>التلاوة</span>
                        </button>
                      </div>
                      <p className="mushaf-hint">اختر ما تحتاجه لهذه الآية: تفسيرها، أو تلاوتها بالصوت الذي تفضله.</p>
                    </Sheet>
                  )}
                </div>
    </>
  );
}
