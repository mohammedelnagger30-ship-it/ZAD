import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react';
import {
  Bookmark,
  BookOpen,
  List,
  Moon,
  MoveHorizontal,
  MoveVertical,
  SlidersHorizontal,
  Sun,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { MushafPage } from '@/components/mushaf/MushafPage';
import { Sheet } from '@/components/mushaf/Sheet';
import { TafsirBottomSheet } from '@/components/TafsirBottomSheet';
import {
  SURAHS,
  JUZ_INFO,
  getSurah,
  getAyahPage,
  getJuzForPage,
  getSurahsForPage,
  toArabicNumber,
} from '@/data/surahs';
import { getTotalPages, HIZB_INFO, getHizbForPage } from '@/data/mushafPages';
import { loadPreferredReciter, savePreferredReciter, AUDIO_RECITERS } from '@/data/audioReciters';
import { loadSurahAudio, type SurahAudioSource, type VerseTiming } from '@/utils/quranAudio';
import { db, type Settings } from '@/db/database';

interface MushafReaderProps {
  settings: Settings;
  initialPage?: number;
  onClose: () => void;
  /** Reported on every turn, so the caller can reopen the reader where it was left. */
  onPageChange?: (page: number) => void;
}

const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2;
/** Pages are the smallest useful jump target; below this the text stops being readable. */
const PAGE_KEYBOARD_STEP = 10;
const SWIPE_DISTANCE = 50;
const PREFS_KEY = 'zad:mushaf-prefs';

/**
 * The vertical stack never holds the whole mushaf: 602 sheets of set type are far too
 * many to mount. It keeps a sliding window instead — LEAF_PRELOAD sheets to open on,
 * LEAF_CHUNK sheets added at a time when the reader runs out, and never more than
 * LEAF_WINDOW at once, so the tail is trimmed as the head grows.
 */
const LEAF_PRELOAD = 8;
const LEAF_CHUNK = 6;
const LEAF_WINDOW = 40;
/** Within this many pixels of the head the stack pre-loads, so it never dead-ends. */
const LEAF_HEADROOM = 8;

type MushafMode = 'day' | 'night';
/** Which way the reader travels: down a stack of sheets, or across one sheet at a time. */
type Orientation = 'vertical' | 'horizontal';
/** What the voice carries when an ayah is asked about: that ayah, or the surah through it. */
type VoiceScope = 'ayah' | 'surah';
type SheetName = 'jump' | 'options';
type JumpTarget = 'page' | 'surah' | 'juz' | 'hizb';

/**
 * How the reader looks, kept in one object on purpose.
 *
 * Night, zoom and spacing used to live in five independent pieces of
 * state, so the shell could end up half themed — chrome in one mode, page in
 * another — and every change was lost on close. One object, one writer, one
 * key in localStorage.
 */
interface MushafPrefs {
  mode: MushafMode;
  orientation: Orientation;
  zoom: number;
  readingScale: number;
  lineSpacing: number;
  wordSpacing: number;
  /** Kept here because a reader who listens to surahs keeps hearing surahs. */
  scope: VoiceScope;
}

const DEFAULT_PREFS: MushafPrefs = {
  mode: 'day',
  orientation: 'vertical',
  zoom: 1,
  readingScale: 1,
  lineSpacing: 1,
  wordSpacing: 0,
  scope: 'ayah',
};

/**
 * The ways into the mushaf, ordered by how a reader reaches for them: the surah by
 * name first — the list is the front door — then the parts, then a page number
 * typed by someone who already knows it.
 */
const JUMP_TABS: { id: JumpTarget; label: string }[] = [
  { id: 'surah', label: 'سورة' },
  { id: 'juz', label: 'جزء' },
  { id: 'hizb', label: 'حزب' },
  { id: 'page', label: 'صفحة' },
];

const MODES: { id: MushafMode; label: string; Icon: LucideIcon }[] = [
  { id: 'day', label: 'نهاري', Icon: Sun },
  { id: 'night', label: 'ليلي', Icon: Moon },
];

const ORIENTATIONS: { id: Orientation; label: string; hint: string; Icon: LucideIcon }[] = [
  {
    id: 'vertical',
    label: 'بالطول',
    hint: 'التنقّل الافتراضي: تنزل بالصفحة تحتها فتأتي التي بعدها، بلا أزرار.',
    Icon: MoveVertical,
  },
  {
    id: 'horizontal',
    label: 'بالعرض',
    hint: 'ورقة واحدة أمامك: اسحب يميناً أو يساراً لقلبها، أو استخدم أسهم لوحة المفاتيح.',
    Icon: MoveHorizontal,
  },
];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

/** Nothing follows a surah's own last ayah, so the transport has nothing to offer there. */
function isSurahEnd(choice: { surahId: number; ayahNumber: number } | null): boolean {
  if (!choice) return false;
  const surah = getSurah(choice.surahId);
  return !!surah && choice.ayahNumber >= surah.ayahCount;
}

function loadPrefs(): MushafPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<MushafPrefs>;
    return {
      // Anything saved before the paper mode was dropped, or by a later build,
      // opens as the default day sheet rather than on a mode nothing draws.
      mode: parsed.mode === 'night' ? 'night' : 'day',
      // Saved before the option existed, so it opens the way it reads by default.
      orientation: parsed.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      zoom: clampNumber(parsed.zoom, ZOOM_MIN, ZOOM_MAX, DEFAULT_PREFS.zoom),
      readingScale: clampNumber(parsed.readingScale, 0.85, 1.35, DEFAULT_PREFS.readingScale),
      lineSpacing: clampNumber(parsed.lineSpacing, 0.9, 1.35, DEFAULT_PREFS.lineSpacing),
      wordSpacing: clampNumber(parsed.wordSpacing, 0, 0.3, DEFAULT_PREFS.wordSpacing),
      // Saved before the option existed, so it opens the way it reads by default.
      scope: parsed.scope === 'surah' ? 'surah' : 'ayah',
    };
  } catch {
    return DEFAULT_PREFS;
  }
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
  const [reciterId, setReciterId] = useState(loadPreferredReciter);
  /**
   * The ayah last pressed, and which of its two uses the reader is being asked
   * about: the meaning behind «التفسير», the voice behind «التلاوة».
   */
  const [ayahChoice, setAyahChoice] = useState<{ surahId: number; ayahNumber: number } | null>(null);
  const [voiceEngaged, setVoiceEngaged] = useState(false);
  const [voicePhase, setVoicePhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [voicePlaying, setVoicePlaying] = useState(false);
  /** Set when this ayah has run to its end: «متابعة» then means the one after it. */
  const [voiceDone, setVoiceDone] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
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
  const voiceAudioRef = useRef<HTMLAudioElement>(null);
  /** The surah's file, held once per reciter and read for every ayah in it. */
  const voiceSourceRef = useRef<{ surahId: number; source: SurahAudioSource } | null>(null);
  const voiceTimingRef = useRef<VerseTiming | null>(null);
  /** The blob URL's only handle — nothing else can release the file it maps to. */
  const voiceUrlRef = useRef<string | null>(null);
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

  const handleAyahPress = useCallback(
    (surahId: number, ayahNumber: number) => {
      setAyahChoice({ surahId, ayahNumber });
      setVoiceEngaged(false);
      setVoicePhase('idle');
      setVoicePlaying(false);
      setVoiceDone(false);
      setVoiceError(null);
      // Each pressed ayah is asked about on its own terms again; the length it is
      // heard in stays what the reader chose, because that is what they listen by.
    },
    [],
  );

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
  }, [pauseVoice, releaseVoice]);

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

  // Leaving the reader while the ayah's voice is up must not leave the recitation
  // behind it: the element goes out of the document, and that alone never stops it.
  useLayoutEffect(() => () => void voiceAudioRef.current?.pause(), []);

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
  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  const isBookmarked = bookmarkedPages.has(currentPage);
  const zoomPercent = Math.round(prefs.zoom * 100);
  const effectiveFontSize = Math.round(settings.fontSize * prefs.zoom * prefs.readingScale);
  const mode = prefs.mode;
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
  /** The ayah under discussion, held on the page while either of its sheets is open. */
  const activeReadingAyah = tafsirAyah ?? ayahChoice;
  const activeOrientation = ORIENTATIONS.find((o) => o.id === orientation) ?? ORIENTATIONS[0];

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
      {/* ── Above the page: who you are reading ─────────────────────────── */}
      <header className="mushaf-topbar">
        <button className="mushaf-iconbtn" onClick={onClose} aria-label="إغلاق المصحف">
          <X size={20} />
        </button>

        <div className="mushaf-heading">
          <p className="mushaf-heading__title">
            {surahsOnPage.length > 0 ? surahsOnPage.map((s) => s.name).join(' · ') : `الجزء ${toArabicNumber(currentJuz)}`}
          </p>
          <p className="mushaf-heading__meta">
            الجزء {toArabicNumber(currentJuz)} · الحزب {toArabicNumber(currentHizb)}
          </p>
        </div>

        <div className="mushaf-actions">
          <button
            className="mushaf-iconbtn mushaf-iconbtn--gold"
            onClick={() => toggleBookmark(currentPage)}
            aria-label={isBookmarked ? 'إزالة العلامة من هذه الصفحة' : 'حفظ هذه الصفحة'}
            aria-pressed={isBookmarked}
          >
            <Bookmark size={17} className={isBookmarked ? 'fill-current' : ''} />
          </button>
          <button
            className="mushaf-iconbtn"
            onClick={() => updatePrefs({ mode: mode === 'night' ? 'day' : 'night' })}
            aria-label={mode === 'night' ? 'الوضع النهاري' : 'الوضع الليلي'}
            aria-pressed={mode === 'night'}
          >
            {mode === 'night' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="mushaf-iconbtn"
            onClick={() => setSheet(sheet === 'options' ? null : 'options')}
            aria-label="خيارات القراءة"
            aria-expanded={sheet === 'options'}
          >
            <SlidersHorizontal size={17} />
          </button>
        </div>
      </header>

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

      {/* ── Below the page: where you are going ────────────────────────── */}
      <footer className="mushaf-dock">
        <div className="mushaf-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(1.5, (currentPage / totalPages) * 100)}%` }} />
        </div>

        <div className="mushaf-tools">
          <button className="mushaf-tool" onClick={openJumpSheet} aria-expanded={sheet === 'jump'}>
            <List size={15} aria-hidden="true" /> انتقال إلى
          </button>

          <div className="mushaf-zoom">
            <button onClick={zoomOut} disabled={prefs.zoom <= ZOOM_MIN} aria-label="تصغير الصفحة">
              <ZoomOut size={15} />
            </button>
            <span className="mushaf-zoom__value">{toArabicNumber(zoomPercent)}%</span>
            <button onClick={zoomIn} disabled={prefs.zoom >= ZOOM_MAX} aria-label="تكبير الصفحة">
              <ZoomIn size={15} />
            </button>
          </div>

          <button
            className="mushaf-tool"
            onClick={() => setSheet(sheet === 'options' ? null : 'options')}
            aria-expanded={sheet === 'options'}
          >
            <SlidersHorizontal size={15} aria-hidden="true" /> خيارات القراءة
          </button>
        </div>
      </footer>

      {/* ── Jump sheet ─────────────────────────────────────────────────── */}
      <Sheet
        open={sheet === 'jump'}
        title="انتقال إلى"
        onClose={() => setSheet(null)}
        panelRef={sheetPanelRef}
      >
        <div className="mushaf-tabs" role="tablist" aria-label="طريقة الانتقال">
          {JUMP_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              className="mushaf-tab"
              aria-selected={jumpTarget === tab.id}
              onClick={() => setJumpTarget(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {jumpTarget === 'page' && (
          <>
            <form
              className="mushaf-jumpbar"
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(pageField);
                if (value >= 1 && value <= totalPages) goToPage(value);
              }}
            >
              <input
                className="mushaf-input"
                type="number"
                inputMode="numeric"
                min={1}
                max={totalPages}
                value={pageField}
                onChange={(event) => setPageField(event.target.value)}
                placeholder={`رقم الصفحة من ${toArabicNumber(totalPages)}`}
                aria-label="رقم الصفحة"
              />
              <button className="mushaf-tool" type="submit">
                اذهب
              </button>
            </form>

            <div className="mushaf-grid mushaf-grid--page">
              {pageNumbers.map((p) => (
                <button
                  key={p}
                  className="mushaf-cell"
                  aria-label={`الصفحة ${toArabicNumber(p)}`}
                  aria-current={p === currentPage ? 'true' : undefined}
                  onClick={() => goToPage(p)}
                >
                  {toArabicNumber(p)}
                  {bookmarkedPages.has(p) && <span className="mushaf-cell__dot" aria-hidden="true" />}
                </button>
              ))}
            </div>
          </>
        )}

        {jumpTarget === 'surah' && (
          <div className="mushaf-grid mushaf-grid--card">
            {SURAHS.map((s) => (
              <button
                key={s.id}
                className="mushaf-cell mushaf-cell--card"
                aria-current={surahsOnPage.some((on) => on.id === s.id) ? 'true' : undefined}
                onClick={() => goToPage(s.pageStart)}
              >
                {/* The number is what makes the order visible at a glance; the
                    surah's name already says which one it is out loud. */}
                <span className="mushaf-cell__index" aria-hidden="true">
                  {toArabicNumber(s.id)}
                </span>
                <span className="mushaf-cell__title">{s.name}</span>
                <span className="mushaf-cell__sub">صفحة {toArabicNumber(s.pageStart)}</span>
              </button>
            ))}
          </div>
        )}

        {jumpTarget === 'juz' && (
          <div className="mushaf-grid mushaf-grid--card">
            {JUZ_INFO.map((j) => (
              <button
                key={j.id}
                className="mushaf-cell mushaf-cell--card"
                aria-current={j.id === currentJuz ? 'true' : undefined}
                onClick={() => goToPage(j.startPage)}
              >
                <span className="mushaf-cell__title">{j.name}</span>
                <span className="mushaf-cell__sub">صفحة {toArabicNumber(j.startPage)}</span>
              </button>
            ))}
          </div>
        )}

        {jumpTarget === 'hizb' && (
          <div className="mushaf-grid mushaf-grid--card">
            {HIZB_INFO.map((h) => (
              <button
                key={h.id}
                className="mushaf-cell mushaf-cell--card"
                aria-current={h.id === currentHizb ? 'true' : undefined}
                onClick={() => goToPage(h.startPage)}
              >
                <span className="mushaf-cell__title">{h.name}</span>
                <span className="mushaf-cell__sub">صفحة {toArabicNumber(h.startPage)}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      {/* ── Reading options sheet ──────────────────────────────────────── */}
      <Sheet
        open={sheet === 'options'}
        title="خيارات القراءة"
        onClose={() => setSheet(null)}
        panelRef={sheetPanelRef}
        darkSurface={mode === 'night'}
      >
        <section className="mushaf-section">
          <p className="mushaf-section__title">التنقّل</p>
          <div className="mushaf-seg">
            {ORIENTATIONS.map(({ id, label, Icon }) => (
              <button
                key={id}
                className="mushaf-seg__item"
                aria-pressed={orientation === id}
                onClick={() => setOrientation(id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <p className="mushaf-hint">{activeOrientation.hint}</p>
        </section>

        <section className="mushaf-section">
          <p className="mushaf-section__title">المظهر</p>
          <div className="mushaf-seg">
            {MODES.map(({ id, label, Icon }) => (
              <button
                key={id}
                className="mushaf-seg__item"
                aria-pressed={mode === id}
                onClick={() => updatePrefs({ mode: id })}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mushaf-section">
          <p className="mushaf-section__title">القراءة</p>
          <div className="mushaf-fields">
            <label className="mushaf-field">
              <span className="mushaf-field__label">
                حجم الخط
                <span className="mushaf-field__value">{toArabicNumber(Math.round(prefs.readingScale * 100))}%</span>
              </span>
              <input
                className="mushaf-range"
                type="range"
                min={0.85}
                max={1.35}
                step={0.05}
                value={prefs.readingScale}
                onChange={(event) => updatePrefs({ readingScale: Number(event.target.value) })}
              />
            </label>

            <label className="mushaf-field">
              <span className="mushaf-field__label">
                تباعد السطور
                <span className="mushaf-field__value">{toArabicNumber(Math.round(prefs.lineSpacing * 100))}%</span>
              </span>
              <input
                className="mushaf-range"
                type="range"
                min={0.9}
                max={1.35}
                step={0.05}
                value={prefs.lineSpacing}
                onChange={(event) => updatePrefs({ lineSpacing: Number(event.target.value) })}
              />
            </label>

            <label className="mushaf-field">
              <span className="mushaf-field__label">
                مسافة الكلمات
                <span className="mushaf-field__value">{toArabicNumber(Math.round(prefs.wordSpacing * 100))}%</span>
              </span>
              <input
                className="mushaf-range"
                type="range"
                min={0}
                max={0.3}
                step={0.02}
                value={prefs.wordSpacing}
                onChange={(event) => updatePrefs({ wordSpacing: Number(event.target.value) })}
              />
            </label>
          </div>

          <button className="mushaf-reset" onClick={() => updatePrefs(DEFAULT_PREFS)}>
            إعادة الضبط
          </button>
        </section>
      </Sheet>

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
          <p className="mushaf-hint">{voiceHint}</p>

          {voiceEngaged && (
            <div className="mushaf-voice">
              <div className="mushaf-seg" role="group" aria-label="نطاق التلاوة">
                <button
                  className="mushaf-seg__item"
                  aria-pressed={voiceScope === 'ayah'}
                  onClick={() => handleVoiceScope('ayah')}
                >
                  <span>الآية</span>
                </button>
                <button
                  className="mushaf-seg__item"
                  aria-pressed={voiceScope === 'surah'}
                  onClick={() => handleVoiceScope('surah')}
                >
                  <span>السورة</span>
                </button>
              </div>

              <label className="mushaf-voice__reciter">
                <span>القارئ</span>
                <select
                  className="mushaf-select"
                  value={reciterId}
                  onChange={(event) => handleVoiceReciter(event.target.value)}
                >
                  {AUDIO_RECITERS.map((reciter) => (
                    <option key={reciter.id} value={reciter.id}>
                      {reciter.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mushaf-tools">
                <button
                  className="mushaf-tool"
                  onClick={replayVoice}
                  disabled={voicePhase !== 'ready'}
                >
                  إعادة
                </button>
                <button
                  className="mushaf-tool mushaf-tool--primary"
                  onClick={openVoice}
                  disabled={voicePrimaryDisabled}
                >
                  {voicePrimaryLabel}
                </button>
              </div>

              {voicePhase === 'error' && voiceError && (
                <p className="mushaf-hint" role="alert">
                  {voiceError}
                </p>
              )}
            </div>
          )}

          {/* Outside the choice on purpose: whichever button is taken, the element
              the recitation plays through already exists to be aimed at. Playing is
              the element's own word, not the click's: a seek, a stall or a system
              pause all move the transport without the code asking for it. The end
              event is the cut's backstop — the last ayah of a file reaches it
              before a final timeupdate can report that it stopped. */}
          <audio
            ref={voiceAudioRef}
            preload="auto"
            onPlay={() => setVoicePlaying(true)}
            onPause={() => setVoicePlaying(false)}
            onTimeUpdate={handleVoiceTime}
            onEnded={finishVoice}
          />
        </Sheet>
      )}

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

