import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Copy,
  Share2,
  BookOpen,
  Download,
  Loader2,
  HardDriveDownload,
} from 'lucide-react';
import {
  DEFAULT_TAFSIR_ID,
  ensureSurahTafsir,
  formatBytes,
  getAyahTafsir,
  getTafsirEdition,
  TAFSIR_EDITIONS,
  type TafsirEdition,
} from '@/data/tafsir';
import { useInstalledContent } from '@/hooks/useContent';
import { getSurah, toArabicNumber, TOTAL_QURAN_AYAHS } from '@/data/surahs';

interface TafsirSheetProps {
  surahId: number;
  ayahNumber: number;
  onClose: () => void;
  /** Move to a neighbouring ayah while the sheet stays open (delta = -1 | +1). */
  onNavigateAyah?: (delta: number) => void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; text: string | null }
  | { status: 'missing' }
  | { status: 'downloading'; percent: number }
  | { status: 'error'; message: string };

export function TafsirBottomSheet({ surahId, ayahNumber, onClose, onNavigateAyah }: TafsirSheetProps) {
  const surah = getSurah(surahId);
  const [editionId, setEditionId] = useState(DEFAULT_TAFSIR_ID);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [showPicker, setShowPicker] = useState(false);
  const installed = useInstalledContent();

  // Downloads are keyed by edition+surah; a new request supersedes the previous one so
  // flipping quickly through ayahs cannot leave the wrong text on screen.
  const requestId = useRef(0);

  const edition = getTafsirEdition(editionId);
  const surahInstalled = installed.tafsir[editionId]?.has(surahId) ?? false;

  const load = useCallback(
    async (id: string, surahNum: number, ayah: number) => {
      const ticket = ++requestId.current;
      setState({ status: 'loading' });
      try {
        const text = await getAyahTafsir(id, surahNum, ayah);
        if (requestId.current !== ticket) return;
        setState(text ? { status: 'ready', text } : { status: 'missing' });
      } catch (err) {
        if (requestId.current !== ticket) return;
        setState({ status: 'error', message: (err as Error).message });
      }
    },
    [],
  );

  useEffect(() => {
    void load(editionId, surahId, ayahNumber);
  }, [editionId, surahId, ayahNumber, load]);

  // Moving to the next ayah inside the same surah needs no reload of the file, only a new
  // lookup — but only once the surah is on the device, otherwise fall back to the loader.
  const handleDownload = useCallback(async () => {
    if (!edition) return;
    const ticket = ++requestId.current;
    setState({ status: 'downloading', percent: 0 });

    try {
      await ensureSurahTafsir(editionId, surahId, (progress) => {
        if (requestId.current !== ticket) return;
        const percent =
          progress.total > 0 ? Math.round((progress.received / progress.total) * 100) : 0;
        setState({ status: 'downloading', percent });
      });
      if (requestId.current !== ticket) return;
      const text = await getAyahTafsir(editionId, surahId, ayahNumber);
      setState(text ? { status: 'ready', text } : { status: 'missing' });
    } catch (err) {
      if (requestId.current !== ticket) return;
      setState({ status: 'error', message: (err as Error).message });
    }
  }, [edition, editionId, surahId, ayahNumber]);

  const handleCopy = () => {
    if (state.status !== 'ready' || !state.text || !surah) return;
    const text = `سورة ${surah.name} - آية ${toArabicNumber(ayahNumber)}\n\n${state.text}\n\nالمصدر: ${edition?.titleAr} — ${edition?.authorAr}`;
    navigator.clipboard?.writeText(text);
  };

  const handleShare = () => {
    if (state.status !== 'ready' || !state.text || !surah) return;
    const text = `سورة ${surah.name} - آية ${toArabicNumber(ayahNumber)}\n\n${state.text}`;
    if (navigator.share) navigator.share({ text });
    else navigator.clipboard?.writeText(text);
  };

  const atFirstAyahOfQuran = surahId === 1 && ayahNumber === 1;
  const atLastAyahOfQuran = surahId === 114 && ayahNumber === 6;

  const surahCost = useMemo(
    () => (edition ? edition.surahBytes[surahId] ?? 0 : 0),
    [edition, surahId],
  );

  const switchEdition = (id: string) => {
    setEditionId(id);
    setShowPicker(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end" dir="rtl">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white dark:bg-primary-900 rounded-t-3xl max-h-[85vh] flex flex-col animate-slide-up">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-primary-100 dark:border-primary-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-lg font-bold text-primary-800 dark:text-primary-100 truncate">
              {surah?.name}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
              آية {toArabicNumber(ayahNumber)}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopy}
              disabled={state.status !== 'ready'}
              title="نسخ"
              className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-800 flex items-center justify-center text-primary-600 dark:text-primary-300 disabled:opacity-40"
            >
              <Copy size={16} />
            </button>
            <button
              onClick={handleShare}
              disabled={state.status !== 'ready'}
              title="مشاركة"
              className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-800 flex items-center justify-center text-primary-600 dark:text-primary-300 disabled:opacity-40"
            >
              <Share2 size={16} />
            </button>
            <button
              onClick={onClose}
              title="إغلاق"
              className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Edition selector */}
        <div className="px-5 py-3 border-b border-primary-100 dark:border-primary-800">
          {showPicker ? (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">اختر التفسير</p>
              {TAFSIR_EDITIONS.map((e) => {
                const have = installed.tafsir[e.id]?.size ?? 0;
                return (
                  <button
                    key={e.id}
                    onClick={() => switchEdition(e.id)}
                    className={`w-full text-right p-2.5 rounded-xl border transition-smooth ${
                      e.id === editionId
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-800/40'
                        : 'border-primary-100 dark:border-primary-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-primary-800 dark:text-primary-100">
                        {e.titleAr}
                      </span>
                      {have > 0 && (
                        <span className="text-[11px] text-success-600 dark:text-success-400 shrink-0">
                          {have === e.surahs ? 'كامل' : `${have} من ${e.surahs} سورة`}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">
                        {e.authorAr}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
                        {formatBytes(e.totalBytes)}
                      </span>
                    </div>
                  </button>
                );
              })}
              <button
                onClick={() => setShowPicker(false)}
                className="w-full text-center text-xs text-primary-600 dark:text-gold-400 py-1"
              >
                إغلاق القائمة
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowPicker(true)}
              className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl bg-primary-50 dark:bg-primary-800/40 border border-primary-100 dark:border-primary-800"
            >
              <span className="flex items-center gap-2 min-w-0">
                <BookOpen size={16} className="text-primary-600 dark:text-gold-400 shrink-0" />
                <span className="text-sm font-semibold text-primary-800 dark:text-primary-100 truncate">
                  {edition?.titleAr ?? 'التفسير'}
                </span>
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                تغيير
              </span>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {state.status === 'loading' && (
            <div className="flex items-center justify-center py-10 gap-2 text-primary-600 dark:text-gold-400">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">جارٍ فتح التفسير…</span>
            </div>
          )}

          {state.status === 'downloading' && (
            <div className="py-8 text-center space-y-3">
              <Loader2 size={26} className="mx-auto animate-spin text-primary-600 dark:text-gold-400" />
              <p className="text-sm text-primary-800 dark:text-primary-100">
                جارٍ تحميل تفسير سورة {surah?.name}
              </p>
              <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden max-w-[220px] mx-auto">
                <div
                  className="h-full bg-primary-500 transition-all duration-200"
                  style={{ width: `${state.percent}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{state.percent}%</p>
            </div>
          )}

          {state.status === 'error' && (
            <div className="bg-error-50 dark:bg-error-900/20 rounded-xl p-4 border border-error-200 dark:border-error-800/40">
              <p className="text-sm text-error-700 dark:text-error-300">{state.message}</p>
            </div>
          )}

          {state.status === 'missing' && !surahInstalled && (
            <DownloadPrompt
              edition={edition}
              surahName={surah?.name ?? ''}
              surahCost={surahCost}
              onDownload={handleDownload}
            />
          )}

          {state.status === 'missing' && surahInstalled && (
            <div className="text-center py-10">
              <BookOpen size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                هذا التفسير الميسّر لا يشرح هذه الآية.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                جرّب تفسيراً آخر من القائمة بالأعلى.
              </p>
            </div>
          )}

          {state.status === 'ready' && state.text && (
            <div className="space-y-3">
              <div className="bg-primary-50 dark:bg-primary-800/20 rounded-2xl p-4">
                <p className="text-sm leading-loose text-primary-800 dark:text-primary-100 whitespace-pre-line">
                  {state.text}
                </p>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {edition?.titleAr} — {edition?.authorAr}
                </p>
                {edition && !edition.surahBytes.every((b) => b > 0) && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {toArabicNumber(edition.ayahs)} من {toArabicNumber(TOTAL_QURAN_AYAHS)} آية
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Ayah navigation */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-primary-100 dark:border-primary-800">
          <button
            onClick={() => onNavigateAyah?.(-1)}
            disabled={atFirstAyahOfQuran || !onNavigateAyah}
            className="flex items-center gap-1 text-sm text-primary-600 dark:text-gold-400 disabled:opacity-30"
          >
            <ChevronRight size={18} />
            <span>الآية السابقة</span>
          </button>
          <button
            onClick={() => onNavigateAyah?.(1)}
            disabled={atLastAyahOfQuran || !onNavigateAyah}
            className="flex items-center gap-1 text-sm text-primary-600 dark:text-gold-400 disabled:opacity-30"
          >
            <span>الآية التالية</span>
            <ChevronLeft size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when the chosen tafsir has nothing for this surah yet. It offers the one surah
 * rather than the whole edition, because a single surah is what the reader just opened —
 * 12 KB for the concise tafsirs, a few MB for Ibn Kathir on Al-Baqarah.
 */
function DownloadPrompt({
  edition,
  surahName,
  surahCost,
  onDownload,
}: {
  edition: TafsirEdition | undefined;
  surahName: string;
  surahCost: number;
  onDownload: () => void;
}) {
  const unavailable = !edition || surahCost === 0;
  return (
    <div className="text-center py-6 space-y-4">
      <HardDriveDownload size={34} className="mx-auto text-primary-600 dark:text-gold-400" />
      <div>
        <p className="text-sm font-semibold text-primary-800 dark:text-primary-100">
          {unavailable
            ? `تفسير سورة ${surahName} غير متوفر في هذا المصدر`
            : `تفسير سورة ${surahName} غير محمّل بعد`}
        </p>
        {!unavailable && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            حجم السورة {formatBytes(surahCost)} فقط — يُحمَّل مرة واحدة ويبقى داخل التطبيق
            بدون إنترنت.
          </p>
        )}
      </div>
      {!unavailable && (
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 transition-smooth"
        >
          <Download size={16} />
          تحميل تفسير هذه السورة
        </button>
      )}
      {unavailable && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          جرّب تفسيراً آخر من القائمة بالأعلى.
        </p>
      )}
    </div>
  );
}