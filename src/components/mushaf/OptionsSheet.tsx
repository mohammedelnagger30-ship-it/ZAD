import type { RefObject } from 'react';
import { Sheet } from '@/components/mushaf/Sheet';
import {
  MODES,
  ORIENTATIONS,
  DEFAULT_PREFS,
  type MushafPrefs,
  type Orientation,
} from '@/components/mushaf/readerConfig';
import { toArabicNumber } from '@/data/surahs';

/**
 * How the mushaf is read: which way the sheets turn, day or night, and the three
 * knobs over the page itself. Every control writes through the reader’s own
 * `updatePrefs` — one writer keeps the saved preferences, the page and the chrome
 * agreeing — and orientation goes through `onOrientationChange` because swapping
 * the stack back on has work to do that a preference write alone cannot see.
 */
export interface OptionsSheetProps {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement>;
  prefs: MushafPrefs;
  updatePrefs: (patch: Partial<MushafPrefs>) => void;
  onOrientationChange: (next: Orientation) => void;
}

export function OptionsSheet({ open, onClose, panelRef, prefs, updatePrefs, onOrientationChange }: OptionsSheetProps) {
  const activeOrientation = ORIENTATIONS.find((o) => o.id === prefs.orientation) ?? ORIENTATIONS[0];

  return (
    <Sheet
      open={open}
      title="خيارات القراءة"
      onClose={onClose}
      panelRef={panelRef}
      darkSurface={prefs.mode === 'night'}
    >
      <section className="mushaf-section">
        <p className="mushaf-section__title">التنقّل</p>
        <div className="mushaf-seg">
          {ORIENTATIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className="mushaf-seg__item"
              aria-pressed={prefs.orientation === id}
              onClick={() => onOrientationChange(id)}
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
              aria-pressed={prefs.mode === id}
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
  );
}
