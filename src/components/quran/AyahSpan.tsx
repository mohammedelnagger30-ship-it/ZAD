import { useCallback, useEffect, useRef } from 'react';
import { toArabicNumber } from '@/data/surahs';
import { highlightWash } from '@/utils/ayahHighlights';
import type { AyahText } from '@/data/quranText';

interface AyahSpanProps {
  ayah: AyahText;
  isHifz: boolean;
  bookmarked: boolean;
  /** Highlight colour id when the ayah is marked with a colour, else undefined. */
  color?: string;
  hideText: boolean;
  hideWordByWord: boolean;
  selected: boolean;
  activeAudio: boolean;
  /**
   * Which words of this ayah carry a gloss, keyed `${surahId}:${ayahNumber}`.
   *
   * The reader marks them the same way the mushaf page does — colour and a dotted
   * rule — and for the same reason: a word worth pressing is worth seeing before it
   * is pressed. The gloss itself is not printed here either; it lives behind the press.
   */
  meaningWords?: ReadonlyMap<string, ReadonlySet<number>>;
  onToggleBookmark: () => void;
  onShowTafsir: () => void;
  /** Which of the ayah is wanted: open the reader's «التفسير / التلاوة» question. */
  onShowChoice: () => void;
  /**
   * A word carrying a gloss has been pressed. `wordPosition` is one-based, as every
   * word lookup in the app is.
   */
  onWordPress?: (surahId: number, ayahNumber: number, word: string, wordPosition: number) => void;
}

/**
 * One ayah plus its number marker, built the way the reader's page builds it: a plain
 * text span with the medallion sitting straight against the ayah's last word. No button
 * and no control wrapper comes between them, so the line never breaks in that gap — the
 * number stays glued to its ayah instead of being stranded at the start of the next line.
 *
 * Tap opens the ayah's own window — its recitation, its tafsir, and in the reader
 * the marks kept on it; in memorising mode the same press marks the line as well,
 * since marking is what that mode is for. Long-press (touch) or right-click always
 * opens the tafsir directly, which is the shortest way to it in hifz mode.
 */
export function AyahSpan({
  ayah,
  isHifz,
  bookmarked,
  color,
  hideText,
  hideWordByWord,
  selected,
  activeAudio,
  meaningWords,
  onToggleBookmark,
  onShowTafsir,
  onShowChoice,
  onWordPress,
}: AyahSpanProps) {
  const timerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);

  const cancelPress = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Never leave a timer running after the ayah unmounts.
  useEffect(() => cancelPress, [cancelPress]);

  const startPress = () => {
    longPressFiredRef.current = false;
    cancelPress();
    timerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onShowTafsir();
    }, 500);
  };

  const handleClick = () => {
    cancelPress();
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    // A pressed ayah asks its question — its meaning or its voice — everywhere.
    // Memorising presses *and* marks, because marking is what that mode is for and
    // the window carries the mark's own button as well: one press keeps the ayah and
    // opens the recitation, the tafsir and the colour it is being kept under.
    if (isHifz) onToggleBookmark();
    onShowChoice();
  };

  // The reader paints an ayah's state straight onto the span, so a chosen or kept ayah
  // keeps its wash under the pointer instead of losing it to the hover rule.
  //
  // A chosen colour comes first, ahead of the selection. The palette is asked for from
  // the sheet that is open on the *selected* ayah, so letting the grey of "this one is
  // open" sit on top of it meant the colour never appeared: press a colour, watch
  // nothing move, which is exactly what the row reported. The colour is what the reader
  // is choosing and what they will still be reading weeks later; the selection is only
  // where the finger last was, and the sheet already names the ayah out loud in its own
  // title. Everything else keeps its old order.
  //
  // The mark shows in every mode, not only memorising — it is the ayah that was saved,
  // and it is what lets «محفوظاتي» send you here and have the place recognise where you
  // have arrived. Hifz mode is where marking is a single tap away, not where marking
  // exists.
  const stateStyle =
    bookmarked && color
      ? { background: highlightWash(color) ?? 'var(--bookmark-wash)' }
      : selected
        ? { background: 'var(--selected-wash)' }
        : bookmarked
          ? { background: 'var(--bookmark-wash)' }
          : undefined;

  // The last word carries the medallion inside one unbreakable tail, so the two are cut
  // from the line together — the number is never left standing at the head of a line,
  // where in Arabic reading order it reads as belonging to the verse that follows.
  const words = ayah.text.split(' ');
  const head = words.slice(0, -1).join(' ');
  const tailWord = words[words.length - 1];
  const mark = (
    <span className={`mushaf-ayah-mark${activeAudio ? ' mushaf-ayah-mark--active' : ''}`} aria-hidden="true">
      {toArabicNumber(ayah.ayahNumber)}
    </span>
  );
  const word = (value: string, index: number) => (
    <span
      key={index}
      className="inline-block hover:bg-gold-100 dark:hover:bg-gold-900/30 rounded-sm cursor-pointer mx-0.5"
      onClick={(e) => {
        e.stopPropagation();
        const el = e.currentTarget;
        el.style.opacity = el.style.opacity === '0' ? '1' : '0';
      }}
    >
      {value}
    </span>
  );

  // The marked set is one ayah's own: `${surahId}:${ayahNumber}` → the word indexes
  // the index ships for it. A word outside that set is drawn exactly as it always
  // was, and pressing it still asks the ayah's question — the mark changes nothing
  // except where the meaning is.
  const marked = meaningWords?.get(`${ayah.surahId}:${ayah.ayahNumber}`);
  const readingWord = (value: string, index: number) => {
    const hasMeaning = marked?.has(index) ?? false;
    return (
      <span key={index}>
        <button
          type="button"
          className={`mushaf-word${hasMeaning ? ' mushaf-word--has-meaning' : ''}`}
          title={hasMeaning ? 'اضغط لمعرفة معنى الكلمة' : undefined}
          onClick={(event) => {
            // An unmarked word is not a target of its own; it falls through to the
            // ayah beneath it, which is where the reader's question has always lived.
            if (!hasMeaning) return;
            event.stopPropagation();
            onWordPress?.(ayah.surahId, ayah.ayahNumber, value, index + 1);
          }}
        >
          {value}
        </button>{' '}
      </span>
    );
  };

  return (
    <span>
      <span
        className={`mushaf-ayah${hideText ? ' no-select' : ''}`}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`تحديد الآية ${toArabicNumber(ayah.ayahNumber)}${activeAudio ? '، تُتلى الآن' : ''}`}
        title="اضغط لتحديد الآية"
        onClick={handleClick}
        onKeyDown={(event) => {
          // A word carries its own button, and a button answers Enter itself — by
          // defaulting to a click the moment the key goes up. Handling Enter here as
          // well would call preventDefault on that keydown and cancel the click it was
          // about to produce: the press would fall through to the ayah underneath,
          // opening the ayah's window on a word that has a meaning of its own to show.
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleClick();
          }
        }}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchMove={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => {
          e.preventDefault();
          cancelPress();
          onShowTafsir();
        }}
        style={stateStyle}
      >
        {hideText ? (
          <>
            {/* The mask hides the words, not their shape: the bar stays visible so the
                memoriser still sees where each line runs, and can still tap it. */}
            {head && (
              <span className="bg-primary-200 dark:bg-primary-700 rounded-sm px-2 select-none" style={{ color: 'transparent' }}>
                {head}
                {' '}
              </span>
            )}
            <span className="mushaf-ayah-tail">
              <span className="bg-primary-200 dark:bg-primary-700 rounded-sm px-2 select-none" style={{ color: 'transparent' }}>
                {tailWord}
              </span>
              {mark}
            </span>
          </>
        ) : hideWordByWord ? (
          <>
            {words.slice(0, -1).map(word)}
            <span className="mushaf-ayah-tail">
              {word(tailWord, words.length - 1)}
              {mark}
            </span>
          </>
        ) : (
          <>
            {words.slice(0, -1).map(readingWord)}
            <span className="mushaf-ayah-tail">
              {readingWord(tailWord, words.length - 1)}
              {mark}
            </span>
          </>
        )}
      </span>{' '}
    </span>
  );
}
