import { useState } from 'react';
import { BookOpen, LockKeyhole, Mail, RefreshCcw } from 'lucide-react';
import { supabase } from '@/utils/supabaseClient';

interface AuthScreenProps {
  onAuthenticated: () => void;
}

export function AuthScreen({ onAuthenticated }: AuthScreenProps) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const resendConfirmation = async () => {
    if (!supabase || !email.trim()) {
      setError('أدخل البريد الإلكتروني أولاً ليتم إرسال رابط التأكيد مرة أخرى.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });

      if (resendError) throw resendError;
      setMessage('تم إرسال رابط التأكيد مرة أخرى. راجع بريدك الإلكتروني، وتأكد من مجلد الرسائل غير المرغوبة.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إرسال رابط التأكيد.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setError('إعداد الاتصال السحابي غير مكتمل.');
      return;
    }

    if (mode === 'sign-up' && password.length < 8) {
      setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      return;
    }

    setBusy(true);
    setMessage('');
    setError('');
    try {
      if (mode === 'sign-up') {
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password });
        if (authError) throw authError;
        if (data.user) localStorage.setItem(`zad-pending-signup:${data.user.id}`, 'true');
        if (data.session) {
          onAuthenticated();
        } else {
          setMessage('تم إنشاء الحساب. افحص بريدك الإلكتروني لتأكيده، ثم سجّل الدخول. إذا لم يظهر الرابط، أعد الإرسال من الزر أدناه.');
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        onAuthenticated();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إتمام تسجيل الدخول.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen min-h-dvh bg-surface-light dark:bg-surface-dark px-4 py-10 flex items-center justify-center" dir="rtl">
      <section className="w-full max-w-sm rounded-3xl border border-primary-100 bg-white p-6 shadow-xl dark:border-primary-800 dark:bg-primary-950">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-700 text-gold-300">
          <BookOpen size={28} />
        </div>
        <h1 className="text-center text-2xl font-bold text-primary-900 dark:text-primary-50">نور زاد | Nour ZAD</h1>
        <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-300">
          سجّل الدخول لمزامنة بياناتك بين أجهزتك بأمان.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-primary-800 dark:text-primary-100">البريد الإلكتروني</span>
            <span className="flex items-center gap-2 rounded-xl border border-primary-200 px-3 dark:border-primary-700">
              <Mail size={17} className="text-primary-500" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-transparent py-3 text-sm outline-none"
                dir="ltr"
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-primary-800 dark:text-primary-100">كلمة المرور</span>
            <span className="flex items-center gap-2 rounded-xl border border-primary-200 px-3 dark:border-primary-700">
              <LockKeyhole size={17} className="text-primary-500" />
              <input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent py-3 text-sm outline-none"
                dir="ltr"
              />
            </span>
            {mode === 'sign-up' && <span className="mt-1 block text-xs text-gray-500">8 أحرف على الأقل</span>}
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-primary-700 px-4 py-3 font-semibold text-white transition hover:bg-primary-800 disabled:opacity-60"
          >
            {busy ? 'جارٍ الاتصال...' : mode === 'sign-up' ? 'إنشاء حساب' : 'تسجيل الدخول'}
          </button>
        </form>

        {mode === 'sign-up' && email.trim() && (
          <button
            type="button"
            onClick={resendConfirmation}
            disabled={busy}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm font-medium text-primary-700 transition hover:bg-primary-100 disabled:opacity-60 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-200"
          >
            <RefreshCcw size={15} /> إعادة إرسال رابط التأكيد
          </button>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        {message && <p role="status" className="mt-4 rounded-lg bg-primary-50 p-3 text-sm text-primary-700 dark:bg-primary-900 dark:text-primary-200">{message}</p>}

        <button
          type="button"
          onClick={() => {
            setMode((current) => current === 'sign-in' ? 'sign-up' : 'sign-in');
            setError('');
            setMessage('');
            if (mode === 'sign-in') setPassword('');
          }}
          className="mt-5 w-full text-sm text-primary-700 underline dark:text-gold-300"
        >
          {mode === 'sign-up' ? 'لديك حساب؟ سجّل الدخول' : 'مستخدم جديد؟ أنشئ حسابًا'}
        </button>
      </section>
    </main>
  );
}
