import { useState, useEffect, type RefObject } from 'react';
import { BookMarked, BookOpen, Volume2 } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { toArabicNumber, type SurahMeta } from '@/data/surahs';
import { HIGHLIGHT_COLORS } from '@/utils/ayahHighlights';

interface ReaderChoiceSheetProps {
  ayahChoice: number | null;
  setAyahChoice: (ayah: number | null) => void;
  selectedSurah: SurahMeta;
  setTafsirAyah: (target: { surahId: number; ayah: number } | null) => void;
  playAyah: (ayah: number) => void;
  /** Whether the pressed ayah already sits in «محفوظاتي». */
  bookmarked: boolean;
  onToggleBookmark: () => void;
  /** Highlight colour id currently on the ayah, or undefined. */
  highlightColor?: string;
  /** Sets the highlight colour, or clears it with `null`. */
  onPickColor: (colorId: string | null) => void;
  /** The saved note for the ayah, if any. */
  note?: string;
  /** Saves the note; an empty string clears it. */
  onSaveNote: (note: string) => void;
  ayahChoicePanelRef: RefObject<HTMLDivElement>;
}

export function ReaderChoiceSheet({
  ayahChoice,
  setAyahChoice,
  selectedSurah,
  setTafsirAyah,
  playAyah,
  bookmarked,
  onToggleBookmark,
  highlightColor,
  onPickColor,
  note,
  onSaveNote,
  ayahChoicePanelRef,
}: ReaderChoiceSheetProps) {
  const [draftNote, setDraftNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  // Re-seed the draft only when a *different* ayah opens. Depending on `note`
  // too would wipe an in-progress edit every time a bookmark reload lands.
  useEffect(() => {
    setDraftNote(note ?? '');
    setNoteSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ayahChoice]);

  return (
    <>
                {/* The reader's own question, put to this screen's ayahs: which is it
                    wanted for — its meaning, its voice, or keeping it?

                    The third answer matters because the first two are not the only thing
                    a reader wants from an ayah. Marking used to exist in one place only,
                    in memorising, where pressing a line does it; so a reader who wanted
                    an ayah back later had no way to ask for it, and «محفوظاتي» held only
                    what memorising had left there. Holding is now asked here too, and the
                    answer shows in the button — the mark is already there to remove.

                    Below it sits the rest of what a mark can carry: a colour, so a writer
                    can tell one kind of marked ayah from another at a glance, and a note,
                    so the reason for the mark survives with it. Both are fields on the
                    same bookmark, not a second kind of mark — the ayah is kept either way.

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
                      <div className="mushaf-seg mushaf-seg--three">
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
                        <button
                          className="mushaf-seg__item"
                          aria-pressed={bookmarked}
                          onClick={() => {
                            onToggleBookmark();
                            setAyahChoice(null);
                          }}
                        >
                          <BookMarked size={18} aria-hidden="true" />
                          <span>{bookmarked ? 'إزالة' : 'حفظ'}</span>
                        </button>
                      </div>

                      {/* Highlight — the colour a kept ayah wears. Choosing one
                          keeps the ayah if it was not already kept, and choosing
                          the active colour again (or «بلا لون») drops back to the
                          plain bookmark wash without losing the mark. */}
                      <div className="mt-3">
                        <p className="mb-1.5 text-xs font-semibold text-primary-700 dark:text-gold-300">
                          تمييز بلون
                        </p>
                        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="لون التمييز">
                          {HIGHLIGHT_COLORS.map((c) => {
                            const active = highlightColor === c.id;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => onPickColor(active ? null : c.id)}
                                aria-pressed={active}
                                aria-label={`تمييز بلون ${c.labelAr}`}
                                title={c.labelAr}
                                className={`h-8 w-8 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                                  active
                                    ? 'scale-110 border-primary-700 dark:border-gold-300'
                                    : 'border-white/70 dark:border-black/40'
                                }`}
                                style={{ background: c.swatch }}
                              />
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => onPickColor(null)}
                            className="min-h-8 rounded-full border border-primary-200 px-3 text-xs font-bold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:text-primary-100 dark:hover:bg-primary-800/50"
                          >
                            بلا لون
                          </button>
                        </div>
                      </div>

                      {/* Note — the reason for the mark, kept with it. Saving is
                          explicit so a half-typed thought is never stored, and an
                          emptied field clears whatever was there before. */}
                      <div className="mt-3">
                        <label
                          htmlFor="ayah-note"
                          className="mb-1.5 block text-xs font-semibold text-primary-700 dark:text-gold-300"
                        >
                          ملاحظة
                        </label>
                        <textarea
                          id="ayah-note"
                          value={draftNote}
                          onChange={(event) => {
                            setDraftNote(event.target.value);
                            setNoteSaved(false);
                          }}
                          rows={2}
                          placeholder="اكتب تدبرًا أو تذكيرًا لهذه الآية..."
                          className="w-full resize-none rounded-xl border border-primary-200 bg-white p-2.5 text-sm text-primary-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:bg-primary-900/50 dark:text-primary-50 dark:placeholder:text-gray-500"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            onSaveNote(draftNote);
                            setNoteSaved(true);
                          }}
                          className="mt-1.5 inline-flex min-h-9 items-center rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400"
                        >
                          {noteSaved ? 'تم الحفظ' : 'حفظ الملاحظة'}
                        </button>
                      </div>

                      <p className="mushaf-hint">
                        اختر ما تحتاجه لهذه الآية: تفسيرها، تلاوتها، الاحتفاظ بها، أو تمييزها بلون وملاحظة.
                      </p>
                    </Sheet>
                  )}
                </div>
    </>
  );
}
