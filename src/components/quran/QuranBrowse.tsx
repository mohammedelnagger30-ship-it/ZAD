import { Layers } from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import { toArabicNumber, TOTAL_QURAN_PAGES, type SurahMeta } from '@/data/surahs';

// Surah list item - Enhanced
export function SurahListItem({ surah, onOpen, onHifz }: { surah: SurahMeta; onOpen: () => void; onHifz: () => void }) {
  return (
    <Card className="p-4! transition-all duration-300 hover:-translate-y-1 hover:border-primary-400 hover:shadow-xl sm:p-5! group">
      <div className="flex items-center gap-4">
        <button
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl text-right outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 transition-colors hover:bg-primary-50/50 dark:hover:bg-primary-900/30 -mx-2 px-2 py-2"
        >
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-primary-200 bg-linear-to-br from-primary-50 to-primary-100 shadow-md dark:border-primary-700 dark:from-primary-800/80 dark:to-primary-900 group-hover:scale-110 transition-transform">
            <span className="text-lg font-bold text-primary-700 dark:text-gold-400">
              {toArabicNumber(surah.id)}
            </span>
            <div className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-gold-400 shadow-xs" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-1">
              <h3 className="text-lg font-bold text-primary-800 dark:text-primary-100">{surah.name}</h3>
              <Badge variant={surah.revelationType === 'meccan' ? 'gold' : 'primary'}>
                {surah.revelationType === 'meccan' ? 'مكية' : 'مدنية'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {surah.nameLatin}
            </p>
            <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-primary-400" />
                {toArabicNumber(surah.ayahCount)} آية
              </span>
              <span className="text-primary-300">·</span>
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
                صفحة {toArabicNumber(surah.pageStart)}
              </span>
            </div>
          </div>
        </button>
        <button
          onClick={onHifz}
          aria-label={`بدء الحفظ في سورة ${surah.name}`}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-gold-200 bg-linear-to-br from-gold-50 to-gold-100 px-3 text-sm font-bold text-gold-700 shadow-md transition-all duration-300 hover:scale-105 hover:border-gold-400 hover:shadow-lg dark:border-gold-800/60 dark:from-gold-900/25 dark:to-gold-900/40 dark:text-gold-300 dark:hover:border-gold-600"
          title={`وضع الحفظ - ${surah.name}`}
        >
          <Layers size={16} />
          <span>حفظ</span>
        </button>
      </div>
    </Card>
  );
}

// Page browser
export function PageBrowser({ onSelectPage }: { onSelectPage: (page: number) => void }) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {Array.from({ length: TOTAL_QURAN_PAGES }, (_, i) => i + 1).map((page) => (
        <button
          key={page}
          onClick={() => onSelectPage(page)}
          className="aspect-square rounded-lg bg-white dark:bg-primary-900/40 border border-primary-100 dark:border-primary-800 flex items-center justify-center text-sm font-medium text-primary-700 dark:text-primary-200 hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-800/40 transition-smooth"
        >
          {toArabicNumber(page)}
        </button>
      ))}
    </div>
  );
}
