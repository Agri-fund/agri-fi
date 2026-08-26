'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { FormField } from '@/components/ui/FormField';

const DEMOS = [
  { label: '👨‍🌾 Farmer',   email: 'farmer@agri-fi.demo',   color: 'hover:border-emerald-400 hover:bg-emerald-50' },
  { label: '💼 Investor', email: 'investor@agri-fi.demo', color: 'hover:border-blue-400 hover:bg-blue-50' },
  { label: '🤝 Trader',   email: 'trader@agri-fi.demo',   color: 'hover:border-violet-400 hover:bg-violet-50' },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-field validation state
  const [touched, setTouched] = useState({ email: false, password: false });
  const [errors, setErrors] = useState<{ email: string | undefined; password: string | undefined }>({
    email: undefined,
    password: undefined,
  });

  // Redirect already-logged-in users, clear stale data if role is missing
  useEffect(() => {
    const user = apiClient.getCurrentUser();
    if (!user) return;
    if (user.role) {
      router.replace(`/dashboard/${user.role}`);
    } else {
      // Stale/corrupt cached user — clear it
      apiClient.clearAuth();
    }
  }, [router]);

  /** Validate a single field and return its error (or undefined). */
  function validateField(field: 'email' | 'password', val: string): string | undefined {
    if (field === 'email') {
      if (!val.trim()) return 'Email is required';
      if (!EMAIL_REGEX.test(val)) return 'Email address is not valid';
    }
    if (field === 'password') {
      if (!val) return 'Password is required';
    }
    return undefined;
  }

  const handleEmailBlur = () => {
    setTouched(t => ({ ...t, email: true }));
    setErrors(e => ({ ...e, email: validateField('email', email) }));
  };

  const handlePasswordBlur = () => {
    setTouched(t => ({ ...t, password: true }));
    setErrors(e => ({ ...e, password: validateField('password', password) }));
  };

  /** Focus first invalid field by id after state updates. */
  function focusFirstInvalid(emailErr: string | undefined, passwordErr: string | undefined) {
    const fieldId = emailErr ? 'login-email' : passwordErr ? 'login-password' : null;
    if (fieldId) {
      (document.getElementById(fieldId) as HTMLElement | null)?.focus();
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Run all validations and mark all fields as touched
    const emailErr = validateField('email', email);
    const passwordErr = validateField('password', password);
    setErrors({ email: emailErr, password: passwordErr });
    setTouched({ email: true, password: true });

    if (emailErr || passwordErr) {
      // Use setTimeout to allow React to flush state before focusing
      setTimeout(() => focusFirstInvalid(emailErr, passwordErr), 0);
      return;
    }

    setLoading(true); setError(null);
    try {
      await apiClient.login(email, password);
      const profile = await apiClient.getMe();
      toast('Welcome back! 👋', 'success');
      router.push(`/dashboard/${profile.role}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? '';
      if (msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('unreachable')) {
        setError('Backend is not running. Start the backend server and try again.');
      } else if (!msg || msg === 'Not Found' || msg === 'Unauthorized') {
        setError('Invalid email or password.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel (decorative) ── */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-brand-gradient flex-col justify-between p-12">
        {/* Pattern */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="absolute -top-20 -right-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-black/10 rounded-full blur-3xl" />

        {/* Logo */}
        <Link href="/" className="relative flex items-center gap-2.5 w-fit">
          <span className="text-3xl">🌾</span>
          <span className="font-black text-white text-xl">AgriFi</span>
        </Link>

        {/* Quote */}
        <div className="relative">
          <div className="text-6xl text-white/20 font-serif leading-none mb-4">&ldquo;</div>
          <p className="text-white text-xl font-medium leading-relaxed mb-6">
            AgriFi gave me access to funding I never thought possible. My farm grew 3x in one season.
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">👨🏿‍🌾</div>
            <div>
              <p className="text-white font-semibold text-sm">Kwame Asante</p>
              <p className="text-brand-200 text-xs">Cocoa Farmer, Ghana</p>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="relative grid grid-cols-3 gap-4">
          {[['$2.4M+','Funded'],['340+','Projects'],['98%','Success']].map(([v,l]) => (
            <div key={l} className="bg-white/10 rounded-2xl p-4 text-center backdrop-blur-sm">
              <p className="text-white font-black text-xl">{v}</p>
              <p className="text-brand-200 text-xs mt-0.5">{l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right panel (form) ── */}
      <div className="flex-1 flex flex-col min-h-screen bg-white">
        {/* Mobile logo */}
        <div className="lg:hidden px-6 py-5 border-b border-slate-100">
          <Link href="/" className="flex items-center gap-2 w-fit">
            <span className="text-2xl">🌾</span>
            <span className="font-black text-slate-900 text-lg">AgriFi</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">Welcome back</h1>
              <p className="text-slate-500 mt-2">Sign in to your AgriFi account</p>
            </div>

            {/* Server-level error */}
            {error && (
              <div className="alert-error mb-5">
                <span className="text-base leading-none">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4" noValidate>
              {/* Email */}
              <FormField
                id="login-email"
                label="Email address"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={handleEmailBlur}
                error={errors.email}
                touched={touched.email}
                required
              />

              {/* Password — custom wrapper to keep the show/hide toggle */}
              <div>
                <div className="space-y-1">
                  <label htmlFor="login-password" className="label">
                    Password
                    <span className="text-red-500 ml-0.5" aria-hidden="true"> *</span>
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onBlur={handlePasswordBlur}
                      required
                      aria-invalid={touched.password && !!errors.password ? true : undefined}
                      aria-describedby={touched.password && errors.password ? 'login-password-error' : undefined}
                      className={[
                        'input pr-11',
                        touched.password && errors.password ? 'border-red-500' : '',
                        touched.password && !errors.password && password ? 'border-green-500' : '',
                      ].filter(Boolean).join(' ')}
                    />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors text-sm">
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                  {touched.password && errors.password && (
                    <p id="login-password-error" role="alert" className="text-xs text-red-600 flex items-center gap-1 mt-0.5">
                      <span aria-hidden="true">⚠</span>
                      {errors.password}
                    </p>
                  )}
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="btn-primary w-full py-3 text-base mt-2">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Signing in…
                  </span>
                ) : 'Sign in →'}
              </button>
            </form>

            {/* Demo accounts */}
            <div className="mt-7 pt-6 border-t border-slate-100">
              <p className="text-xs text-slate-400 text-center mb-3 font-medium">
                Try a demo account — password: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">Password123!</code>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {DEMOS.map(d => (
                  <button key={d.email} type="button"
                    onClick={() => { setEmail(d.email); setPassword('Password123!'); }}
                    className={`text-xs border border-slate-200 rounded-xl py-2 px-1.5 text-slate-600 transition-all ${d.color} font-medium`}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-center text-sm text-slate-500 mt-6">
              Don&apos;t have an account?{' '}
              <Link href="/register" className="text-brand-600 font-semibold hover:text-brand-700 hover:underline transition-colors">
                Sign up free
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
