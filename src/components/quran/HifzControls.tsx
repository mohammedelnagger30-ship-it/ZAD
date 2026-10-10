import { Eye, EyeOff, Layers } from 'lucide-react';
import { Card } from '@/components/ui';
import { type SurahMeta } from '@/data/surahs';

interface HifzControlsProps {
  isHifz: boolean;
  selectedSurah: SurahMeta;
  fromAyah: number;
  setFromAyah: (ayah: number) => void;
  toAyah: number | null;
  setToAyah: (ayah: number) => void;
  hideText: boolean;
  setHideText: (hide: boolean) => void;
  hideWordByWord: boolean;
  setHideWordByWord: (hide: boolean) => void;
}

export function HifzControls({
  isHifz,
  selectedSurah,
  fromAyah,
  setFromAyah,
  toAyah,
  setToAyah,
  hideText,
  setHideText,
  hideWordByWord,
  setHideWordByWord,
}: HifzControlsProps) {
  return (
    <>
        {/* Hifz mode controls */}
        {isHifz && (
          <Card className="bg-gold-50 dark:bg-gold-900/20 border-gold-200 dark:border-gold-800/40">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-gold-600 dark:text-gold-400" />
                <p className="text-sm font-semibold text-gold-800 dark:text-gold-300">خيارات الحفظ</p>
              </div>

              {/* Ayah range selection */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 dark:text-gray-300">من آية:</span>
                <input
                  type="number"
                  min={1}
                  max={selectedSurah.ayahCount}
                  value={fromAyah}
                  onChange={(e) => setFromAyah(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16 bg-white dark:bg-primary-900/60 border border-gold-200 dark:border-gold-800 rounded-lg py-1 px-2 text-sm text-center"
                />
                <span className="text-xs text-gray-600 dark:text-gray-300">إلى:</span>
                <input
                  type="number"
                  min={fromAyah}
                  max={selectedSurah.ayahCount}
                  value={toAyah ?? selectedSurah.ayahCount}
                  onChange={(e) => setToAyah(parseInt(e.target.value) || selectedSurah.ayahCount)}
                  className="w-16 bg-white dark:bg-primary-900/60 border border-gold-200 dark:border-gold-800 rounded-lg py-1 px-2 text-sm text-center"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setHideText(!hideText)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-smooth ${
                    hideText
                      ? 'bg-gold-500 text-white'
                      : 'bg-white dark:bg-primary-900/60 text-gray-600 dark:text-gray-300 border border-gold-200 dark:border-gold-800'
                  }`}
                >
                  {hideText ? <EyeOff size={16} /> : <Eye size={16} />}
                  {hideText ? 'إظهار النص' : 'إخفاء النص'}
                </button>
                <button
                  onClick={() => setHideWordByWord(!hideWordByWord)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-smooth ${
                    hideWordByWord
                      ? 'bg-gold-500 text-white'
                      : 'bg-white dark:bg-primary-900/60 text-gray-600 dark:text-gray-300 border border-gold-200 dark:border-gold-800'
                  }`}
                >
                  {hideWordByWord ? <EyeOff size={16} /> : <Eye size={16} />}
                  إخفاء كلمة بكلمة
                </button>
              </div>
            </div>
          </Card>
        )}
    </>
  );
}
