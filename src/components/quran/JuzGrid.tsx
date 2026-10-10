import { Card } from '@/components/ui';
import { JUZ_INFO, toArabicNumber } from '@/data/surahs';

interface JuzGridProps {
  openJuz: (juzId: number) => void;
}

export function JuzGrid({ openJuz }: JuzGridProps) {
  return (
    <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {JUZ_INFO.map((juz) => (
              <Card
                key={juz.id}
                onClick={() => openJuz(juz.id)}
                className="p-4! hover:border-primary-400 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer group"
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-primary-100 to-primary-200 dark:from-primary-800 dark:to-primary-900 shadow-md group-hover:scale-110 transition-transform">
                    <span className="text-xl font-bold text-primary-700 dark:text-gold-400">
                      {toArabicNumber(juz.id)}
                    </span>
                    <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-gold-400 shadow-xs" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-primary-800 dark:text-primary-100 mb-1">{juz.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      صفحة {toArabicNumber(juz.startPage)}-{toArabicNumber(juz.endPage)}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
    </>
  );
}
