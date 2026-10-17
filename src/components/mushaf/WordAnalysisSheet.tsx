import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { Sheet } from '@/components/mushaf/Sheet';
import { toArabicNumber } from '@/data/surahs';
import { formatBytes, WORD_MEANINGS } from '@/data/contentCatalog';
import {
  DEFAULT_WORD_MEANINGS_BOOK,
  downloadWordMeanings,
  getWordMeanings,
  type WordMeaningHit,
  type WordMeaningsProgress,
} from '@/utils/wordMeaningsService';
import { useWordMeanings } from '@/hooks/useContent';

export interface SelectedQuranWord {
  surahId: number;
  surahName: string;
  ayahNumber: number;
  word: string;
  wordPosition: number;
}

interface WordAnalysisSheetProps {
  selectedWord: SelectedQuranWord | null;
  onClose: () => void;
}

const BOOK_CHOICE_KEY = 'word-meanings-book';

function readStoredBook(): number {
  try {
    const raw = localStorage.getItem(BOOK_CHOICE_KEY);
    const id = raw === null ? NaN : Number(raw);
    return Number.isFinite(id) && WORD_MEANINGS.books.some((b) => b.id === id) ? id : DEFAULT_WORD_MEANINGS_BOOK;
  } catch {
    return DEFAULT_WORD_MEANINGS_BOOK;
  }
}

export function WordAnalysisSheet({ selectedWord, onClose }: WordAnalysisSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { installed, loading: installedLoading } = useWordMeanings();
  const [bookId, setBookId] = useState<number>(readStoredBook);
  const [hits, setHits] = useState<WordMeaningHit[] | null>(null);
  const [downloading, setDownloading] = useState<WordMeaningsProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // The glosses are read per tap: nothing is fetched, and a device without the dump
  // simply has none — the sheet offers the download instead of reaching for the network.
  useEffect(() => {
    if (!selectedWord || !installed) {
      setHits(null);
      return;
    }
    let cancelled = false;
    getWordMeanings(selectedWord.surahId, selectedWord.ayahNumber, selectedWord.wordPosition)
      .then((found) => {
        if (!cancelled) setHits(found);
      })
      .catch(() => {
        // A corrupt or partial file reads as "no meanings"; the sheet says so below.
        if (!cancelled) setHits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWord, installed]);

  const chooseBook = useCallback((id: number) => {
    setBookId(id);
    try {
      localStorage.setItem(BOOK_CHOICE_KEY, String(id));
    } catch {
      // Private browsing: the choice simply does not survive the next open.
    }
  }, []);

  const byBook = useMemo(() => {
    const map = new Map<number, WordMeaningHit>();
    for (const hit of hits ?? []) if (!map.has(hit.book)) map.set(hit.book, hit);
    return map;
  }, [hits]);

  useEffect(() => {
    if (hits === null || hits.length === 0 || byBook.has(bookId)) return;
    chooseBook(hits[0].book);
  }, [bookId, byBook, chooseBook, hits]);

  const startDownload = async () => {
    setDownloadError(null);
    setDownloading({ phase: 'download', received: 0, total: 0, done: 0, surahs: 114 });
    try {
      await downloadWordMeanings((progress) => setDownloading(progress));
      setDownloading(null);
    } catch (err) {
      setDownloading(null);
      setDownloadError((err as Error).message || 'تعذّر تحميل معاني الكلمات');
    }
  };

  if (!selectedWord) return null;

  const current = byBook.get(bookId) ?? null;
  const booksWithMeaning = WORD_MEANINGS.books.filter((b) => byBook.has(b.id));
  const downloadPercent =
    downloading === null
      ? 0
      : downloading.phase === 'download'
        ? downloading.total > 0
          ? Math.round((downloading.received / downloading.total) * 100)
          : 0
        : Math.round((downloading.done / downloading.surahs) * 100);

  return (
    <Sheet
      open
      title="معلومات لغوية عن الكلمة"
      onClose={onClose}
      panelRef={panelRef}
    >
      <div className="mushaf-word-analysis">
        <p className="mushaf-word-analysis__word" lang="ar" dir="rtl">
          {selectedWord.word}
        </p>
        <p className="mushaf-word-analysis__location">
          سورة {selectedWord.surahName} · الآية {toArabicNumber(selectedWord.ayahNumber)} · الكلمة{' '}
          {toArabicNumber(selectedWord.wordPosition)}
        </p>

        {/* ---- The meaning, from the books on the device ---- */}
        <section className="mushaf-word-analysis__section">
          <h3 className="mushaf-word-analysis__heading">معنى الكلمة</h3>

          {installedLoading && <p className="mushaf-hint">جارٍ البحث في المعاني…</p>}

          {!installedLoading && !installed && !downloading && (
            <>
              <p className="mushaf-hint">
                معاني غريب القرآن محفوظة في كتب {WORD_MEANINGS.books.length} مضمَّنة في البرنامج
                (السراج، تذكرة الأريب، التبيان، كلمات القرآن). حمّلها مرة واحدة لتعمل بدون
                إنترنت — {formatBytes(WORD_MEANINGS.downloadBytes)} مضغوطاً،{' '}
                {formatBytes(WORD_MEANINGS.storedBytes)} على الجهاز.
              </p>
              <button
                className="mushaf-seg__item mushaf-word-analysis__download"
                onClick={() => void startDownload()}
              >
                <Download size={18} aria-hidden="true" />
                <span>تحميل معاني الكلمات</span>
              </button>
            </>
          )}

          {downloading && (
            <div className="mushaf-word-analysis__progress">
              <div
                className="mushaf-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={downloadPercent}
                aria-label="تحميل معاني الكلمات"
              >
                <span style={{ width: `${downloadPercent}%` }} />
              </div>
              <p className="mushaf-hint">
                {downloading.phase === 'download'
                  ? `جارٍ التنزيل — ${formatBytes(downloading.received)}${
                      downloading.total > 0 ? ` من ${formatBytes(downloading.total)}` : ''
                    }`
                  : `جارٍ التثبيت — ${toArabicNumber(downloading.done)} من ${toArabicNumber(
                      downloading.surahs,
                    )} سورة`}
                {' '}
                ({toArabicNumber(downloadPercent)}٪)
              </p>
            </div>
          )}

          {downloadError && (
            <p className="mushaf-hint" role="alert">
              {downloadError}
            </p>
          )}

          {!installedLoading && installed && hits === null && (
            <p className="mushaf-hint">جارٍ البحث في المعاني…</p>
          )}

          {!installedLoading && installed && hits !== null && (
            <>
              <div className="mushaf-word-analysis__books" role="group" aria-label="اختيار الكتاب">
                {WORD_MEANINGS.books.map((book) => {
                  // The books annotate only the unusual words, so on most taps three of
                  // the four are silent. Offering those as live choices makes them read
                  // as broken; the silent ones are marked and cannot be picked.
                  const has = byBook.has(book.id);
                  return (
                    <button
                      key={book.id}
                      type="button"
                      aria-pressed={has && bookId === book.id}
                      aria-disabled={!has}
                      disabled={!has}
                      className="mushaf-seg__item mushaf-word-analysis__book"
                      onClick={() => has && chooseBook(book.id)}
                      title={
                        has
                          ? `${book.titleAr} — ${book.authorAr}`
                          : `${book.titleAr} — لا يذكر هذا الكتاب معنى لهذه الكلمة`
                      }
                    >
                      {book.shortAr}
                    </button>
                  );
                })}
              </div>

              {current ? (
                <>
                  <p className="mushaf-word-analysis__phrase" lang="ar" dir="rtl">
                    «{current.gloss.text}»
                  </p>
                  <p className="mushaf-word-analysis__meaning" lang="ar" dir="rtl">
                    {current.gloss.meaning}
                  </p>
                  <p className="mushaf-word-analysis__book-credit">
                    {WORD_MEANINGS.books.find((b) => b.id === current.book)?.titleAr} —{' '}
                    {WORD_MEANINGS.books.find((b) => b.id === current.book)?.authorAr}
                  </p>
                </>
              ) : hits !== null && hits.length > 0 ? (
                <p className="mushaf-hint">
                  لا يذكر هذا الكتاب معنى لهذه الكلمة — الكتب تعلّق على الكلمات الغريبة فحسب.
                  {booksWithMeaning.length > 0 && (
                    <>
                      {' '}
                      المتوفر:{' '}
                      {booksWithMeaning.map((b) => b.shortAr).join('، ')}
                    </>
                  )}
                </p>
              ) : (
                <p className="mushaf-hint">
                  لم تجد الكتب الأربعة معنىً مطابقاً لهذه الكلمة في هذا الموضع. لا تعلّق الكتب
                  إلا على ما يُعدّ غريباً، وقد يختلف رسم الكلمة عن رسم المصحف.
                </p>
              )}

              <p className="mushaf-word-analysis__credit">
                المصدر: quranpedia.net · نسخة {WORD_MEANINGS.version}
              </p>
            </>
          )}
        </section>
      </div>
    </Sheet>
  );
}
