import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Check,
  Loader2,
  BookText,
  BookOpen,
  HardDrive,
  Trash2,
  AlertTriangle,
  WifiOff,
} from 'lucide-react';
import { Card, Badge } from '@/components/ui';
import {
  formatBytes,
  HADITH_BOOKS,
  HADITH_OF_DAY_BOOK,
  TAFSIR_EDITIONS,
  type HadithBook,
  type TafsirEdition,
} from '@/data/contentCatalog';
import { downloadTafsirEdition, deleteTafsirEdition } from '@/utils/tafsirService';
import { downloadHadithCollection, deleteHadithCollection } from '@/utils/hadithService';
import { removeAll } from '@/utils/contentStore';
import { toArabicNumber, TOTAL_QURAN_AYAHS } from '@/data/surahs';
import { useHadithBookStatus, useInstalledContent, useTafsirEditionStatus } from '@/hooks/useContent';
import { AudioDownloadManager } from '@/components/AudioDownloadManager';

/** Progress of one running download, keyed by content id. */
interface Progress {
  percent: number;
  label: string;
}

export function ContentLibrary({ showTitle = true }: { showTitle?: boolean } = {}) {
  const installed = useInstalledContent();
  const tafsirStatus = useTafsirEditionStatus(installed.tafsir);
  const hadithStatus = useHadithBookStatus(installed.hadith);

  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmHeavy, setConfirmHeavy] = useState<string | null>(null);

  // Downloads are aborted if the screen goes away, so a 85 MB tafsir does not keep
  // running in the background after the user navigates off.
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const inFlight = controllers.current;
    return () => {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    };
  }, []);

  const report = useCallback((id: string, percent: number, label: string) => {
    setProgress((prev) => ({ ...prev, [id]: { percent, label } }));
  }, []);

  const finish = useCallback((id: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    controllers.current.delete(id);
  }, []);

  const fail = useCallback((id: string, message: string) => {
    setProgress((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setErrors((prev) => ({ ...prev, [id]: message }));
    controllers.current.delete(id);
  }, []);

  const startTafsir = useCallback(
    async (edition: TafsirEdition) => {
      const controller = new AbortController();
      controllers.current.set(edition.id, controller);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[edition.id];
        return next;
      });
      try {
        await downloadTafsirEdition(
          edition.id,
          (p) => {
            const percent = Math.round((p.done / Math.max(1, p.total)) * 100);
            report(
              edition.id,
              percent,
              `سورة ${p.surah} — ${formatBytes(p.bytesDone)} من ${formatBytes(p.bytesTotal)}`,
            );
          },
          controller.signal,
        );
        finish(edition.id);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        fail(edition.id, (err as Error).message);
      }
    },
    [report, finish, fail],
  );

  const startHadith = useCallback(
    async (book: HadithBook) => {
      const controller = new AbortController();
      controllers.current.set(book.id, controller);
      setErrors((prev) => {
        const next = { ...prev };
        delete next[book.id];
        return next;
      });
      try {
        await downloadHadithCollection(
          book.id,
          (p) => {
            const percent = p.total > 0 ? Math.round((p.received / p.total) * 100) : 0;
            report(book.id, percent, `${formatBytes(p.received)} من ${formatBytes(p.total)}`);
          },
          controller.signal,
        );
        finish(book.id);
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        fail(book.id, (err as Error).message);
      }
    },
    [report, finish, fail],
  );

  const cancel = (id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setProgress((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const quotaText =
    installed.storage.quota > 0
      ? `${formatBytes(installed.storage.used)} مستخدم من ${formatBytes(installed.storage.quota)} متاح للجهاز`
      : `${formatBytes(installed.storage.used)} على الجهاز`;

  const anythingInstalled =
    installed.hadith.size > 0 ||
    Object.values(installed.tafsir).some((s) => s.size > 0) ||
    Object.values(installed.audio).some((surahs) => surahs.size > 0);

  return (
    <div className="space-y-5 pb-4">
      <div className="flex items-center justify-between">
        {showTitle ? (
          <h1 className="text-2xl font-bold text-primary-800 dark:text-primary-100">
            مكتبة المحتوى
          </h1>
        ) : (
          <span />
        )}
        <HardDrive size={28} className="text-primary-600 dark:text-gold-400" />
      </div>

      {/* Storage summary */}
      <Card className="bg-primary-50 dark:bg-primary-800/20">
        <div className="flex items-start gap-3">
          <HardDrive size={24} className="text-primary-600 dark:text-gold-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-200">
              {quotaText}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
              المصحف كامل موجود داخل البرنامج. التفاسير والأحاديث والتلاوات تُحمَّل مرة واحدة فقط، وبعدها
              تعمل بدون إنترنت.
            </p>
            {anythingInstalled && (
              <button
                onClick={() => {
                  if (confirm('حذف كل التفاسير والأحاديث والتلاوات المحمّلة؟')) void removeAll();
                }}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-error-50 dark:bg-error-900/20 text-error-600 dark:text-error-300 rounded-lg text-xs font-medium hover:bg-error-100 dark:hover:bg-error-900/40 transition-smooth"
              >
                <Trash2 size={14} />
                حذف كل المحتوى المحمّل
              </button>
            )}
          </div>
        </div>
      </Card>

      <AudioDownloadManager />

      {/* ---- Tafsir ---- */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-primary-600 dark:text-gold-400" />
          <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">التفاسير</h2>
        </div>

        {TAFSIR_EDITIONS.map((edition) => {
          const status = tafsirStatus.find((s) => s.editionId === edition.id);
          const running = progress[edition.id];
          const error = errors[edition.id];
          const complete = status?.complete ?? false;
          const partial = (status?.surahs.size ?? 0) > 0 && !complete;

          return (
            <Card key={edition.id}>
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    complete
                      ? 'bg-success-100 dark:bg-success-900/30'
                      : 'bg-primary-100 dark:bg-primary-800'
                  }`}
                >
                  {running ? (
                    <Loader2 size={22} className="text-primary-600 dark:text-gold-400 animate-spin" />
                  ) : complete ? (
                    <Check size={22} className="text-success-600 dark:text-success-400" />
                  ) : (
                    <BookOpen size={22} className="text-primary-600 dark:text-gold-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-bold text-primary-800 dark:text-primary-100 text-base">
                      {edition.titleAr}
                    </h3>
                    {complete && <Badge variant="success">كامل</Badge>}
                    {partial && (
                      <Badge variant="warning">{status?.surahs.size} سورة</Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{edition.authorAr}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">
                    {edition.blurb}
                  </p>
                  <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
                    <span className="text-gray-400 dark:text-gray-500">
                      {formatBytes(edition.totalBytes)}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500">
                      {toArabicNumber(edition.ayahs)} آية
                    </span>
                    {edition.ayahs < TOTAL_QURAN_AYAHS && (
                      <span className="text-gray-400 dark:text-gray-500">
                        ميسّر — لا يشرح كل الآيات
                      </span>
                    )}
                  </div>

                  {/* Byte progress for a partially downloaded edition */}
                  {partial && !running && (
                    <div className="mt-2 h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-warning-500"
                        style={{ width: `${Math.round((status?.byteFraction ?? 0) * 100)}%` }}
                      />
                    </div>
                  )}

                  {running && (
                    <div className="mt-3">
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 transition-all duration-200"
                          style={{ width: `${running.percent}%` }}
                        />
                      </div>
                      <p className="text-xs text-primary-600 dark:text-gold-400 mt-1">
                        {running.label} ({running.percent}%)
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className="mt-2 flex items-start gap-1.5 text-error-600 dark:text-error-300">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span className="text-xs">{error}</span>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    {running ? (
                      <button
                        onClick={() => cancel(edition.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-sm font-medium transition-smooth"
                      >
                        إيقاف
                      </button>
                    ) : complete ? (
                      <button
                        onClick={() => {
                          if (confirm(`حذف ${edition.titleAr} من الجهاز؟`)) {
                            void deleteTafsirEdition(edition.id);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-smooth"
                      >
                        <Trash2 size={15} />
                        حذف
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          // Anything past ~40 MB deserves a confirmation: on a phone that is
                          // a real amount of the user's data.
                          if (edition.weight === 'heavy' && confirmHeavy !== edition.id) {
                            setConfirmHeavy(edition.id);
                            return;
                          }
                          setConfirmHeavy(null);
                          void startTafsir(edition);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-smooth"
                      >
                        <Download size={16} />
                        {partial ? 'إكمال التحميل' : 'تحميل'}
                      </button>
                    )}

                    {confirmHeavy === edition.id && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-warning-700 dark:text-warning-300">
                        <AlertTriangle size={14} />
                        {formatBytes(edition.totalBytes)} — تأكد من باقتك
                        <button
                          onClick={() => setConfirmHeavy(null)}
                          className="underline hover:no-underline"
                        >
                          إلغاء
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </section>

      {/* ---- Hadith ---- */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BookText size={20} className="text-primary-600 dark:text-gold-400" />
          <h2 className="text-lg font-bold text-primary-800 dark:text-primary-100">
            كتب الحديث
          </h2>
        </div>

        {/* The default collection leads the list; everything else keeps its catalogue
            order (cheapest download first) behind it. */}
        {[
          ...HADITH_BOOKS.filter((b) => b.id === HADITH_OF_DAY_BOOK),
          ...HADITH_BOOKS.filter((b) => b.id !== HADITH_OF_DAY_BOOK),
        ].map((book) => {
          const status = hadithStatus.find((s) => s.bookId === book.id);
          const running = progress[book.id];
          const error = errors[book.id];
          const isInstalled = status?.installed ?? false;

          return (
            <Card key={book.id}>
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                    isInstalled
                      ? 'bg-success-100 dark:bg-success-900/30'
                      : 'bg-primary-100 dark:bg-primary-800'
                  }`}
                >
                  {running ? (
                    <Loader2 size={22} className="text-primary-600 dark:text-gold-400 animate-spin" />
                  ) : isInstalled ? (
                    <Check size={22} className="text-success-600 dark:text-success-400" />
                  ) : (
                    <BookText size={22} className="text-primary-600 dark:text-gold-400" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-primary-800 dark:text-primary-100 text-base">
                      {book.titleAr}
                    </h3>
                    {book.id === HADITH_OF_DAY_BOOK && (
                      <Badge variant="gold">الافتراضي</Badge>
                    )}
                    {isInstalled && <Badge variant="success">محفوظ</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{book.authorAr}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap">
                    <span className="text-gray-400 dark:text-gray-500">
                      {toArabicNumber(book.count)} حديث
                    </span>
                    <span className="text-gray-400 dark:text-gray-500">
                      {formatBytes(book.downloadBytes)}
                    </span>
                  </div>

                  {running && (
                    <div className="mt-3">
                      <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-500 transition-all duration-200"
                          style={{ width: `${running.percent}%` }}
                        />
                      </div>
                      <p className="text-xs text-primary-600 dark:text-gold-400 mt-1">
                        {running.label} ({running.percent}%)
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className="mt-2 flex items-start gap-1.5 text-error-600 dark:text-error-300">
                      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                      <span className="text-xs">{error}</span>
                    </div>
                  )}

                  <div className="mt-3">
                    {running ? (
                      <button
                        onClick={() => cancel(book.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-lg text-sm font-medium transition-smooth"
                      >
                        إيقاف
                      </button>
                    ) : isInstalled ? (
                      <button
                        onClick={() => {
                          if (confirm(`حذف ${book.titleAr} من الجهاز؟`)) {
                            void deleteHadithCollection(book.id);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-smooth"
                      >
                        <Trash2 size={15} />
                        حذف
                      </button>
                    ) : (
                      <button
                        onClick={() => void startHadith(book)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-smooth"
                      >
                        <Download size={16} />
                        تحميل
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </section>

      <Card className="bg-gray-50 dark:bg-gray-800/20">
        <div className="flex items-start gap-2">
          <WifiOff size={18} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            نصوص المصحف ({toArabicNumber(TOTAL_QURAN_AYAHS)} آية) مدمجة داخل البرنامج ولا تحتاج تحميلاً. أما التفاسير
            والأحاديث والتلاوات الصوتية فتعتمد على مصادرها وتُنزل عند الطلب — راجع ملف
            <span className="font-medium"> SOURCES.md </span>
            لبيان المصادر والرخص. أسماء الأبواب في كتب الحديث تظهر بلغة المصدر (إنجليزية)
            كما وردت في الأصل.
          </p>
        </div>
      </Card>
    </div>
  );
}

/** Kept so existing imports keep working; the library covers hadith and tafsir together. */
export const HadithDownloadManager = ContentLibrary;