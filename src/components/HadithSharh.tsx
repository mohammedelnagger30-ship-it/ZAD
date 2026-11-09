import { useCallback, useEffect, useState } from 'react';
import { BookOpen, Download, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import {
  SHARH_SOURCE,
  fetchSharh,
  getSharh,
  type SharhEntry,
  type SharhProgress,
} from '@/utils/sharhService';

/**
 * The explanation card under a hadith in the detail view.
 *
 * Opens in one of four honest states: already-downloaded explanations appear
 * at once, an already-downloaded index searches immediately, a missing index
 * offers the one-time download (it is ~1.3 MB, so it is never taken
 * automatically), and a hadith no entry matches says exactly that rather than
 * borrowing another hadith's explanation. Failures keep their own message with
 * a retry — the network being down must not look like "no explanation exists".
 */

interface HadithSharhProps {
  hadithId: string;
  text: string;
}

type State =
  | { phase: 'checking' }
  | { phase: 'offer' }
  | { phase: 'loading'; progress?: SharhProgress }
  | { phase: 'ready'; entry: SharhEntry }
  | { phase: 'none' }
  | { phase: 'error'; message: string };

export function HadithSharh({ hadithId, text }: HadithSharhProps) {
  const [state, setState] = useState<State>({ phase: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'checking' });
    void getSharh(text).then((outcome) => {
      if (cancelled) return;
      if (outcome.state === 'need-index') setState({ phase: 'offer' });
      else if (outcome.state === 'ready') setState({ phase: 'ready', entry: outcome.entry });
      else if (outcome.state === 'none') setState({ phase: 'none' });
      else setState({ phase: 'error', message: outcome.message });
    });
    return () => {
      cancelled = true;
    };
  }, [hadithId, text]);

  const load = useCallback(() => {
    setState({ phase: 'loading' });
    void fetchSharh(text, (progress) => setState({ phase: 'loading', progress })).then(
      (outcome) => {
        if (outcome.state === 'ready') setState({ phase: 'ready', entry: outcome.entry });
        else if (outcome.state === 'none') setState({ phase: 'none' });
        else if (outcome.state === 'error') setState({ phase: 'error', message: outcome.message });
        else setState({ phase: 'offer' });
      },
    );
  }, [text]);

  if (state.phase === 'none') {
    return (
      <div className="rounded-xl border border-primary-100 dark:border-primary-800/60 bg-gray-50/70 dark:bg-gray-800/20 p-3.5">
        <div className="flex items-start gap-2">
          <BookOpen size={17} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
          <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">
            لا يتوفر شرح مطابق لهذا الحديث في {SHARH_SOURCE.nameAr} — لم يُعرض شرح من مصدر آخر حتى
            لا ينسب لحديثٍ ما شرحُ غيره.
          </p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-error-200 dark:border-error-800/40 bg-error-50 dark:bg-error-900/20 p-3.5 space-y-2">
        <p className="text-xs leading-6 text-error-700 dark:text-error-300">{state.message}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg bg-error-100 dark:bg-error-900/40 px-3 py-1.5 text-xs font-medium text-error-700 dark:text-error-300 hover:bg-error-200 dark:hover:bg-error-900/60"
        >
          <RefreshCw size={14} />
          إعادة المحاولة
        </button>
      </div>
    );
  }

  if (state.phase === 'offer') {
    return (
      <div className="rounded-xl border border-primary-100 dark:border-primary-800/60 bg-primary-50/50 dark:bg-primary-900/20 p-3.5 space-y-2">
        <div className="flex items-start gap-2">
          <Sparkles size={17} className="text-primary-500 dark:text-gold-400 shrink-0 mt-0.5" />
          <p className="text-xs leading-6 text-gray-600 dark:text-gray-300">
            اضغط لتحميل شرح الأحاديث وفوائدها ومعاني ألفاظها من {SHARH_SOURCE.nameAr} — مرة واحدة
            (نحو ١٫٣ ميجا)، ثم تعمل الشروح دون اتصال على جهازك.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-smooth active:scale-95"
        >
          <Download size={16} />
          تحميل الشروح
        </button>
      </div>
    );
  }

  if (state.phase === 'loading' || state.phase === 'checking') {
    const progress = state.phase === 'loading' ? state.progress : undefined;
    return (
      <div className="rounded-xl border border-primary-100 dark:border-primary-800/60 bg-gray-50/70 dark:bg-gray-800/20 p-3.5">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <Loader2 size={16} className="animate-spin text-primary-500" />
          <span>
            {state.phase === 'checking' || !progress
              ? 'جارٍ تحميل الشروح من المصدر…'
              : 'جارٍ تحميل فهرس الشروح…'}
          </span>
          {progress && progress.total > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500" dir="ltr">
              {progress.found}/{progress.total}
            </span>
          )}
        </div>
      </div>
    );
  }

  const { entry } = state;
  return (
    <div className="animate-fade-in rounded-xl border border-primary-100 dark:border-primary-800/60 bg-white/80 dark:bg-primary-900/20 p-4 space-y-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen size={18} className="text-primary-600 dark:text-gold-400" />
        <h3 className="text-sm font-bold text-primary-800 dark:text-primary-100">الشرح والفوائد</h3>
        {entry.attribution && (
          <span className="text-xs text-gray-500 dark:text-gray-400">{entry.attribution}</span>
        )}
      </div>

      <p className="text-sm leading-8 text-gray-700 dark:text-gray-200 whitespace-pre-line">
        {entry.explanation}
      </p>

      {entry.hints.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-primary-700 dark:text-gold-400">
            فوائد الحديث
          </p>
          <ul className="space-y-1.5">
            {entry.hints.map((hint, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm leading-7 text-gray-600 dark:text-gray-300"
              >
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400 dark:bg-gold-500" />
                <span>{hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.wordsMeanings.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-primary-700 dark:text-gold-400">
            معاني الألفاظ
          </p>
          <ul className="space-y-1.5">
            {entry.wordsMeanings.map((w, i) => (
              <li key={i} className="text-sm leading-7 text-gray-600 dark:text-gray-300">
                <span className="font-semibold text-primary-800 dark:text-primary-100">
                  {w.word}:
                </span>{' '}
                {w.meaning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.reference && (
        <p className="text-xs leading-6 text-gray-500 dark:text-gray-400 whitespace-pre-line border-t border-primary-100 dark:border-primary-800 pt-2.5">
          <span className="font-medium">المراجع:</span> {entry.reference}
        </p>
      )}

      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        المصدر: {SHARH_SOURCE.nameAr} — <span dir="ltr">{SHARH_SOURCE.url}</span> (نص الشرح كما
        نشره المصدر دون تعديل)
      </p>
    </div>
  );
}
