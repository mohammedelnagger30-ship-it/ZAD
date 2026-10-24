import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Baby,
  BookText,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Hand,
  Heart,
  Landmark,
  MessageCircle,
  Moon,
  Pause,
  Play,
  Plane,
  Shirt,
  Sparkles,
  Sun,
  Utensils,
  Users,
  X,
  BookOpen,
} from 'lucide-react';
import { SUNNAH_CATEGORIES, type SunnahCategory, type SunnahItem } from '@/data/sunnah';
import { SunnahArt, SunnahMandala, type SunnahArtId } from '@/components/sunnah/SunnahArt';

/**
 * Turns a citation like «نص الحديث...» (مسلم) into a search query for the hadith screen.
 * The source in parentheses is dropped, and the whole quoted fragment is kept (capped so a
 * long narration cannot turn into an impossible query): the hadith screen trims the terms
 * one by one when nothing matches, and ranks candidates on the full quote.
 */
function hadithSearchQuery(evidence: string): string {
  const quoted = evidence.match(/«([^»]+)»/)?.[1] ?? evidence.replace(/\([^)]*\)/g, ' ');
  const words = quoted
    // Quoting marks and pauses belong to the citation, not to the words being cited:
    // "تحزن،" would otherwise be a term nothing contains, and the search for the quote
    // would fall straight through to its fallbacks even though the hadith is installed.
    .replace(/[«»"'،,؛;:!?؟.…]+/g, ' ')
    .replace(/\.{3,}|…/g, ' ') // an ellipsis stands for omitted words, not text to match
    .split(/\s+/)
    .filter((word) => word.length > 1);
  return words.slice(0, 8).join(' ');
}

type Nav = (screen: string, params?: Record<string, unknown>) => void;

/** The rail's icons: names come from the data so it stays free of JSX imports. */
const ICONS: Record<string, typeof BookOpen> = {
  Sun, Moon, Shirt, Utensils, MessageCircle, Users, Hand, Heart, Droplets, Baby, Plane, Landmark,
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts up once on mount, or jumps straight to the total for a reader who asked for stillness. */
function useCountUp(target: number, ms = 1400) {
  const [n, setN] = useState(target);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    setN(0);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return n;
}

/* -------------------------------------------------------------------------- */
/* One narration, layered: the practice, its occasion, its proof, its benefit. */
/* -------------------------------------------------------------------------- */

function SunnahCard({
  item,
  index,
  navigate,
  highlight = false,
}: {
  item: SunnahItem;
  index: number;
  navigate: Nav;
  /** The card a notification deep link landed on — ringed so the reader sees it at once. */
  highlight?: boolean;
}) {
  const query = hadithSearchQuery(item.evidence);
  const delay = `${Math.min(index, 7) * 60}ms`;

  return (
    <article
      className={`animate-stagger-in relative overflow-hidden rounded-2xl border bg-white p-4 transition-smooth hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-lg hover:shadow-primary-500/10 dark:bg-primary-950/40 dark:hover:border-primary-600 ${
        highlight
          ? 'border-gold-400 ring-2 ring-gold-400/70 dark:border-gold-500'
          : 'border-primary-100 dark:border-primary-800'
      }`}
      style={{ animationDelay: delay }}
    >
      {/* The accent rule that draws itself down the card's edge as the card arrives. */}
      <span
        className="animate-scale-in absolute inset-y-0 right-0 w-[3px] bg-gradient-to-b from-gold-400 via-primary-400 to-transparent"
        style={{ animationDelay: delay, transformOrigin: 'top' }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-primary-800 dark:text-primary-100 leading-relaxed">{item.title}</h3>
        {item.grade && (
          <span className="shrink-0 mt-0.5 rounded-full bg-primary-50 dark:bg-primary-900/70 px-2.5 py-0.5 text-[0.62rem] font-bold text-primary-700 dark:text-gold-300 animate-scale-in">
            {item.grade}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{item.text}</p>

      {item.mawqif && (
        <div className="animate-slide-up mt-3 rounded-xl border-r-[3px] border-gold-400/70 bg-gold-50/60 dark:bg-gold-900/15 p-3">
          <span className="mb-1 block text-[0.62rem] font-bold text-gold-700 dark:text-gold-300">الواقعة</span>
          <p className="text-xs leading-relaxed text-gray-700 dark:text-gray-200">{item.mawqif}</p>
        </div>
      )}

      {query ? (
        <button
          type="button"
          title="عرض الحديث في صفحة الأحاديث"
          onClick={() => navigate('hadith', { query })}
          className="group mt-3 flex w-full items-start gap-2 rounded-lg bg-primary-50/70 dark:bg-primary-900/40 p-2.5 text-right transition-smooth hover:bg-primary-100 dark:hover:bg-primary-900/70"
        >
          <BookText size={14} className="mt-0.5 shrink-0 text-primary-500 dark:text-gold-400 transition-smooth group-hover:scale-110" />
          <span className="text-xs italic leading-relaxed text-primary-700 dark:text-primary-200 group-hover:text-primary-900 dark:group-hover:text-gold-300">
            {item.evidence}
          </span>
        </button>
      ) : (
        <p className="mt-3 text-xs italic text-gray-500 dark:text-gray-400">{item.evidence}</p>
      )}

      {item.benefit && (
        <div className="mt-3 flex gap-2">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-emerald-500" />
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">{item.benefit}</p>
        </div>
      )}

      {item.note && (
        <p className="mt-2 border-t border-dashed border-primary-100 dark:border-primary-800 pt-2 text-xs text-primary-600 dark:text-gold-400">
          ملاحظة: {item.note}
        </p>
      )}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Story playback: one narration at a time, a segment per narration, tap to    */
/* move and a bar that fills on its own — the page's answer to "something that */
/* moves" without a video file the CSP would block anyway.                     */
/* -------------------------------------------------------------------------- */

const STORY_MS = 9000;

function StoryViewer({ cat, onClose, navigate }: { cat: SunnahCategory; onClose: () => void; navigate: Nav }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const remainRef = useRef(STORY_MS);
  const startRef = useRef(Date.now());
  const item = cat.items[i];

  const goTo = useCallback(
    (next: number) => {
      if (next < 0) return;
      if (next >= cat.items.length) {
        onClose();
        return;
      }
      remainRef.current = STORY_MS;
      startRef.current = Date.now();
      setI(next);
    },
    [cat.items.length, onClose],
  );

  useEffect(() => {
    if (paused) return;
    const id = setTimeout(() => goTo(i + 1), remainRef.current);
    return () => clearTimeout(id);
  }, [i, paused, goTo]);

  const togglePause = useCallback(() => {
    if (paused) {
      remainRef.current = Math.max(250, remainRef.current);
      startRef.current = Date.now();
      setPaused(false);
    } else {
      remainRef.current = Math.max(250, remainRef.current - (Date.now() - startRef.current));
      setPaused(true);
    }
  }, [paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goTo(i + 1);
      else if (e.key === 'ArrowRight') goTo(i - 1);
      else if (e.key === ' ') {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [i, goTo, onClose, togglePause]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-primary-950 animate-fade-in" dir="rtl">
      {/* Segment per narration: past ones full, current one filling, future ones empty. */}
      <div className="flex gap-1 px-3 pt-3">
        {cat.items.map((_, j) => (
          <div key={j} className="h-1 flex-1 overflow-hidden rounded-full bg-primary-100 dark:bg-primary-800">
            {j === i && (
              <div
                key={i}
                className="h-full w-full origin-right animate-fill-bar rounded-full bg-gradient-to-l from-gold-400 to-primary-500"
                style={{
                  animationDuration: `${STORY_MS}ms`,
                  animationPlayState: paused ? 'paused' : 'running',
                }}
              />
            )}
            {j < i && <div className="h-full w-full rounded-full bg-primary-400 dark:bg-gold-500" />}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 py-2">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-full bg-primary-50 dark:bg-primary-900/60 px-3 py-1.5 text-xs font-bold text-primary-700 dark:text-primary-200 transition-smooth hover:bg-primary-100"
        >
          <X size={14} /> إغلاق
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {i + 1} / {cat.items.length} · {cat.title}
        </span>
        <button
          onClick={togglePause}
          aria-label={paused ? 'تشغيل' : 'إيقاف'}
          className="rounded-full bg-primary-50 dark:bg-primary-900/60 p-2 text-primary-700 dark:text-primary-200 transition-smooth hover:bg-primary-100"
        >
          {paused ? <Play size={14} /> : <Pause size={14} />}
        </button>
      </div>

      {/* Tap zones live on the content itself, not as overlays: an overlay would have to
          sit above the narration, and would swallow the taps meant for the link inside it.
          Controls are exempt so their own handlers run instead of stepping the story. */}
      <div
        className="flex-1 overflow-y-auto px-4 pb-6"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          // RTL reads right-to-left, so the left half is where "forward" lives.
          if (e.clientX < window.innerWidth / 2) goTo(i + 1);
          else goTo(i - 1);
        }}
      >
        <div key={i} className="animate-stagger-in mx-auto max-w-xl">
          <div className="mx-auto mt-4 h-32 w-32 text-primary-500 dark:text-gold-400">
            <SunnahArt art={cat.id as SunnahArtId} uid={`story-${cat.id}`} />
          </div>

          <div className="mt-4 flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">{item.title}</h2>
            {item.grade && (
              <span className="mt-1 shrink-0 rounded-full bg-primary-50 dark:bg-primary-900/70 px-2.5 py-0.5 text-[0.65rem] font-bold text-primary-700 dark:text-gold-300">
                {item.grade}
              </span>
            )}
          </div>

          <p className="mt-3 text-base leading-loose text-gray-800 dark:text-gray-100">{item.text}</p>

          {item.mawqif && (
            <div className="mt-4 rounded-2xl border-r-[3px] border-gold-400/70 bg-gold-50/60 dark:bg-gold-900/15 p-4">
              <span className="mb-1 block text-xs font-bold text-gold-700 dark:text-gold-300">الواقعة</span>
              <p className="text-sm leading-loose text-gray-700 dark:text-gray-200">{item.mawqif}</p>
            </div>
          )}

          <button
            type="button"
            title="عرض الحديث في صفحة الأحاديث"
            onClick={(e) => {
              e.stopPropagation();
              navigate('hadith', { query: hadithSearchQuery(item.evidence) });
            }}
            className="mt-4 flex w-full items-start gap-2 rounded-xl bg-primary-50/70 dark:bg-primary-900/40 p-3 text-right transition-smooth hover:bg-primary-100"
          >
            <BookText size={15} className="mt-0.5 shrink-0 text-primary-500 dark:text-gold-400" />
            <span className="text-sm italic leading-relaxed text-primary-700 dark:text-primary-200">{item.evidence}</span>
          </button>

          {item.benefit && (
            <div className="mt-4 flex gap-2">
              <Sparkles size={15} className="mt-1 shrink-0 text-emerald-500" />
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{item.benefit}</p>
            </div>
          )}

          {item.note && <p className="mt-3 text-sm text-primary-600 dark:text-gold-400">ملاحظة: {item.note}</p>}

          <p className="mt-6 text-center text-[0.65rem] text-gray-400 dark:text-gray-500">
            اضغط على النصف الأيسر للتقدم · الأيمن للرجوع · أو المسافة للإيقاف
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-primary-100 dark:border-primary-800 px-4 py-3">
        <button
          onClick={() => goTo(i - 1)}
          disabled={i === 0}
          className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-bold text-primary-700 dark:text-primary-200 transition-smooth hover:bg-primary-50 disabled:opacity-30"
        >
          <ChevronRight size={16} /> السابق
        </button>
        <div className="flex gap-1.5">
          {cat.items.map((_, j) => (
            <span
              key={j}
              className={`h-1.5 rounded-full transition-smooth ${
                j === i ? 'w-5 bg-primary-500 dark:bg-gold-400' : 'w-1.5 bg-primary-200 dark:bg-primary-700'
              }`}
            />
          ))}
        </div>
        <button
          onClick={() => goTo(i + 1)}
          className="flex items-center gap-1 rounded-full bg-primary-500 px-4 py-2 text-sm font-bold text-white transition-smooth hover:bg-primary-600"
        >
          التالي <ChevronLeft size={16} />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface SunnahScreenProps {
  navigate: Nav;
  /** Deep links: a notification opens its own section and lands on the narration it announced. */
  params?: Record<string, unknown>;
}

export default function SunnahScreen({ navigate, params }: SunnahScreenProps) {
  const deepLinkCategoryId = typeof params?.categoryId === 'string' ? params.categoryId : null;
  const deepLinkItemTitle = typeof params?.itemTitle === 'string' ? params.itemTitle : null;
  const [selected, setSelected] = useState(() =>
    deepLinkCategoryId && SUNNAH_CATEGORIES.some((category) => category.id === deepLinkCategoryId)
      ? deepLinkCategoryId
      : SUNNAH_CATEGORIES[0].id,
  );
  const [story, setStory] = useState<SunnahCategory | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // The narration a notification announced, in the section it belongs to. Titles are
  // the only stable key a narration has, and they are unique within a section.
  const deepLinkTarget = useMemo(() => {
    if (!deepLinkCategoryId || !deepLinkItemTitle) return null;
    const category = SUNNAH_CATEGORIES.find((candidate) => candidate.id === deepLinkCategoryId);
    if (!category) return null;
    const index = category.items.findIndex((item) => item.title === deepLinkItemTitle);
    return index < 0 ? null : { categoryId: category.id, index };
  }, [deepLinkCategoryId, deepLinkItemTitle]);

  useEffect(() => {
    if (!deepLinkTarget) return;
    // The list is rebuilt when the section renders, so the anchor only exists after
    // the next paint.
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`sunnah-item-${deepLinkTarget.categoryId}-${deepLinkTarget.index}`)
        ?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, [deepLinkTarget]);

  const total = SUNNAH_CATEGORIES.reduce((sum, c) => sum + c.items.length, 0);
  const shown = useCountUp(total);
  const cat = SUNNAH_CATEGORIES.find((c) => c.id === selected) ?? SUNNAH_CATEGORIES[0];
  const Icon = ICONS[cat.icon] ?? BookOpen;

  const pick = (id: string) => {
    setSelected(id);
    contentRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const rail = railRef.current;
    const idx = SUNNAH_CATEGORIES.findIndex((c) => c.id === id);
    const btn = rail?.children[idx] as HTMLElement | undefined;
    btn?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <div className="pb-8" dir="rtl">
      {/* ---- banner ---------------------------------------------------- */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-bl from-primary-600 via-primary-700 to-primary-900 p-6 text-white">
        <span className="absolute -left-10 -top-10 h-36 w-36 rounded-full bg-gold-400/20 blur-2xl animate-float" aria-hidden="true" />
        <span className="absolute -bottom-12 right-8 h-32 w-32 rounded-full bg-emerald-400/20 blur-2xl animate-float-slow" aria-hidden="true" />
        <SunnahMandala
          uid="sunnah-hero"
          className="pointer-events-none absolute -left-8 top-1/2 h-56 w-56 -translate-y-1/2 text-gold-300/30"
        />

        <div className="relative">
          <p className="animate-slide-down text-[0.7rem] font-bold uppercase tracking-widest text-gold-300/90">
            سنن عن النبي ﷺ
          </p>
          <h1 className="animate-slide-up mt-1.5 text-2xl font-extrabold leading-snug">
            {SUNNAH_CATEGORIES.length} قسمًا
            <span className="mx-2 inline-block text-gold-300 animate-pulse-soft">{shown}</span>
            سنة وواقعة
          </h1>
          <p className="animate-slide-up mt-2 max-w-sm text-sm leading-relaxed text-white/80" style={{ animationDelay: '120ms' }}>
            كل سنة في مكانها: النص، والواقعة اللي وقعت فيها، والدليل، والفائدة. اضغط قسمًا لتقرأه، أو شغّله ليعبرك واحدًا واحدًا.
          </p>

          <button
            onClick={() => setStory(cat)}
            className="animate-scale-in mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-primary-800 shadow-lg shadow-primary-900/40 transition-smooth hover:scale-105 active:scale-95"
          >
            <Play size={15} className="fill-gold-500 text-gold-500" />
            شغّل «{cat.title}»
          </button>
        </div>
      </header>

      {/* ---- horizontal rail: categories side by side, not stacked ------- */}
      <div className="mt-5">
        <div
          ref={railRef}
          className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2"
          role="tablist"
          aria-label="أقسام السنن"
        >
          {SUNNAH_CATEGORIES.map((c) => {
            const active = c.id === selected;
            return (
              <button
                key={c.id}
                role="tab"
                aria-selected={active}
                onClick={() => pick(c.id)}
                className={`w-40 shrink-0 snap-center rounded-2xl border p-3 text-right transition-smooth ${
                  active
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/60 shadow-lg shadow-primary-500/15'
                    : 'border-primary-100 dark:border-primary-800 bg-white dark:bg-primary-950/40 hover:-translate-y-1 hover:border-primary-300'
                }`}
              >
                <div
                  className={`mx-auto h-16 w-16 transition-smooth ${active ? 'text-primary-600 dark:text-gold-400' : 'text-primary-400 dark:text-primary-500'}`}
                >
                  <SunnahArt art={c.id as SunnahArtId} uid={`rail-${c.id}`} />
                </div>
                <span className="mt-2 block truncate text-[0.8rem] font-bold text-primary-800 dark:text-primary-100">
                  {c.title}
                </span>
                <span className="mt-0.5 flex items-center justify-between text-[0.62rem] text-gray-500 dark:text-gray-400">
                  <span className="truncate">{c.subtitle}</span>
                  <span className="ms-1 shrink-0 rounded-full bg-primary-100 dark:bg-primary-800 px-1.5 py-px font-bold text-primary-700 dark:text-primary-200">
                    {c.items.length}
                  </span>
                </span>
                <span className="mt-2 flex gap-1" aria-hidden="true">
                  {Array.from({ length: 4 }, (_, k) => (
                    <span
                      key={k}
                      className={`h-1 flex-1 rounded-full transition-smooth ${
                        active ? 'bg-primary-500 dark:bg-gold-400' : 'bg-primary-100 dark:bg-primary-800'
                      }`}
                      style={{ opacity: active ? 1 - k * 0.2 : 1 }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- the selected category -------------------------------------- */}
      <div ref={contentRef} className="scroll-mt-4">
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-gradient-to-l from-primary-50 to-gold-50/50 dark:from-primary-900/40 dark:to-primary-950 p-4">
          <div className="h-14 w-14 shrink-0 text-primary-600 dark:text-gold-400 animate-float">
            <SunnahArt art={cat.id as SunnahArtId} uid={`panel-${cat.id}`} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-2 font-extrabold text-primary-800 dark:text-primary-100">
              <Icon size={18} className="shrink-0 text-primary-500 dark:text-gold-400" />
              {cat.title}
            </h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{cat.subtitle}</p>
          </div>
          <button
            onClick={() => setStory(cat)}
            className="shrink-0 rounded-full bg-primary-600 p-2.5 text-white transition-smooth hover:scale-110 active:scale-95"
            aria-label={`تشغيل ${cat.title}`}
          >
            <Play size={16} className="fill-white" />
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {cat.items.map((item, idx) => (
            <div
              key={`${cat.id}-${idx}`}
              id={`sunnah-item-${cat.id}-${idx}`}
              className="scroll-mt-24"
            >
              <SunnahCard
                item={item}
                index={idx}
                navigate={navigate}
                highlight={deepLinkTarget?.categoryId === cat.id && deepLinkTarget.index === idx}
              />
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <ArrowLeft size={13} />
          <span>اكتمل {cat.items.length} من {total} · تصفّح بقية الأقسام من الشريط أعلاه</span>
          <ArrowRight size={13} />
        </div>
      </div>

      {story && <StoryViewer cat={story} onClose={() => setStory(null)} navigate={navigate} />}
    </div>
  );
}
