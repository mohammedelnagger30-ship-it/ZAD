import { useState, useEffect } from 'react';
import { BookMarked } from 'lucide-react';

interface ReaderAyahMarksProps {
  /** Whether the pressed ayah already sits in «محفوظاتي». */
  bookmarked: boolean;
  onToggleBookmark: () => void;
  /** The saved note for the ayah, if any. */
  note?: string;
  /** Saves the note; an empty string clears it. */
  onSaveNote: (note: string) => void;
}

/**
 * What the reader keeps of an ayah: the mark and the note that says why.
 *
 * This used to sit in a sheet of its own — `ReaderChoiceSheet` — which meant the
 * reader needed two windows on a pressed ayah, one of them carrying its own copy of
 * «التفسير / التلاوة» at the top. The ayah window is now the one the mushaf opens,
 * shared by both screens, and this is what the reader adds to it. Nothing here is a
 * second kind of mark: the note is a field on the same bookmark, and the ayah is kept
 * either way. The shared ayah sheet owns the colour picker.
 *
 * The host is a plain fragment because the window is a fixed sheet that lays its own
 * children out; it does not need a wrapper of its own to escape a spacing rhythm.
 */
export function ReaderAyahMarks({
  bookmarked,
  onToggleBookmark,
  note,
  onSaveNote,
}: ReaderAyahMarksProps) {
  const [draftNote, setDraftNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  // The note is re-seeded whenever the marks below it reload — the window is opened
  // per ayah, so a fresh ayah means a fresh draft, and an edit in progress is only
  // kept while nothing else has moved.
  useEffect(() => {
    setDraftNote(note ?? '');
    setNoteSaved(false);
  }, [note]);

  return (
    <div className="mt-3 space-y-3">
      {/* The mark itself. The answer shows in the button — the mark is already there
          to remove, so the label names what the press will do rather than what is. */}
      <button
        type="button"
        aria-pressed={bookmarked}
        onClick={onToggleBookmark}
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl border-2 px-4 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 ${
          bookmarked
            ? 'border-gold-300 bg-gold-50 text-gold-800 dark:border-gold-700 dark:bg-gold-900/30 dark:text-gold-200'
            : 'border-primary-200 bg-[var(--field)] text-primary-700 hover:border-primary-300 dark:border-primary-700 dark:text-primary-200 dark:hover:border-primary-600'
        }`}
      >
        <BookMarked size={16} aria-hidden="true" />
        <span>{bookmarked ? 'إزالة من المحفوظات' : 'حفظ الآية'}</span>
      </button>

      {/* Note — the reason for the mark, kept with it. Saving is explicit so a
          half-typed thought is never stored, and an emptied field clears whatever
          was there before. */}
      <div>
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
          className="w-full resize-none rounded-xl border border-primary-200 bg-[var(--field)] p-2.5 text-sm text-primary-900 placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:text-primary-50 dark:placeholder:text-gray-500"
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
    </div>
  );
}
