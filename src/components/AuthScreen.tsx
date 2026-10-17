import { useState } from 'react';
import { BookOpen, LockKeyhole, Mail, RefreshCcw, Sun, Moon, Monitor, Sparkles, Palette, Check, X } from 'lucide-react';
import { supabase } from '@/utils/supabaseClient';
import { useTheme } from '@/hooks/useApp';
import { COLOR_PALETTES, type ColorPalette } from '@/utils/colorThemes';

interface AuthScreenProps {
  onAuthenticated: () => void;
  /** The on-device passage: use the app without an account, and without the network. */
  onContinueOffline: () => void;
}

export function AuthScreen({ onAuthenticated, onContinueOffline }: AuthScreenProps) {
  const { themeMode, changeTheme, colorPalette, changeColorPalette } = useTheme();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPaletteDropdown, setShowPaletteDropdown] = useState(false);

  // Apply color palette immediately on selection (even before auth)
  const handleColorChange = async (palette: ColorPalette) => {
    await changeColorPalette(palette);
    // Force immediate update of CSS variables
    document.documentElement.dataset.palette = palette;
    const themeColor = COLOR_PALETTES.find((item) => item.id === palette)?.color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor ?? '#1f734e');
  };

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
    <main className="relative min-h-screen min-h-dvh bg-surface-light dark:bg-surface-dark px-4 py-10 flex items-center justify-center transition-colors duration-500 overflow-hidden" dir="rtl">
      {/* Background Decorative Ambient Radial Glows */}
      <div className="pointer-events-none absolute top-1/4 right-1/2 h-96 w-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-primary-600/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-gold-400/10 blur-3xl" />

      {/* Main Glassmorphism Auth Container */}
      <section className="relative w-full max-w-sm sm:max-w-md lg:max-w-lg rounded-3xl border border-primary-200/60 bg-white/90 p-6 shadow-2xl backdrop-blur-xl dark:border-primary-800/80 dark:bg-primary-950/85 transition-all duration-300">
        
        {/* Top Header Controls: Theme Mode & Color Palette Switcher */}
        <div className="mb-6 flex items-center justify-between border-b border-primary-100 pb-4 dark:border-primary-900">
          {/* Theme Mode Selector (Light / Dark / System) */}
          <div className="flex items-center gap-1 rounded-xl bg-primary-50 p-1 dark:bg-primary-900/60 border border-primary-200/50 dark:border-primary-800/50">
            <button
              type="button"
              onClick={() => void changeTheme('light')}
              title="الوضع الفاتح"
              aria-label="الوضع الفاتح"
              className="rounded-lg min-h-10 min-w-10 p-2.5 md:p-3 text-xs transition"
              style={{
                background: themeMode === 'light' ? 'var(--brand-from, #1f734e)' : 'transparent',
                color: themeMode === 'light' ? 'white' : '#6b7280'
              }}
            >
              <Sun size={15} />
            </button>
            <button
              type="button"
              onClick={() => void changeTheme('dark')}
              title="الوضع الداكن"
              aria-label="الوضع الداكن"
              className="rounded-lg min-h-10 min-w-10 p-2.5 md:p-3 text-xs transition"
              style={{
                background: themeMode === 'dark' ? 'var(--brand-from, #1f734e)' : 'transparent',
                color: themeMode === 'dark' ? 'white' : '#6b7280'
              }}
            >
              <Moon size={15} />
            </button>
            <button
              type="button"
              onClick={() => void changeTheme('system')}
              title="حسب النظام"
              aria-label="حسب النظام"
              className="rounded-lg min-h-10 min-w-10 p-2.5 md:p-3 text-xs transition"
              style={{
                background: themeMode === 'system' ? 'var(--brand-from, #1f734e)' : 'transparent',
                color: themeMode === 'system' ? 'white' : '#6b7280'
              }}
            >
              <Monitor size={15} />
            </button>
          </div>

          {/* Color Palette Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPaletteDropdown(!showPaletteDropdown)}
              title="اختيار لون الواجهة"
              aria-label="اختيار لون الواجهة"
              className="relative h-10 w-10 rounded-xl border-2 transition-all duration-300 hover:scale-110 active:scale-95 shadow-lg"
              style={{
                borderColor: 'var(--brand-from, #1f734e)',
                background: 'var(--brand-gradient, linear-gradient(135deg, #1f734e 0%, #2f8f64 45%, #b84414 100%))',
                boxShadow: `0 4px 12px var(--brand-glow, rgba(31,115,78,0.22))`
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <Palette size={18} className="text-white drop-shadow-sm" />
              </div>
              {/* Glow effect */}
              <div
                className="absolute inset-0 rounded-xl opacity-0 hover:opacity-30 transition-opacity"
                style={{
                  background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)'
                }}
              />
            </button>

            {/* Dropdown Menu */}
            {showPaletteDropdown && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowPaletteDropdown(false)}
                />
                <div className="absolute top-full left-0 mt-2 z-50 w-64 rounded-2xl border bg-white p-4 shadow-2xl backdrop-blur-xl dark:border-primary-700 dark:bg-primary-950">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-primary-900 dark:text-primary-100">اختر اللون</span>
                    <button
                      type="button"
                      onClick={() => setShowPaletteDropdown(false)}
                      className="p-1 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-800"
                    >
                      <X size={16} className="text-gray-500 dark:text-gray-400" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {COLOR_PALETTES.map((palette) => {
                      const selected = colorPalette === palette.id;
                      return (
                        <button
                          key={palette.id}
                          type="button"
                          onClick={() => {
                            handleColorChange(palette.id as ColorPalette);
                            setShowPaletteDropdown(false);
                          }}
                          title={`سمة ${palette.name}`}
                          aria-label={`سمة ${palette.name}`}
                          className="relative flex flex-col items-center gap-1.5 rounded-xl p-2 transition-all duration-300 hover:scale-105"
                          style={{
                            background: selected ? palette.gradient : '#f9fafb',
                            boxShadow: selected ? `0 4px 12px ${palette.glow}` : '0 1px 3px rgba(0,0,0,0.1)',
                            border: selected ? `2px solid ${palette.color}` : '1px solid #e5e7eb'
                          }}
                        >
                          <div className="flex items-center gap-0.5">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.color }} />
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.accent }} />
                          </div>
                          <span
                            className="text-[10px] font-bold"
                            style={{ color: selected ? 'white' : palette.color }}
                          >
                            {palette.name}
                          </span>
                          {selected && (
                            <div className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-white shadow-md">
                              <Check size={10} style={{ color: palette.color }} strokeWidth={3} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Brand Logo & Header */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-tr from-primary-700 to-primary-600 text-gold-300 shadow-lg shadow-primary-900/30">
          <BookOpen size={28} />
        </div>
        <h1 className="text-center text-2xl font-bold text-primary-900 dark:text-primary-50">قُرّة</h1>
        <p className="mt-1.5 text-center text-xs sm:text-sm text-primary-700/80 dark:text-primary-300 leading-relaxed">
          سجّل الدخول لمزامنة بياناتك وسورك وحفظك بأمان بين جميع أجهزتك.
        </p>

        {/* Auth Form */}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-primary-900 dark:text-primary-100">البريد الإلكتروني</span>
            <span className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/50 px-3 transition-all focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/30 dark:border-primary-700/80 dark:bg-primary-900/40">
              <Mail size={17} className="text-primary-600 dark:text-gold-400 shrink-0" />
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full bg-transparent py-2.5 text-sm text-primary-900 outline-hidden placeholder:text-gray-400 dark:text-primary-50"
                placeholder="example@domain.com"
                dir="ltr"
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-primary-900 dark:text-primary-100">كلمة المرور</span>
            <span className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50/50 px-3 transition-all focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500/30 dark:border-primary-700/80 dark:bg-primary-900/40">
              <LockKeyhole size={17} className="text-primary-600 dark:text-gold-400 shrink-0" />
              <input
                type="password"
                autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full bg-transparent py-2.5 text-sm text-primary-900 outline-hidden placeholder:text-gray-400 dark:text-primary-50"
                placeholder="••••••••"
                dir="ltr"
              />
            </span>
            {mode === 'sign-up' && <span className="mt-1 block text-xs text-primary-600/70 dark:text-primary-300/70">8 أحرف على الأقل</span>}
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-linear-to-r from-primary-700 to-primary-600 py-3 font-bold text-white shadow-lg shadow-primary-950/20 transition-all hover:from-primary-600 hover:to-primary-500 active:scale-[0.99] disabled:opacity-60 text-sm"
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Sparkles size={16} className="animate-spin" /> جارٍ الاتصال...
              </span>
            ) : mode === 'sign-up' ? (
              'إنشاء حساب جديد'
            ) : (
              'تسجيل الدخول'
            )}
          </button>
        </form>

        {mode === 'sign-up' && email.trim() && (
          <button
            type="button"
            onClick={resendConfirmation}
            disabled={busy}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-xs font-semibold text-primary-800 transition hover:bg-primary-100 disabled:opacity-60 dark:border-primary-700 dark:bg-primary-900 dark:text-primary-200"
          >
            <RefreshCcw size={14} /> إعادة إرسال رابط التأكيد
          </button>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
            {error}
          </p>
        )}

        {message && (
          <p role="status" className="mt-4 rounded-xl border border-primary-200 bg-primary-50/90 p-3 text-xs text-primary-800 dark:border-primary-800 dark:bg-primary-900/80 dark:text-primary-200">
            {message}
          </p>
        )}

        <div className="mt-5 flex items-center justify-center">
          <button
            type="button"
            onClick={() => {
              setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'));
              setError('');
              setMessage('');
              if (mode === 'sign-in') setPassword('');
            }}
            className="group inline-flex items-center gap-1.5 rounded-full bg-primary-50/90 px-4 py-2 text-xs font-semibold text-primary-700 transition-all duration-200 hover:bg-primary-100 hover:scale-[1.02] active:scale-95 dark:bg-primary-900/50 dark:text-gold-300 dark:hover:bg-primary-800/60 border border-primary-200/70 dark:border-primary-700/60 shadow-2xs cursor-pointer"
          >
            <span className="opacity-80">{mode === 'sign-up' ? 'لديك حساب بالفعل؟' : 'مستخدم جديد؟'}</span>
            <span className="font-bold text-primary-900 dark:text-white transition-colors group-hover:text-primary-600 dark:group-hover:text-gold-200">
              {mode === 'sign-up' ? 'سجّل الدخول' : 'إنشاء حساب جديد'}
            </span>
          </button>
        </div>

        {/* The account is an extra, not the door: the app is offline-first, and
            signing in is the one thing here that needs the network. Anyone without
            it — or simply without wanting an account — walks straight in, and the
            choice is remembered so this gate does not return on every launch. */}
        <div className="mt-6 border-t border-primary-100 pt-4 dark:border-primary-900">
          <button
            type="button"
            onClick={onContinueOffline}
            className="w-full rounded-xl border border-primary-200 bg-primary-50/60 py-2.5 text-xs font-semibold text-primary-800 transition hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/50 dark:text-primary-200 dark:hover:bg-primary-900"
          >
            المتابعة بدون حساب
          </button>
          <p className="mt-2 text-center text-[0.6875rem] leading-relaxed text-primary-700/70 dark:text-primary-300/70">
            كل بياناتك تبقى على هذا الجهاز، ويمكنك إنشاء حساب لاحقًا لمزامنتها بين أجهزتك.
          </p>
        </div>
      </section>
    </main>
  );
}
