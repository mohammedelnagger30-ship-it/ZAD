import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui';
import { SURAHS, type SurahMeta } from '@/data/surahs';

interface ReaderNavigationProps {
  selectedSurah: SurahMeta;
  openSurah: (surah: SurahMeta) => void;
}

export function ReaderNavigation({ selectedSurah, openSurah }: ReaderNavigationProps) {
  return (
    <>
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const prevSurah = SURAHS.find((s) => s.id === selectedSurah.id - 1);
              if (prevSurah) openSurah(prevSurah);
            }}
            disabled={selectedSurah.id === 1}
          >
            <ChevronRight size={16} /> السورة السابقة
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              const nextSurah = SURAHS.find((s) => s.id === selectedSurah.id + 1);
              if (nextSurah) openSurah(nextSurah);
            }}
            disabled={selectedSurah.id === 114}
          >
            السورة التالية <ChevronLeft size={16} />
          </Button>
        </div>
    </>
  );
}
