import { Card, Badge } from '@/components/ui';
import { toArabicNumber, TOTAL_QURAN_PAGES, type SurahMeta } from '@/data/surahs';

/**
 * One surah, and the way into it.
 *
 * The card *is* the memorisation target: pressing anywhere on it opens that surah's
 * memorisation page. It used to open the reader instead and carry a small «حفظ» chip
 * beside itself for the memorisation page — two targets standing for two destinations,
 * which left the bigger and far more obvious of the two going to the less used of them.
 * One card, one destination; the counts stay in the card's own words so a screen reader
 * still hears what a sighted reader sees.
 */
export function SurahListItem({ surah, onOpen }: { surah: SurahMeta; onOpen: () => void }) {
  return (
    <Card className="p-4! transition-all duration-300 hover:-translate-y-1 hover:border-primary-400 hover:shadow-xl sm:p-5! group">
      <button
        onClick={onOpen}
        title={`حفظ — ${surah.name}`}
        className="flex w-full min-w-0 items-center gap-4 rounded-2xl text-right outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 transition-colors hover:bg-primary-50/50 dark:hover:bg-primary-900/30 -mx-2 px-2 py-2"
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
    </Card>
  );
}

// Page browser
export function PageBrowser({ onSelectPage }: { onSelectPage: (page: number) => void }) {
  return (
    <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 xl:grid-cols-16 gap-2">
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
