import { ChevronRight, Type } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

interface ReaderHeaderProps {
  setViewMode: (mode: 'list' | 'reader' | 'hifz' | 'mushaf') => void;
  isHifz: boolean;
  setFontSize: Dispatch<SetStateAction<number>>;
}

export function ReaderHeader({ setViewMode, isHifz, setFontSize }: ReaderHeaderProps) {
  return (
    <>
        {/* Header */}
        <div className="flex items-center justify-between sticky top-0 z-30 bg-surface-light dark:bg-surface-dark/95 backdrop-blur-lg py-2 -mx-4 px-4 border-b border-primary-100 dark:border-primary-800/30">
          <button onClick={() => setViewMode('list')} className="flex items-center gap-1 text-primary-600 dark:text-gold-400">
            <ChevronRight size={20} />
            <span className="text-sm">رجوع</span>
          </button>
          <div className="text-center">
            <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">مصحف Sakinah</h2>
            {isHifz && <p className="text-xs text-gold-600 dark:text-gold-400">وضع الحفظ</p>}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFontSize((s) => Math.max(18, s - 2))}
              className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-700 dark:text-primary-200"
              title="تصغير الخط"
            >
              <Type size={16} />
              <span className="text-xs mr-0.5">-</span>
            </button>
            <button
              onClick={() => setFontSize((s) => Math.min(48, s + 2))}
              className="w-8 h-8 rounded-lg bg-primary-100 dark:bg-primary-800 flex items-center justify-center text-primary-700 dark:text-primary-200"
              title="تكبير الخط"
            >
              <Type size={16} />
              <span className="text-xs mr-0.5">+</span>
            </button>
          </div>
        </div>
    </>
  );
}
