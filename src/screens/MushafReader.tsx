import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react';
import { MushafPage } from '@/components/mushaf/MushafPage';
import { JumpSheet } from '@/components/mushaf/JumpSheet';
import { OptionsSheet } from '@/components/mushaf/OptionsSheet';
import { MushafHeader } from '@/components/mushaf/MushafHeader';
import { MushafDock } from '@/components/mushaf/MushafDock';
import { AyahVoiceSheet } from '@/components/mushaf/AyahVoiceSheet';
import { useAyahVoice } from '@/hooks/useAyahVoice';
import {
  ZOOM_STEP,
  ZOOM_MIN,
  ZOOM_MAX,
  PAGE_KEYBOARD_STEP,
  SWIPE_DISTANCE,
  PREFS_KEY,
  LEAF_PRELOAD,
  LEAF_CHUNK,
  LEAF_WINDOW,
  LEAF_HEADROOM,
  clampNumber,
  loadPrefs,
  type MushafPrefs,
  type Orientation,
  type JumpTarget,
  type SheetName,
} from '@/components/mushaf/readerConfig';
import { TafsirBottomSheet } from '@/components/TafsirBottomSheet';
import {
  getSurah,
  getAyahPage,
  getJuzForPage,
  getSurahsForPage,
} from '@/data/surahs';
import { getTotalPages, getHizbForPage } from '@/data/mushafPages';
import { db, type Settings } from '@/db/database';

interface MushafReaderProps {
  settings: Settings;
  initialPage?: number;
  onClose: () => void;
  /** Reported on every turn, so the caller can reopen the reader where it was left. */
  onPageChange?: (page: number) => void;
}


export function MushafReader({ settings, initialPage = 1, onClose, onPageChange }: MushafReaderProps) {
  const totalPages = getTotalPages();
  const startPage = Math.min(totalPages, Math.max(1, Math.round(initialPage) || 1));

  const [currentPage, setCurrentPage] = useState(startPage);
  const [prefs, setPrefs] = useState<MushafPrefs>(loadPrefs);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget>('surah');
  const [pageField, setPageField] = useState('');
  const [turnDir, setTurnDir] = useState<'next' | 'prev'>('next');
  const [bookmarkedPages, setBookmarkedPages] = useState<Set<number>>(() => new Set<number>());
  const [tafsirAyah, setTafsirAyah] = useState<{ surahId: number; ayahNumber: number } | null>(null);
  // ---- Page‑read progress tracking ----
  const [readPages, setReadPages] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem('qran-read-pages');
      return stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    } catch {
      return new Set<number>();
    }
  });

  // Update progress whenever the current page changes



  // Update progress whenever the current page changes
  useEffect(() => {
    setReadPages(prev => {
      const next = new Set(prev);
      next.add(currentPage);
      try {
        localStorage.setItem('qran-read-pages', JSON.stringify(Array.from(next)));
      } catch {
        /* A page read that can't be remembered costs nothing. */
      }
      return next;
    });
    onPageChange?.(currentPage);
  }, [currentPage, onPageChange]);
  const progressInfo = `قراءة ${readPages.size} من ${totalPages} صفحة (${Math.round((readPages.size / totalPages) * 100)} ٪)`;
  /**
   * The ayah last pressed, and which of its two uses the reader is being asked
   * about: the meaning behind «التفسير», the voice behind «التلاوة».
   */
  const [ayahChoice, setAyahChoice] = useState<{ surahId: number; ayahNumber: number } | null>(null);
  const orientation = prefs.orientation;
  /**
   * What the transport carries: this one ayah, or the surah through it. It is a
   * preference rather than a mood — a reader who came back for a whole surah is
   * not asked again — so it lives with the rest of them, saved under the same key
   * and read back the next time the mushaf opens.
   */
  const voiceScope = prefs.scope;

  /**
   * The window of sheets the vertical stack has in the DOM. Horizontal mode never
   * touches it: it renders one page, and comes back to this window if the reader
   * switches to the stack later.
   */
  const [leaves, setLeaves] = useState(() => ({
    first: startPage,
    last: Math.min(totalPages, startPage + LEAF_PRELOAD - 1),
  }));

  const currentPageRef = useRef(startPage);
  const leavesRef = useRef(leaves);
  const anchorRef = useRef<{ page: number; top: number; scrollTop: number } | null>(null);
  /** A jump whose sheet is not mounted yet, landed the moment the stack has it. */
  const pendingLeafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetPanelRef = useRef<HTMLDivElement>(null);
  /** The ayah's own panel: it can sit under the tafsir, which takes the focus. */
  const ayahPanelRef = useRef<HTMLDivElement>(null);
  /** Whether the ayah's sheet is up, so a new focus ask is an opening, not an advance. */
  const ayahSheetOpenRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchEndRef = useRef<{ x: number; y: number } | null>(null);

  const leafEl = useCallback(
    (page: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) ?? null,
    [],
  );

  /** Put the top of a sheet level with the top of the reading area. */
  const scrollToLeaf = useCallback(
    (page: number) => {
      const container = scrollRef.current;
      const el = leafEl(page);
      if (!container || !el) return false;
      // Scroll coordinates start at the content box, `getBoundingClientRect` at the
      // border box: without the scroller's own padding a jump lands the sheet a
      // gutter too high, touching the top bar.
      const gutter = parseFloat(getComputedStyle(container).paddingTop) || 0;
      container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - gutter;
      return true;
    },
    [leafEl],
  );

  /**
   * Land on a sheet now if the stack already holds it, and remember it if the stack is
   * still rendering — a jump is asked for in an event, but the sheet it is aiming at may
   * only exist after the commit that follows it.
   */
  const landOnLeaf = useCallback(
    (page: number) => {
      pendingLeafRef.current = scrollToLeaf(page) ? null : page;
    },
    [scrollToLeaf],
  );

  // The other half of `landOnLeaf`: sheet present, jump owed, land on it. Runs before
  // the browser paints, so the reader never sees the old position first.
  useLayoutEffect(() => {
    const target = pendingLeafRef.current;
    if (target === null) return;
    if (orientation !== 'vertical') {
      pendingLeafRef.current = null;
      return;
    }
    if (scrollToLeaf(target)) pendingLeafRef.current = null;
  }, [leaves, orientation, scrollToLeaf]);

  /**
   * Slide the window. Moving its head changes where every sheet below it sits in the
   * document, so the sheet that stays visible across the change is measured first and
   * the scroller is corrected by however far that sheet moved — the pages are meant to
   * arrive and leave underneath the eye, not to jump it.
   */
  const applyLeaves = useCallback(
    (next: { first: number; last: number }) => {
      const prev = leavesRef.current;
      if (prev.first === next.first && prev.last === next.last) return;
      if (next.first !== prev.first) {
        const anchorPage = next.first > prev.first ? next.first : prev.first;
        const container = scrollRef.current;
        const el = leafEl(anchorPage);
        // A sheet that is not in the document yet (the stack is re-opening around a
        // jumped-to page) has no position to hold on to — but a sheet that is still to
        // come does, and dropping it would drop the reader's place: two moves can be
        // asked for before one commit, and the correction is measured against the
        // layout both of them started from.
        if (container && el) {
          anchorRef.current = {
            page: anchorPage,
            top: el.getBoundingClientRect().top,
            scrollTop: container.scrollTop,
          };
        }
      }
      leavesRef.current = next;
      setLeaves(next);
    },
    [leafEl],
  );

  /** Ask for the sheets above the stack. Stopped by the reader having reached page 1. */
  const prependLeaves = useCallback(
    (headroom: number) => {
      const container = scrollRef.current;
      if (!container || container.scrollTop > headroom) return;
      const current = leavesRef.current;
      if (current.first <= 1) return;
      const first = Math.max(1, current.first - LEAF_CHUNK);
      applyLeaves({ first, last: Math.min(current.last, first + LEAF_WINDOW - 1) });
    },
    [applyLeaves],
  );

  // Runs after the window moved, before the browser paints the result of it.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const container = scrollRef.current;
    const el = leafEl(anchor.page);
    if (!container || !el) return;
    // Measured in the document rather than on the screen: a scroll that slipped in
    // while React was still committing belongs to the reader, not to the stack, and
    // paying for it here would cancel the reader's own movement.
    const was = anchor.top + anchor.scrollTop;
    const now = el.getBoundingClientRect().top + container.scrollTop;
    container.scrollTop += now - was;
  }, [leaves.first, leafEl]);

  // A reloaded document restores every scroll box to where it was, which drops a
  // freshly opened page half way down its sheet. The reader owns its scroller, so
  // it takes scroll restoration back while it is on screen, and puts the scroller
  // back on the page being read — the head of a sheet in horizontal mode, the top
  // of that sheet's leaf in the stack.
  const resetScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (orientation === 'vertical') scrollToLeaf(currentPageRef.current);
    else container.scrollTo({ top: 0 });
  }, [orientation, scrollToLeaf]);

  useEffect(() => {
    const previous = history.scrollRestoration;
    try {
      history.scrollRestoration = 'manual';
    } catch {
      /* Not every context allows the flag; the reset below still runs. */
    }

    resetScroll();
    // The type is set by a font that may still be arriving on a cold open: when it
    // lands the lines re-break and the sheet the reader opened on moves under them.
    // Land on it again — but only if the reader has not moved on since.
    const openedOn = currentPageRef.current;
    document.fonts.ready
      .then(() => {
        if (currentPageRef.current === openedOn) resetScroll();
      })
      .catch(() => {});
    window.addEventListener('pageshow', resetScroll);

    return () => {
      window.removeEventListener('pageshow', resetScroll);
      try {
        history.scrollRestoration = previous;
      } catch {
        /* Ignore a rejected restore of the flag. */
      }
    };
  }, [resetScroll]);

  // Load persisted page bookmarks. Component state would lose them on every close.
  useEffect(() => {
    let cancelled = false;
    db.pageBookmarks
      .toArray()
      .then((rows) => {
        if (!cancelled) setBookmarkedPages(new Set(rows.map((r) => r.page)));
      })
      .catch(() => {
        /* A failed read only costs the bookmark marks, so it must not break the reader. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const goToPage = useCallback(
    (page: number) => {
      const target = Math.min(totalPages, Math.max(1, Math.round(page) || 1));
      if (target !== currentPageRef.current) {
        // The direction decides which way the new sheet slides in.
        setTurnDir(target > currentPageRef.current ? 'next' : 'prev');
        currentPageRef.current = target;
        setCurrentPage(target);
        onPageChange?.(target);
      }
      setSheet(null);

      if (orientation !== 'vertical') return;
      // Open the window around the target if the stack does not hold it yet, then land
      // on it — now if the sheet is already there, right after the commit if it is not.
      const stack = leavesRef.current;
      if (target < stack.first || target > stack.last) {
        applyLeaves({ first: target, last: Math.min(totalPages, target + LEAF_PRELOAD - 1) });
      }
      landOnLeaf(target);
    },
    [totalPages, onPageChange, orientation, applyLeaves, landOnLeaf],
  );

  const updatePrefs = useCallback((patch: Partial<MushafPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* Losing a preference costs nothing; breaking a render would. */
      }
      return next;
    });
  }, []);

  /**
   * Swap between the stack and the single sheet. The stack has to open around the
   * page being read — otherwise it would come back on whatever window the last
   * vertical session left behind — and `resetScroll` puts the scroller on it.
   */
  const setOrientation = useCallback(
    (next: Orientation) => {
      if (next === orientation) return;
      updatePrefs({ orientation: next });
      if (next !== 'vertical') return;
      const target = currentPageRef.current;
      const stack = leavesRef.current;
      if (target < stack.first || target > stack.last) {
        applyLeaves({ first: target, last: Math.min(totalPages, target + LEAF_PRELOAD - 1) });
      }
    },
    [orientation, updatePrefs, applyLeaves, totalPages],
  );

  const zoomIn = useCallback(() => updatePrefs({ zoom: clampNumber(prefs.zoom + ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, 1) }), [prefs.zoom, updatePrefs]);
  const zoomOut = useCallback(() => updatePrefs({ zoom: clampNumber(prefs.zoom - ZOOM_STEP, ZOOM_MIN, ZOOM_MAX, 1) }), [prefs.zoom, updatePrefs]);

  /**
   * What a scrolled stack owes the rest of the reader: the sheet hanging over the top
   * of the reading area owns the header, the progress line and the bookmark — exactly
   * as the sheet a page turn lands on does — and the window is fed from whichever end
   * is running out. Done on the scroll event itself: the browser already delivers those
   * once a frame, and a reader whose tab has stopped painting must not stop keeping up.
   */
  const handleVerticalScroll = useCallback(() => {
    const box = scrollRef.current;
    if (!box) return;

    // The top sheet is the first one reaching into the reading area, not the last one
    // starting above it — between two sheets there is a gap showing the shell, and
    // counting the sheet behind that gap would name a page nobody is looking at.
    const sheets = box.querySelectorAll<HTMLElement>('[data-page]');
    if (sheets.length > 0) {
      const boxTop = box.getBoundingClientRect().top;
      let top = Number(sheets[sheets.length - 1].dataset.page);
      for (const leaf of sheets) {
        if (leaf.getBoundingClientRect().bottom > boxTop) {
          top = Number(leaf.dataset.page);
          break;
        }
      }
      if (Number.isFinite(top) && top !== currentPageRef.current) {
        currentPageRef.current = top;
        setCurrentPage(top);
        onPageChange?.(top);
      }
    }

    const current = leavesRef.current;
    const runningOut = box.scrollHeight - (box.scrollTop + box.clientHeight) < box.clientHeight;
    if (runningOut && current.last < totalPages) {
      const last = Math.min(totalPages, current.last + LEAF_CHUNK);
      applyLeaves({ first: Math.max(current.first, last - LEAF_WINDOW + 1), last });
    } else if (box.scrollTop < LEAF_HEADROOM) {
      prependLeaves(LEAF_HEADROOM);
    }
  }, [applyLeaves, onPageChange, prependLeaves, totalPages]);

  // A turned sheet opens at its head. The stack never joins in: there, scrolling is
  // the reading, and pulling it back to the top on every crossing would be a jump.
  useEffect(() => {
    if (orientation === 'horizontal') scrollRef.current?.scrollTo({ top: 0 });
  }, [currentPage, orientation]);

  /**
   * A pressed ayah asks a question of its own: does the reader want what it means,
   * or how it sounds, and in how much of the book — this one ayah, or the surah
   * right through it? The sheet holds the answers: the tafsir behind one button,
   * the recitation behind the other, in the reciter already chosen for this mushaf
   * and changeable without leaving the ayah.
   */
  /**
   * Put the reader on the ayah being recited: the sheet takes it, the page
   * highlights it, and the mushaf opens the page it is actually printed on — the
   * recitation walks the surah, and the page is meant to walk with it.
   */
  const showAyah = useCallback(
    (surahId: number, ayahNumber: number) => {
      const target = getSurah(surahId);
      if (!target) return;
      const choice = { surahId, ayahNumber };
      const page = getAyahPage(target, ayahNumber);
      if (page !== currentPageRef.current) goToPage(page);
      setAyahChoice(choice);
    },
    [goToPage],
  );

  const {
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
  } = useAyahVoice({ ayahChoice, setAyahChoice, showAyah, updatePrefs, voiceScope });
  const handleAyahPress = useCallback(
    (surahId: number, ayahNumber: number) => {
      setAyahChoice({ surahId, ayahNumber });
      resetVoice();
      resetVoice();
      resetVoice();
      resetVoice();
      resetVoice();
      // Each pressed ayah is asked about on its own terms again; the length it is
      // heard in stays what the reader chose, because that is what they listen by.
    },
    [resetVoice],
  );

  // Focus lands in the sheet that just opened, and Escape gives it back.
  useEffect(() => {
    if (sheet) sheetPanelRef.current?.focus();
  }, [sheet]);
  useEffect(() => {
    // Focus the panel as the sheet opens, and only then: the recitation moves this
    // value on its own as it walks down the surah, and taking the button's focus on
    // every ayah would cost the reader the tap already on its way.
    const opening = ayahChoice !== null && !ayahSheetOpenRef.current;
    ayahSheetOpenRef.current = ayahChoice !== null;
    if (opening) ayahPanelRef.current?.focus();
  }, [ayahChoice]);

  // Page turns are the primary interaction here, so bind them to the keyboard as well.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (event.key === 'Escape') {
        if (tafsirAyah) {
          setTafsirAyah(null);
          event.preventDefault();
        } else if (ayahChoice) {
          closeAyahChoice();
          event.preventDefault();
        } else if (sheet) {
          setSheet(null);
          event.preventDefault();
        }
        return;
      }

      if (sheet || tafsirAyah || ayahChoice || typing) return;
      // In an RTL layout the left arrow advances, matching the reading direction; in
      // the stack the down arrow does the same job under the thumb.
      const step = event.shiftKey ? PAGE_KEYBOARD_STEP : 1;
      const forward = orientation === 'vertical' ? ['ArrowLeft', 'ArrowDown'] : ['ArrowLeft'];
      const backward = orientation === 'vertical' ? ['ArrowRight', 'ArrowUp'] : ['ArrowRight'];
      if (forward.includes(event.key)) {
        event.preventDefault();
        goToPage(currentPage + step);
      } else if (backward.includes(event.key)) {
        event.preventDefault();
        goToPage(currentPage - step);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPage, goToPage, orientation, sheet, tafsirAyah, ayahChoice, closeAyahChoice]);

  // Page turns by swipe. Bound to the scroller (not to the sheet inside it), so a
  // gesture started on the margin counts too and a vertical scroll never turns a page.
  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    touchStartRef.current = { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    touchEndRef.current = null;
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    touchEndRef.current = { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
  };

  const handleTouchEnd = () => {
    const start = touchStartRef.current;
    const end = touchEndRef.current;
    touchStartRef.current = null;
    touchEndRef.current = null;
    if (!start || !end) return;

    const deltaX = start.x - end.x;
    const deltaY = Math.abs(start.y - end.y);
    if (deltaY > SWIPE_DISTANCE) return;

    if (deltaX > SWIPE_DISTANCE) goToPage(currentPage + 1);
    else if (deltaX < -SWIPE_DISTANCE) goToPage(currentPage - 1);
  };

  // In the stack, a drag or a wheel aimed at the head of the pages has nothing to
  // move yet — no movement means no scroll event, which means no chance to ask for
  // the sheets above. It asks here instead, once, and the scroll carries on.
  const handleVerticalTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start) return;
    if (event.changedTouches[0].clientY - start.y > 6) prependLeaves(1);
  };

  const handleVerticalWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) prependLeaves(1);
  };

  const toggleBookmark = useCallback((page: number) => {
    setBookmarkedPages((prev) => {
      const updated = new Set(prev);
      if (updated.has(page)) {
        updated.delete(page);
        void db.pageBookmarks.delete(page).catch(() => {});
      } else {
        updated.add(page);
        void db.pageBookmarks.put({ page, createdAt: Date.now() }).catch(() => {});
      }
      return updated;
    });
  }, []);

  /** Step the open tafsir sheet to a neighbouring ayah, crossing surah and page breaks. */
  const stepTafsirAyah = useCallback(
    (delta: number) => {
      if (!tafsirAyah) return;
      const current = getSurah(tafsirAyah.surahId);
      if (!current) return;

      let surahId = current.id;
      let ayahNumber = tafsirAyah.ayahNumber + delta;

      if (ayahNumber < 1) {
        const prev = getSurah(current.id - 1);
        if (!prev) return; // already at 1:1
        surahId = prev.id;
        ayahNumber = prev.ayahCount;
      } else if (ayahNumber > current.ayahCount) {
        const next = getSurah(current.id + 1);
        if (!next) return; // already at the last ayah
        surahId = next.id;
        ayahNumber = 1;
      }

      const target = getSurah(surahId);
      if (!target) return;
      setTafsirAyah({ surahId, ayahNumber });
      // Follow the reader to the page the ayah is actually printed on.
      goToPage(getAyahPage(target, ayahNumber));
    },
    [tafsirAyah, goToPage],
  );

  // `getSurahsForPage` is the authority on which surahs a page carries; the estimate in
  // the old header (ayahs/15 pages per surah) disagreed with it, so the header could name
  // a surah that was not printed on the page being read.
  const surahsOnPage = useMemo(() => getSurahsForPage(currentPage), [currentPage]);
  const currentJuz = useMemo(() => getJuzForPage(currentPage), [currentPage]);
  const currentHizb = useMemo(() => getHizbForPage(currentPage), [currentPage]);

  const isBookmarked = bookmarkedPages.has(currentPage);
  const zoomPercent = Math.round(prefs.zoom * 100);
  const effectiveFontSize = Math.round(settings.fontSize * prefs.zoom * prefs.readingScale);
  const mode = prefs.mode;
  /** The ayah under discussion, held on the page while either of its sheets is open. */
  const activeReadingAyah = tafsirAyah ?? ayahChoice;

  // Bring what the reader is already on into view when the jump sheet opens: the
  // surah carrying this page in the list, or the page in the grid. Both mark
  // themselves the same way, so one query answers for every tab.
  useEffect(() => {
    if (sheet !== 'jump') return;
    sheetPanelRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'center' });
  }, [sheet, jumpTarget]);

  const openJumpSheet = () => {
    setPageField('');
    setJumpTarget('surah');
    setSheet(sheet === 'jump' ? null : 'jump');
  };

  /** The sheets the stack is currently holding, as page numbers. */
  const leafPages = useMemo(() => {
    const pages: number[] = [];
    for (let page = leaves.first; page <= leaves.last; page += 1) pages.push(page);
    return pages;
  }, [leaves]);

  return (
    <div className="mushaf-shell" data-mode={mode}>
      <MushafHeader
        onClose={onClose}
        surahsOnPage={surahsOnPage}
        currentJuz={currentJuz}
        currentHizb={currentHizb}
        currentPage={currentPage}
        isBookmarked={isBookmarked}
        toggleBookmark={toggleBookmark}
        mode={mode}
        updatePrefs={updatePrefs}
        sheet={sheet}
        setSheet={setSheet} progressInfo={progressInfo}
      />

      {/* ── The page ───────────────────────────────────────────────────── */}
      <div
        className="mushaf-scroll"
        ref={scrollRef}
        onScroll={orientation === 'vertical' ? handleVerticalScroll : undefined}
        onWheel={orientation === 'vertical' ? handleVerticalWheel : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={orientation === 'vertical' ? handleVerticalTouchMove : handleTouchMove}
        onTouchEnd={orientation === 'horizontal' ? handleTouchEnd : undefined}
      >
        {orientation === 'vertical' ? (
          /* Sheets end to end: scrolling down is turning the page. */
          <div className="mushaf-stack">
            {leafPages.map((page) => (
              <MushafLeaf
                key={page}
                page={page}
                fontSize={effectiveFontSize}
                night={mode === 'night'}
                lineHeight={1.9 + (prefs.lineSpacing - 1) * 0.55}
                letterSpacing={0.01 + Math.max(0, prefs.lineSpacing - 1) * 0.01}
                wordSpacing={prefs.wordSpacing}
                onAyahPress={handleAyahPress}
                activeAyah={activeReadingAyah}
              />
            ))}
          </div>
        ) : (
          <div
            className="mushaf-turn mushaf-turn--column"
            data-dir={turnDir}
            key={currentPage}
          >
            <MushafPage
              page={currentPage}
              fontSize={effectiveFontSize}
              night={mode === 'night'}
              lineHeight={1.9 + (prefs.lineSpacing - 1) * 0.55}
              letterSpacing={0.01 + Math.max(0, prefs.lineSpacing - 1) * 0.01}
              wordSpacing={prefs.wordSpacing}
              onAyahPress={handleAyahPress}
              activeAyah={activeReadingAyah}
            />
          </div>
        )}
      </div>

      <MushafDock
        currentPage={currentPage}
        totalPages={totalPages}
        openJumpSheet={openJumpSheet}
        sheet={sheet}
        setSheet={setSheet}
        zoomOut={zoomOut}
        zoomIn={zoomIn}
        zoomPercent={zoomPercent}
        prefs={prefs}
      />

      {/* ── Jump sheet ─────────────────────────────────────────────────── */}
      <JumpSheet
        open={sheet === 'jump'}
        onClose={() => setSheet(null)}
        panelRef={sheetPanelRef}
        jumpTarget={jumpTarget}
        setJumpTarget={setJumpTarget}
        pageField={pageField}
        setPageField={setPageField}
        totalPages={totalPages}
        currentPage={currentPage}
        goToPage={goToPage}
        bookmarkedPages={bookmarkedPages}
        surahsOnPage={surahsOnPage}
        currentJuz={currentJuz}
        currentHizb={currentHizb}
      />

      {/* ── Reading options sheet ─────────────────────────────────────────────── */}
      <OptionsSheet
        open={sheet === 'options'}
        onClose={() => setSheet(null)}
        panelRef={sheetPanelRef}
        prefs={prefs}
        updatePrefs={updatePrefs}
        onOrientationChange={setOrientation}
      />

      <AyahVoiceSheet
        ayahChoice={ayahChoice}
        closeAyahChoice={closeAyahChoice}
        ayahPanelRef={ayahPanelRef}
        setTafsirAyah={setTafsirAyah}
        openVoice={openVoice}
        voiceEngaged={voiceEngaged}
        voiceHint={voiceHint}
        voiceScope={voiceScope}
        handleVoiceScope={handleVoiceScope}
        reciterId={reciterId}
        handleVoiceReciter={handleVoiceReciter}
        replayVoice={replayVoice}
        voicePhase={voicePhase}
        voicePrimaryDisabled={voicePrimaryDisabled}
        voicePrimaryLabel={voicePrimaryLabel}
        voiceError={voiceError}
        voiceAudioRef={voiceAudioRef}
        setVoicePlaying={setVoicePlaying}
        handleVoiceTime={handleVoiceTime}
        finishVoice={finishVoice}
      />

      {/* Rendered last so it stacks over the reader's own sheets. */}
      {tafsirAyah && (
        <TafsirBottomSheet
          surahId={tafsirAyah.surahId}
          ayahNumber={tafsirAyah.ayahNumber}
          onClose={() => setTafsirAyah(null)}
          onNavigateAyah={stepTafsirAyah}
        />
      )}
    </div>
  );
}

interface MushafLeafProps {
  page: number;
  fontSize: number;
  night: boolean;
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  onAyahPress: (surahId: number, ayahNumber: number) => void;
  activeAyah: { surahId: number; ayahNumber: number } | null;
}

/**
 * One sheet of the vertical stack, and what makes holding forty of them affordable: a
 * page crossing repaints the header, the progress line and the bookmark, never the
 * sheets themselves, so a leaf whose props have not changed is not re-rendered. It
 * carries `data-page` because that is what the scroll maths reads to know where it is.
 */
const MushafLeaf = memo(function MushafLeaf({ page, ...sheet }: MushafLeafProps) {
  return (
    <div className="mushaf-leaf mushaf-leaf--column" data-page={page}>
      <MushafPage page={page} {...sheet} />
    </div>
  );
});



