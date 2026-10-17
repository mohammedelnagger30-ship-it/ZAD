import { useState, useEffect, useCallback, useMemo } from 'react';
import { Bookmark, Trash2, BookOpen, FileDown, FileText, Share2, Copy, ArrowUpRight } from 'lucide-react';
import { db, type Bookmark as BookmarkType, type PageBookmark } from '@/db/database';
import { getSurah, toArabicNumber } from '@/data/surahs';
import { getAyah } from '@/data/quranText';
import { Card, EmptyState, Badge } from '@/components/ui';
import { useSnackbar } from '@/hooks/useSnackbar';
import { buildBookmarksExport } from '@/utils/bookmarkExport';
import { shareAyahCard, shareTextOrCopy } from '@/utils/shareCard';
import type { ScreenName, NavParams } from '@/hooks/useApp';

interface BookmarksScreenProps {
  navigate: (screen: ScreenName, params?: NavParams) => void;
}

interface AyahBookmarkRow extends BookmarkType {
  text?: string;
  surahName?: string;
  page?: number;
}

/**
 * «محفوظاتي» — the list every bookmarking UI needs behind it.
 *
 * The reader has always let the user mark ayahs and pages, but the marks were only
 * read by backup and sync: there was no screen that could show them, so a memoriser
 * who marked 50 ayahs had to re-read the whole surah to find them again. This screen
 * is that missing list — ayah bookmarks grouped by surah with their text, page
 * bookmarks as a jump list, each with a one-tap return to the reader.
 */
export function BookmarksScreen({ navigate }: BookmarksScreenProps) {
  const [ayahBookmarks, setAyahBookmarks] = useState<AyahBookmarkRow[]>([]);
  const [pageBookmarks, setPageBookmarks] = useState<PageBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  /** True while the whole collection sits on the clipboard after «تصدير». */
  const [exported, setExported] = useState(false);
  const { show, snackbar } = useSnackbar();

  const load = useCallback(async () => {
    try {
      const [bms, pages] = await Promise.all([db.bookmarks.toArray(), db.pageBookmarks.toArray()]);
      // Enrich each ayah bookmark with its text and surah name so the list is
      // readable on its own — a bare "البقرة — 2" tells the user nothing.
      const enriched: AyahBookmarkRow[] = bms
        .map((bm) => {
          const surah = getSurah(bm.surahId);
          const ayah = surah ? getAyah(bm.surahId, bm.ayahNumber) : undefined;
          return {
            ...bm,
            surahName: surah?.name,
            text: ayah?.text,
            page: ayah?.page,
          };
        })
        .sort((a, b) => a.surahId - b.surahId || a.ayahNumber - b.ayahNumber);
      setAyahBookmarks(enriched);
      setPageBookmarks(pages.sort((a, b) => a.page - b.page));
    } catch (error) {
      console.error('Failed to load bookmarks:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groupedBySurah = useMemo(() => {
    const groups = new Map<number, AyahBookmarkRow[]>();
    for (const bm of ayahBookmarks) {
      const list = groups.get(bm.surahId) ?? [];
      list.push(bm);
      groups.set(bm.surahId, list);
    }
    return [...groups.entries()];
  }, [ayahBookmarks]);

  const openAyah = (bm: AyahBookmarkRow) => {
    navigate('quran', { openSurahId: bm.surahId, openAyah: bm.ayahNumber });
  };

  const openPage = (page: number) => {
    navigate('quran', { openPage: page });
  };

  const ayahKey = (bm: AyahBookmarkRow) => `${bm.surahId}:${bm.ayahNumber}`;

  const copyAyah = async (bm: AyahBookmarkRow) => {
    // Both are needed and neither may be interpolated as "undefined": the text
    // is what is copied and the name is what says where the ayah came from.
    if (!bm.text || !bm.surahName) return;
    const payload = `﴿${bm.text}﴾\n${bm.surahName} — الآية ${toArabicNumber(bm.ayahNumber)}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedKey(ayahKey(bm));
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // Clipboard denial is silent — the text stays visible on the card.
    }
  };

  /**
   * Shares the ayah as a picture, with the words behind it.
   *
   * The card is drawn first and the system sheet takes the image; a device
   * that will not take an image gets the text instead, and one with no sheet
   * at all gets the clipboard and the very same «تم النسخ» the copy button
   * shows. Those two cases are the only ones that leave the ayah stuck on the
   * phone, so they are the only ones that say anything on screen.
   */
  const shareAyah = async (bm: AyahBookmarkRow) => {
    if (!bm.text || !bm.surahName) return;
    const outcome = await shareAyahCard({
      surahId: bm.surahId,
      ayahText: bm.text,
      surahName: bm.surahName,
      ayahNumber: bm.ayahNumber,
    });
    if (outcome !== 'copied') return;
    setCopiedKey(ayahKey(bm));
    setTimeout(() => setCopiedKey(null), 2500);
  };

  /**
   * The whole collection, as one block of text that can leave the app.
   *
   * Copying an ayah was always there and is no use to someone who marked forty
   * of them: the marks lived only inside the phone, in a list that could be
   * read but not taken anywhere. The share sheet when the device has one —
   * a notebook, a message, a document of the year's memorising — and the
   * clipboard when it does not.
   */
  const exportAll = async () => {
    const payload = buildBookmarksExport(
      ayahBookmarks,
      pageBookmarks.map((page) => page.page),
    );
    if (!payload) return;
    // The sheet, or the clipboard beneath it. Only the clipboard path announces
    // itself: a copy that says nothing is a copy the person never learns happened.
    const outcome = await shareTextOrCopy(payload);
    if (outcome === 'copied') {
      setExported(true);
      setTimeout(() => setExported(false), 2500);
    }
  };

  /**
   * A mark is taken back, not asked about.
   *
   * This screen used to put a dialog in front of every deletion, and it was
   * the wrong question here: the row survives in memory for as long as the bar
   * is on screen, so the answer can be given after the fact. «تراجع» costs one
   * tap and cannot be misclicked into a loss; «أنت متأكد؟» costs a tap on
   * every deletion and a wrong «نعم» still cannot be undone — which was the
   * only reason the question was there.
   *
   * The ayah row is rebuilt field by field because the one on screen carries
   * the surah name and the ayah text that make the list readable. Those are
   * enrichment, not bookmarks, and Dexie would write them into the table
   * beside the real columns, where they would ride along into every backup.
   */
  const removeAyahBookmark = async (bm: AyahBookmarkRow) => {
    if (bm.id === undefined) return;
    const row: BookmarkType = {
      id: bm.id,
      syncId: bm.syncId,
      syncModifiedAt: bm.syncModifiedAt,
      surahId: bm.surahId,
      ayahNumber: bm.ayahNumber,
      note: bm.note,
      createdAt: bm.createdAt,
    };
    await db.bookmarks.delete(bm.id);
    void load();
    const label = bm.surahName
      ? `«${bm.surahName} — الآية ${toArabicNumber(bm.ayahNumber)}»`
      : `الآية ${toArabicNumber(bm.ayahNumber)}`;
    show({
      message: `حُذفت علامة ${label}.`,
      action: {
        label: 'تراجع',
        onAction: () => {
          // The original id rides along, so the row comes back exactly where
          // it was — including its place in the sync history.
          void db.bookmarks
            .put(row)
            .then(() => load())
            .catch((error) => console.error('Failed to restore bookmark:', error));
        },
      },
    });
  };

  const removePageBookmark = async (bm: PageBookmark) => {
    await db.pageBookmarks.delete(bm.page);
    void load();
    show({
      message: `حُذفت علامة الصفحة ${toArabicNumber(bm.page)}.`,
      action: {
        label: 'تراجع',
        onAction: () => {
          void db.pageBookmarks
            .put(bm)
            .then(() => load())
            .catch((error) => console.error('Failed to restore page bookmark:', error));
        },
      },
    });
  };

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <p className="text-sm text-primary-600 dark:text-primary-300">جارٍ تحميل المحفوظات...</p>
      </div>
    );
  }

  const total = ayahBookmarks.length + pageBookmarks.length;

  return (
    <div className="space-y-5 pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-primary-100 pb-3 dark:border-primary-800">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-primary-900 md:text-3xl dark:text-primary-50">
            <Bookmark size={24} className="text-primary-600 dark:text-gold-400" />
            محفوظاتي
          </h1>
          <p className="mt-0.5 text-xs text-primary-700/80 dark:text-primary-300">
            {total > 0
              ? `${toArabicNumber(total)} علامة محفوظة — عود إليها في أي وقت`
              : 'الآيات والصفحات التي علّمتها للرجوع إليها لاحقًا'}
          </p>
        </div>
        {total > 0 && (
          <button
            type="button"
            onClick={() => void exportAll()}
            aria-live="polite"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary-200 bg-white px-4 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-700 dark:bg-primary-900/50 dark:text-gold-300 dark:hover:bg-primary-800"
          >
            <FileDown size={16} />
            {exported ? 'نُسخ كنص' : 'تصدير كنص'}
          </button>
        )}
      </div>

      {total === 0 && (
        <EmptyState
          icon={<Bookmark size={56} strokeWidth={1.2} />}
          title="لا توجد محفوظات بعد"
          description="في وضع الحفظ اضغط على الآية مباشرة لتعليمها، وفي الوضع العادي اضغط عليها واختر «حفظ». ويمكنك علّم صفحة كاملة من شاشة المصحف لتجدها هنا."
          action={
            <button
              type="button"
              onClick={() => navigate('quran')}
              className="mt-1 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400"
            >
              <BookOpen size={16} />
              تصفّح المصحف
            </button>
          }
        />
      )}

      {/* Ayah bookmarks, grouped by surah */}
      {groupedBySurah.length > 0 && (
        <section aria-labelledby="ayah-bookmarks-heading">
          <h2
            id="ayah-bookmarks-heading"
            className="mb-3 flex items-center gap-2 text-lg font-bold text-primary-800 dark:text-primary-100"
          >
            <FileText size={18} className="text-primary-600 dark:text-gold-400" />
            الآيات المحفوظة
            <Badge variant="primary">{toArabicNumber(ayahBookmarks.length)}</Badge>
          </h2>
          <div className="space-y-4">
            {groupedBySurah.map(([surahId, rows]) => {
              const surah = getSurah(surahId);
              return (
                <div key={surahId} className="space-y-2">
                  <p className="px-1 text-sm font-bold text-primary-700 dark:text-gold-300">
                    سورة {surah?.name}
                    <span className="mr-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                      {toArabicNumber(rows.length)} {rows.length === 1 ? 'آية' : rows.length === 2 ? 'آيتان' : 'آيات'}
                    </span>
                  </p>
                  {rows.map((bm) => (
                    <Card key={ayahKey(bm)} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => openAyah(bm)}
                        className="block w-full text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 rounded-xl"
                        aria-label={`فتح ${surah?.name} الآية ${toArabicNumber(bm.ayahNumber)} في القارئ`}
                      >
                        <p className="font-['Amiri_Quran',_serif] text-lg leading-loose text-primary-900 dark:text-primary-50">
                          {bm.text ?? '—'}
                          <span className="mushaf-ayah-mark mr-1.5 align-middle" aria-hidden="true">
                            {toArabicNumber(bm.ayahNumber)}
                          </span>
                        </p>
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        {bm.page !== undefined && (
                          <Badge variant="gold">صفحة {toArabicNumber(bm.page)}</Badge>
                        )}
                        <span className="text-[0.6875rem] text-gray-400 dark:text-gray-500">
                          {new Date(bm.createdAt).toLocaleDateString('ar-EG', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          onClick={() => openAyah(bm)}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary-100 px-3 py-1.5 text-xs font-bold text-primary-700 transition-colors hover:bg-primary-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-100 dark:hover:bg-primary-700"
                        >
                          <ArrowUpRight size={14} />
                          فتح في القارئ
                        </button>
                        <button
                          type="button"
                          onClick={() => shareAyah(bm)}
                          aria-label="مشاركة الآية"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-primary-800/40 dark:hover:text-gold-300"
                        >
                          <Share2 size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => copyAyah(bm)}
                          aria-label={copiedKey === ayahKey(bm) ? 'تم النسخ' : 'نسخ الآية'}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                            copiedKey === ayahKey(bm)
                              ? 'text-success-600 dark:text-success-400'
                              : 'text-gray-500 hover:bg-primary-50 hover:text-primary-700 dark:text-gray-400 dark:hover:bg-primary-800/40 dark:hover:text-gold-300'
                          }`}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeAyahBookmark(bm)}
                          aria-label="حذف العلامة"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-error-50 hover:text-error-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500 dark:text-gray-400 dark:hover:bg-error-900/30 dark:hover:text-error-300"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Page bookmarks */}
      {pageBookmarks.length > 0 && (
        <section aria-labelledby="page-bookmarks-heading">
          <h2
            id="page-bookmarks-heading"
            className="mb-3 flex items-center gap-2 text-lg font-bold text-primary-800 dark:text-primary-100"
          >
            <BookOpen size={18} className="text-primary-600 dark:text-gold-400" />
            الصفحات المحفوظة
            <Badge variant="primary">{toArabicNumber(pageBookmarks.length)}</Badge>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {pageBookmarks.map((bm) => (
              <Card key={bm.page} className="flex items-center justify-between gap-2 p-3.5">
                <button
                  type="button"
                  onClick={() => openPage(bm.page)}
                  className="flex-1 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:focus-visible:ring-gold-400 rounded-lg"
                  aria-label={`فتح الصفحة ${toArabicNumber(bm.page)} في المصحف`}
                >
                  <p className="text-sm font-bold text-primary-800 dark:text-primary-100">
                    الصفحة {toArabicNumber(bm.page)}
                  </p>
                  <p className="mt-0.5 text-[0.6875rem] text-gray-400 dark:text-gray-500">
                    {new Date(bm.createdAt).toLocaleDateString('ar-EG', {
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void removePageBookmark(bm)}
                  aria-label={`حذف علامة الصفحة ${toArabicNumber(bm.page)}`}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-error-50 hover:text-error-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500 dark:text-gray-400 dark:hover:bg-error-900/30 dark:hover:text-error-300"
                >
                  <Trash2 size={15} />
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/*
        No confirmation sits in front of a deletion any more — the bar below
        offers the way back instead, and only for as long as there is one.
      */}
      {snackbar}
    </div>
  );
}
