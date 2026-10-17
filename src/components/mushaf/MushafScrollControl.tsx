import { ArrowDown, Pause, Play } from 'lucide-react';
import { toArabicNumber } from '@/data/surahs';

interface MushafScrollControlProps {
  active: boolean;
  speed: number;
  onToggle: () => void;
  onSpeedChange: (speed: number) => void;
}

export function MushafScrollControl({
  active,
  speed,
  onToggle,
  onSpeedChange,
}: MushafScrollControlProps) {
  return (
    <aside className="mushaf-scroll-control" aria-label="التمرير التلقائي">
      <button
        className="mushaf-scroll-control__toggle"
        type="button"
        onClick={onToggle}
        aria-label={active ? 'إيقاف التمرير التلقائي' : 'تشغيل التمرير التلقائي'}
        aria-pressed={active}
        title={active ? 'إيقاف التمرير التلقائي' : 'تشغيل التمرير التلقائي'}
      >
        {active ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <div className="mushaf-scroll-control__speed">
        <ArrowDown size={14} aria-hidden="true" />
        <input
          className="mushaf-scroll-control__range"
          type="range"
          min={10}
          max={80}
          step={5}
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          aria-label="سرعة التمرير التلقائي"
          aria-valuetext={`${toArabicNumber(speed)} بكسل في الثانية`}
          title="اضبط سرعة نزول الصفحة"
        />
        <span aria-hidden="true">{toArabicNumber(speed)}</span>
      </div>
    </aside>
  );
}
