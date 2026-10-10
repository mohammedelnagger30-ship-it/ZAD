import { useCallback, useEffect, useRef } from 'react';
import { toArabicNumber } from '@/data/surahs';
import type { AyahText } from '@/data/quranText';

interface AyahSpanProps {
  ayah: AyahText;
  isHifz: boolean;
  bookmarked: boolean;
  hideText: boolean;
  hideWordByWord: boolean;
  selected: boolean;
  activeAudio: boolean;
  onSelect: () => void;
  onToggleBookmark: () => void;
  onShowTafsir: () => void;
  /** Which of the ayah is wanted: open the reader's «التفسير / التلاوة» question. */
  onShowChoice: () => void;
}

/**
 * One ayah plus its number marker, built the way the reader's page builds it: a plain
 * text span with the medallion sitting straight against the ayah's last word. No button
 * and no control wrapper comes between them, so the line never breaks in that gap — the
 * number stays glued to its ayah instead of being stranded at the start of the next line.
 *
 * Tap selects the ayah and then asks which of it is wanted — its meaning or its
 * voice, the reader's own question put to this screen; in hifz mode pressing a line
 * marks it instead. Long-press (touch) or right-click always opens the tafsir
 * directly, which is the shortest way to it in hifz mode.
 */
export function AyahSpan({
  ayah,
  isHifz,
  bookmarked,
  hideText,
  hideWordByWord,
  selected,
  activeAudio,
  onSelect,
  onToggleBookmark,
  onShowTafsir,
  onShowChoice,
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
    onSelect();
    // A pressed ayah asks its question — its meaning or its voice — everywhere
    // except memorising, where pressing a line is how it is marked.
    if (isHifz) onToggleBookmark();
    else onShowChoice();
  };

  // The reader paints an ayah's state straight onto the span, so a chosen or kept ayah
  // keeps its wash under the pointer instead of losing it to the hover rule.
  const stateStyle = selected
    ? { background: 'var(--selected-wash)' }
    : isHifz && bookmarked
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
            {head ? `${head} ` : null}
            <span className="mushaf-ayah-tail">
              {tailWord}
              {mark}
            </span>
          </>
        )}
      </span>{' '}
    </span>
  );
}
