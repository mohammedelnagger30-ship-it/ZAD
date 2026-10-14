import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Check, Eye, Keyboard, RotateCcw, X } from 'lucide-react';
import { Card } from '@/components/ui';
import { useOverlayDismiss } from '@/hooks/useOverlayDismiss';
import { toArabicNumber, type SurahMeta } from '@/data/surahs';
import { getAyah } from '@/data/quranText';
import {
  buildQuizQuestion,
  buildWriteQuestion,
  describeIntervalDays,
  gradeChoiceResult,
  gradeOrderResult,
  gradeWriteResult,
  GRADE_LABELS_AR,
  getHifzReview,
  recordQuizResult,
  type QuizQuestion,
} from '@/utils/spacedRepetition';
import { recallDiff, similarityPercent, type RecallDiff } from '@/utils/textMatch';
import type { HifzGrade } from '@/db/database';

interface HifzTestModalProps {
  surah: SurahMeta;
  fromAyah: number;
  toAyah: number;
  onClose: () => void;
}

const QURAN_FONT = "font-['Amiri_Quran',_serif]";

/**
 * How the portion is questioned.
 *
 * «تلقائي» is the app choosing by portion size (order / next-ayah / recall) —
 * the mode that needs no decision from someone who just opened the quiz. The
 * others are there for the memoriser who knows what they want to be tested on:
 * writing is the one whose verdict is not self-declared, since the attempt is
 * measured against the mushaf rather than judged by its author.
 */
type TestMode = 'auto' | 'write';

function preview(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The hifz self-test — «اختبر حفظي».
 *
 * The reader's hifz mode could hide the text and repeat audio, but never once
 * *asked* anything: memorisation progress was self-declared. This modal closes
 * that gap with a quiz over the selected portion (order / next-ayah / recall,
 * chosen by portion size) whose result feeds the SM-2 schedule in
 * `@/utils/spacedRepetition`, so a portion tested well drifts to monthly
 * checks and a lapsed one returns tomorrow.
 *
 * Wrong answers never block progress: every path reaches its grade, and the
 * «نسيتها» grade is a schedule outcome (review sooner), never a scolding.
 */
export function HifzTestModal({ surah, fromAyah, toAyah, onClose }: HifzTestModalProps) {
  const [question, setQuestion] = useState<QuizQuestion | null>(null);
  /** Order quizzes: slots filled so far. Choice quizzes: correct answers so far. */
  const [orderPlaced, setOrderPlaced] = useState<number[]>([]);
  const [orderErrors, setOrderErrors] = useState(0);
  const [wrongCard, setWrongCard] = useState<number | null>(null);
  const [choicePicked, setChoicePicked] = useState<number | null>(null);
  const [recallRevealed, setRecallRevealed] = useState(false);
  const [mode, setMode] = useState<TestMode>('auto');
  /** Writing quiz: what the memoriser typed, and how it measured against the mushaf. */
  const [writtenText, setWrittenText] = useState('');
  const [diff, setDiff] = useState<RecallDiff | null>(null);
  const [result, setResult] = useState<{ grade: HifzGrade; nextDays: number } | null>(null);
  const [saving, setSaving] = useState(false);
  // Mounted only while open: back exits the quiz instead of navigating the
  // reader underneath it.
  useOverlayDismiss(true, onClose);

  const rangeFrom = Math.max(1, Math.min(fromAyah, surah.ayahCount));
  const rangeTo = Math.max(rangeFrom, Math.min(toAyah, surah.ayahCount));
  /** «اكتب الآية التالية» needs a next ayah to exist inside the portion. */
  const canWrite = rangeTo > rangeFrom;

  const dealQuestion = useCallback(() => {
    const next =
      mode === 'write'
        ? // A single-ay portion has nothing to ask for next; fall back rather
          // than hand the answer to whoever opened writing mode.
          buildWriteQuestion(surah.ayahCount, rangeFrom, rangeTo) ??
          buildQuizQuestion(surah.ayahCount, rangeFrom, rangeTo)
        : buildQuizQuestion(surah.ayahCount, rangeFrom, rangeTo);
    setQuestion(next);
    setOrderPlaced([]);
    setOrderErrors(0);
    setWrongCard(null);
    setChoicePicked(null);
    setRecallRevealed(false);
    setWrittenText('');
    setDiff(null);
    setResult(null);
  }, [mode, surah.ayahCount, rangeFrom, rangeTo]);

  useEffect(() => {
    dealQuestion();
  }, [dealQuestion]);

  // What this portion's schedule says today, shown so the quiz feels like part
  // of a plan rather than a one-off pop quiz.
  const [existing, setExisting] = useState<{ lastGrade: HifzGrade; intervalDays: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getHifzReview(surah.id, rangeFrom, rangeTo)
      .then((row) => {
        if (!cancelled && row) {
          setExisting({ lastGrade: row.lastGrade, intervalDays: row.intervalDays });
        }
      })
      .catch(() => {
        // A missing schedule just means "first quiz" — nothing to show.
      });
    return () => {
      cancelled = true;
    };
  }, [surah.id, rangeFrom, rangeTo]);

  const finish = useCallback(
    async (grade: HifzGrade) => {
      setSaving(true);
      try {
        const row = await recordQuizResult(surah.id, rangeFrom, rangeTo, grade);
        const nextDays = Math.max(0, Math.round((row.dueAt - row.lastReviewedAt) / (24 * 60 * 60 * 1000)));
        setResult({ grade, nextDays });
        setExisting({ lastGrade: grade, intervalDays: nextDays });
      } finally {
        setSaving(false);
      }
    },
    [surah.id, rangeFrom, rangeTo],
  );

  const answerText = useMemo(() => {
    if (!question) return null;
    if (question.type === 'choice' || question.type === 'write') {
      return getAyah(surah.id, question.answerAyah)?.text ?? null;
    }
    if (question.type === 'recall') return getAyah(surah.id, question.ayahNumber)?.text ?? null;
    return null;
  }, [question, surah.id]);

  /** The writing quiz's own verdict, offered but never forced. */
  const suggestedGrade = diff ? gradeWriteResult(diff.similarity) : null;

  const gradeButtons = (suggested: HifzGrade | null = null) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {(['again', 'hard', 'good', 'easy'] as const).map((grade) => (
        <button
          key={grade}
          type="button"
          disabled={!!result || saving}
          onClick={() => void finish(grade)}
          className={`relative min-h-11 rounded-xl border px-2 pt-2 text-sm font-bold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 ${
            grade === 'again'
              ? 'border-error-200 bg-error-50 text-error-700 hover:bg-error-100 dark:border-error-800 dark:bg-error-900/30 dark:text-error-300'
              : grade === 'hard'
                ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                : 'border-success-200 bg-success-50 text-success-700 hover:bg-success-100 dark:border-success-800 dark:bg-success-900/30 dark:text-success-300'
          } ${suggested === grade ? 'ring-2 ring-gold-400 ring-offset-1 dark:ring-offset-primary-900' : ''}`}
        >
          {GRADE_LABELS_AR[grade]}
          {suggested === grade && (
            <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-gold-500 px-1.5 text-[9px] font-bold text-white">
              الأقرب
            </span>
          )}
        </button>
      ))}
    </div>
  );

  const handleOrderTap = (ayahNumber: number) => {
    if (result || question?.type !== 'order') return;
    // The window to place opens at its smallest ayah number; each correct tap
    // advances one slot. A wrong tap costs an error but never blocks: the card
    // shakes and the sequence waits.
    const start = Math.min(...question.shuffled);
    const wanted = start + orderPlaced.length;
    if (ayahNumber === wanted) {
      const placed = [...orderPlaced, ayahNumber];
      setOrderPlaced(placed);
      setWrongCard(null);
      if (placed.length === question.shuffled.length) {
        void finish(gradeOrderResult(orderErrors));
      }
    } else {
      setOrderErrors((count) => count + 1);
      setWrongCard(ayahNumber);
      window.setTimeout(() => setWrongCard(null), 600);
    }
  };

  const handleChoicePick = (ayahNumber: number) => {
    if (result || question?.type !== 'choice') return;
    setChoicePicked(ayahNumber);
  };

  const confirmChoice = () => {
    if (question?.type !== 'choice' || choicePicked === null) return;
    void finish(choicePicked === question.answerAyah ? gradeChoiceResult(3) : gradeChoiceResult(1));
  };

  const questionLabel = useMemo(() => {
    if (!question) return '';
    if (question.type === 'order') return 'رتّب الآيات كما تُتلى';
    if (question.type === 'choice') return 'ما الآية التالية؟';
    if (question.type === 'write') return 'اكتب الآية التالية من حفظك';
    return 'اتلوها من حفظك ثم قارن';
  }, [question]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm md:pr-24 lg:pr-32 xl:pr-36">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="hifz-test-title"
        className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-xs animate-scale-in dark:border-primary-800 dark:bg-primary-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-primary-100 p-4 dark:border-primary-800">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-900/40 dark:text-gold-300">
              <Brain size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 id="hifz-test-title" className="text-base font-bold text-primary-900 dark:text-primary-50">
                اختبر حفظي — سورة {surah.name}
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                الآيات {toArabicNumber(rangeFrom)}
                {rangeTo !== rangeFrom ? `–${toArabicNumber(rangeTo)}` : ''}
                {existing && !result
                  ? ` · المراجعة السابقة: ${GRADE_LABELS_AR[existing.lastGrade]}، كل ${describeIntervalDays(existing.intervalDays).replace('بعد ', '')}`
                  : ''}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق الاختبار"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-primary-800/40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!question || saving ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400" role="status">
              جارٍ تجهيز السؤال…
            </p>
          ) : (
            <>
              {/* Which way the portion is questioned. Switching mode re-deals
                  the question, because `dealQuestion` is keyed on the mode. */}
              <div
                role="group"
                aria-label="نوع الاختبار"
                className="flex justify-center gap-1.5 rounded-xl bg-primary-50 p-1 dark:bg-primary-900/40"
              >
                {(
                  [
                    { id: 'auto', label: 'تلقائي', icon: Brain },
                    { id: 'write', label: 'اكتب الآية', icon: Keyboard },
                  ] as const
                ).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={saving || (id === 'write' && !canWrite)}
                    aria-pressed={mode === id}
                    title={id === 'write' && !canWrite ? 'النطاق آية واحدة — لا آية تالية تُكتب' : undefined}
                    onClick={() => setMode(id)}
                    className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      mode === id
                        ? 'bg-white text-primary-700 shadow-sm dark:bg-primary-800 dark:text-gold-300'
                        : 'text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-gold-300'
                    }`}
                  >
                    <Icon size={14} aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>

              <p className="text-center text-sm font-bold text-primary-700 dark:text-gold-300">
                {questionLabel}
              </p>

              {/* ---- Order quiz ---- */}
              {question.type === 'order' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap justify-center gap-1.5" aria-label="الترتيب الصحيح">
                    {question.shuffled.map((_, index) => (
                      <span
                        key={index}
                        className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-bold ${
                          index < orderPlaced.length
                            ? 'border-success-300 bg-success-50 text-success-700 dark:border-success-700 dark:bg-success-900/30 dark:text-success-300'
                            : 'border-primary-200 bg-gray-50 text-gray-300 dark:border-primary-700 dark:bg-primary-800/40 dark:text-gray-500'
                        }`}
                      >
                        {index < orderPlaced.length ? toArabicNumber(orderPlaced[index]) : toArabicNumber(index + 1)}
                      </span>
                    ))}
                  </div>
                  <div className="grid gap-2">
                    {question.shuffled.map((ayahNumber) => {
                      const placed = orderPlaced.includes(ayahNumber);
                      const text = getAyah(surah.id, ayahNumber)?.text ?? '';
                      return (
                        <button
                          key={ayahNumber}
                          type="button"
                          disabled={placed || !!result}
                          onClick={() => handleOrderTap(ayahNumber)}
                          className={`rounded-xl border p-3 text-right transition-all ${QURAN_FONT} text-base leading-loose ${
                            placed
                              ? 'border-primary-100 bg-gray-50 text-gray-300 opacity-50 dark:border-primary-800 dark:bg-primary-800/30 dark:text-gray-600'
                              : wrongCard === ayahNumber
                                ? 'animate-shake border-error-400 bg-error-50 text-error-700 dark:border-error-600 dark:bg-error-900/30 dark:text-error-300'
                                : 'border-primary-200 bg-white text-primary-900 hover:border-gold-300 hover:bg-gold-50 dark:border-primary-700 dark:bg-primary-900/50 dark:text-primary-50 dark:hover:border-gold-700'
                          }`}
                        >
                          {preview(text, 90)}
                        </button>
                      );
                    })}
                  </div>
                  {orderErrors > 0 && !result && (
                    <p className="text-center text-xs text-error-600 dark:text-error-400" aria-live="polite">
                      {toArabicNumber(orderErrors)} {orderErrors === 1 ? 'خطأ' : 'أخطاء'} حتى الآن — لا بأس، أكمل
                    </p>
                  )}
                </div>
              )}

              {/* ---- Choice quiz ---- */}
              {question.type === 'choice' && (
                <div className="space-y-3">
                  <p className={`rounded-xl border border-primary-100 bg-primary-50/60 p-3 text-center text-lg leading-loose text-primary-900 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-50 ${QURAN_FONT}`}>
                    {getAyah(surah.id, question.promptAyah)?.text ?? ''}
                  </p>
                  <div className="grid gap-2">
                    {question.options.map((ayahNumber) => {
                      const isAnswer = ayahNumber === question.answerAyah;
                      const picked = choicePicked === ayahNumber;
                      const revealed = choicePicked !== null;
                      return (
                        <button
                          key={ayahNumber}
                          type="button"
                          disabled={revealed || !!result}
                          onClick={() => handleChoicePick(ayahNumber)}
                          className={`rounded-xl border p-3 text-right transition-all ${QURAN_FONT} text-base leading-loose ${
                            revealed && isAnswer
                              ? 'border-success-400 bg-success-50 text-success-800 dark:border-success-600 dark:bg-success-900/30 dark:text-success-200'
                              : revealed && picked
                                ? 'border-error-400 bg-error-50 text-error-700 dark:border-error-600 dark:bg-error-900/30 dark:text-error-300'
                                : 'border-primary-200 bg-white text-primary-900 hover:border-gold-300 hover:bg-gold-50 dark:border-primary-700 dark:bg-primary-900/50 dark:text-primary-50 dark:hover:border-gold-700'
                          }`}
                        >
                          {preview(getAyah(surah.id, ayahNumber)?.text ?? '', 80)}
                        </button>
                      );
                    })}
                  </div>
                  {choicePicked !== null && !result && (
                    <button
                      type="button"
                      onClick={confirmChoice}
                      className="mx-auto flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-6 text-sm font-bold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                    >
                      <Check size={16} aria-hidden="true" />
                      {choicePicked === question.answerAyah ? 'صحيح — سجّل النتيجة' : 'سجّل النتيجة'}
                    </button>
                  )}
                </div>
              )}

              {/* ---- Writing quiz ---- */}
              {question.type === 'write' && (
                <div className="space-y-3">
                  <p className={`rounded-xl border border-primary-100 bg-primary-50/60 p-3 text-center text-lg leading-loose text-primary-900 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-50 ${QURAN_FONT}`}>
                    {getAyah(surah.id, question.promptAyah)?.text ?? ''}
                  </p>
                  <label className="block space-y-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      اكتب الآية {toArabicNumber(question.answerAyah)} — التشكيل غير مطلوب
                    </span>
                    <textarea
                      value={writtenText}
                      onChange={(event) => {
                        // Editing invalidates a comparison that was made against
                        // an earlier draft.
                        setWrittenText(event.target.value);
                        setDiff(null);
                      }}
                      disabled={!!diff || !!result || saving}
                      rows={4}
                      dir="rtl"
                      spellCheck={false}
                      placeholder="اكتب ما تتذكره من الآية…"
                      className={`w-full resize-none rounded-xl border border-primary-200 bg-white p-3 text-right text-base leading-loose text-primary-900 focus:outline-hidden focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-primary-700 dark:bg-primary-900/60 dark:text-primary-50 ${QURAN_FONT}`}
                    />
                  </label>

                  {!diff && !result && (
                    <button
                      type="button"
                      disabled={!writtenText.trim() || saving}
                      onClick={() => {
                        if (answerText !== null) setDiff(recallDiff(answerText, writtenText));
                      }}
                      className="mx-auto flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-6 text-sm font-bold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Check size={16} aria-hidden="true" />
                      قارن مع المصحف
                    </button>
                  )}

                  {/* The verdict, and what it was measured against: the mushaf's
                      own words with whatever the attempt dropped marked in it. */}
                  {diff && (
                    <div className="space-y-3">
                      <p
                        className="text-center text-sm font-bold text-primary-700 dark:text-gold-300"
                        aria-live="polite"
                      >
                        المطابقة {toArabicNumber(similarityPercent(diff.similarity))}٪
                      </p>
                      <p className={`rounded-xl border border-primary-100 bg-primary-50/60 p-3 text-center text-base leading-loose text-primary-900 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-50 ${QURAN_FONT}`}>
                        {diff.expected.map((segment, index) => (
                          <span
                            key={index}
                            className={
                              segment.matched
                                ? ''
                                : 'rounded bg-error-100 px-1 font-bold text-error-700 dark:bg-error-900/50 dark:text-error-300'
                            }
                          >
                            {segment.text}{' '}
                          </span>
                        ))}
                      </p>
                      {diff.extra.length > 0 && (
                        <p className="text-center text-xs text-error-600 dark:text-error-400">
                          زدت كلمات ليست في الآية: {diff.extra.join('، ')}
                        </p>
                      )}
                      <p className="text-center text-sm font-semibold text-gray-600 dark:text-gray-300">
                        سجّل كيف كانت؟
                      </p>
                      {gradeButtons(suggestedGrade)}
                    </div>
                  )}
                </div>
              )}

              {/* ---- Recall quiz ---- */}
              {question.type === 'recall' && (
                <div className="space-y-3">
                  {!recallRevealed ? (
                    <>
                      <p className="rounded-xl border border-dashed border-primary-300 bg-primary-50/50 p-6 text-center text-sm leading-relaxed text-primary-700 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200">
                        اتلو الآية {toArabicNumber(question.ayahNumber)} من سورة {surah.name} من حفظك،
                        ثم اكشف النص وقارن.
                      </p>
                      <button
                        type="button"
                        onClick={() => setRecallRevealed(true)}
                        className="mx-auto flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-6 text-sm font-bold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        <Eye size={16} aria-hidden="true" />
                        أظهر النص للمقارنة
                      </button>
                    </>
                  ) : (
                    <>
                      <p className={`rounded-xl border border-primary-100 bg-primary-50/60 p-4 text-center text-lg leading-loose text-primary-900 dark:border-primary-800 dark:bg-primary-900/40 dark:text-primary-50 ${QURAN_FONT}`}>
                        {answerText ?? ''}
                      </p>
                      <p className="text-center text-sm font-semibold text-gray-600 dark:text-gray-300">
                        كم كانت صعوبة الحفظ؟
                      </p>
                      {gradeButtons()}
                    </>
                  )}
                </div>
              )}

              {/* ---- Result ---- */}
              {result && (
                <Card className="border-success-200 bg-success-50/60 text-center dark:border-success-800 dark:bg-success-900/20">
                  <p className="text-lg font-bold text-success-700 dark:text-success-300">
                    تم تسجيل النتيجة: {GRADE_LABELS_AR[result.grade]}
                  </p>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {result.grade === 'again'
                      ? 'تعود هذه الآيات غدًا للمراجعة — الإعادة سر الحفظ.'
                      : `المراجعة القادمة ${describeIntervalDays(result.nextDays)}.`}
                  </p>
                  <button
                    type="button"
                    onClick={dealQuestion}
                    className="mx-auto mt-4 flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-6 text-sm font-bold text-white hover:bg-primary-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    <RotateCcw size={16} aria-hidden="true" />
                    سؤال آخر من النطاق نفسه
                  </button>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-primary-100 p-3 dark:border-primary-800">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 w-full rounded-xl bg-primary-50 text-sm font-bold text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary-500 dark:bg-primary-800 dark:text-primary-200 dark:hover:bg-primary-700"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
