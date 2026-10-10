import { useMemo } from 'react';
import type { RefObject } from 'react';
import { Sheet } from '@/components/mushaf/Sheet';
import { JUMP_TABS, type JumpTarget } from '@/components/mushaf/readerConfig';
import { SURAHS, JUZ_INFO, toArabicNumber, getSurahsForPage } from '@/data/surahs';
import { HIZB_INFO } from '@/data/mushafPages';

/**
 * The way into the mushaf: four targets (surah, juz, hizb, page) over one sheet.
 *
 * Everything here is chosen rather than typed — the grids mark what the reader is
 * standing on with `aria-current`, and the form stays for the one caller who knows
 * the page number already. The reader keeps the state and the effect that scrolls
 * the panel to the current item; this component only draws and reports.
 */
export interface JumpSheetProps {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement>;
  jumpTarget: JumpTarget;
  setJumpTarget: (target: JumpTarget) => void;
  pageField: string;
  setPageField: (value: string) => void;
  totalPages: number;
  currentPage: number;
  goToPage: (page: number) => void;
  bookmarkedPages: Set<number>;
  /** Which surahs this page carries, and where the page sits in the parts. */
  surahsOnPage: ReturnType<typeof getSurahsForPage>;
  currentJuz: number;
  currentHizb: number;
}

export function JumpSheet({
  open,
  onClose,
  panelRef,
  jumpTarget,
  setJumpTarget,
  pageField,
  setPageField,
  totalPages,
  currentPage,
  goToPage,
  bookmarkedPages,
  surahsOnPage,
  currentJuz,
  currentHizb,
}: JumpSheetProps) {
  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  return (
    <Sheet
      open={open}
      title="انتقال إلى"
      onClose={onClose}
      panelRef={panelRef}
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
  );
}
