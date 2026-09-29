'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { FormField } from '@/components/ui/FormField';

const DEMOS = [
  { label: '👨‍🌾 Farmer',   email: 'farmer@agri-fi.demo',   color: 'hover:border-emerald-400 hover:bg-emerald-50' },
  { label: '💼 Investor', email: 'investor@agri-fi.demo', color: 'hover:border-blue-400 hover:bg-blue-50' },
  { label: '🤝 Trader',   email: 'trader@agri-fi.demo',   color: 'hover:border-violet-400 hover:bg-violet-50' },
];

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const tValidation = useTranslations('common.validation');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [touched, setTouched] = useState({ email: false, password: false });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const validateEmail = (value: string) => {
    if (!value.trim()) return tValidation('emailRequired');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return tValidation('emailInvalid');
    return undefined;
  };
  const validatePassword = (value: string) =>
    value.trim() ? undefined : tValidation('passwordRequired');

  // Redirect already-logged-in users, clear stale data if role is missing
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('notice') === 'password-changed') {
      setNotice('Password changed. Sign in with your new password.');
    }

    const oauthSuccess = new URLSearchParams(window.location.search).get('oauth') === 'success';
    if (oauthSuccess) {
      apiClient.getMe()
        .then(profile => router.replace(`/dashboard/${profile.role}`))
        .catch(() => setError('Google sign-in could not be completed. Please try again.'));
      return;
    }

    const user = apiClient.getCurrentUser();
    if (!user) return;
    if (user.role) {
      router.replace(`/dashboard/${user.role}`);
    } else {
      // Stale/corrupt cached user — clear it
      apiClient.clearAuth();
    }
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = { email: validateEmail(email), password: validatePassword(password) };
    setFieldErrors(errors);
    setTouched({ email: true, password: true });
    if (errors.email || errors.password) {
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setLoading(true); setError(null);
    try {
      const result = await apiClient.login(email, password);

      // #806 — Admin accounts without MFA configured receive a 403 with
      // code MFA_ENROLLMENT_REQUIRED.  Redirect them to the MFA setup flow
      // instead of showing a generic error so they can complete enrollment.
      const body = result as any;
      if (
        body?.code === 'MFA_ENROLLMENT_REQUIRED' ||
        body?.requiresMfaEnrollment === true
      ) {
        toast('MFA setup required. Please configure your authenticator app.', 'info');
        router.push('/settings?tab=security&mfa=enroll');
        return;
      }

      const profile = await apiClient.getMe();
      toast('Welcome back! 👋', 'success');
      router.push(`/dashboard/${profile.role}`);
    } catch (err: any) {
      // #806 — The backend throws 403 ForbiddenException for MFA enrollment.
      // Catch it here so admin users are redirected instead of seeing an error.
      const code =
        err?.response?.data?.code ??
        err?.data?.code ??
        err?.code ??
        '';
      const requiresMfa =
        err?.response?.data?.requiresMfaEnrollment ??
        err?.data?.requiresMfaEnrollment ??
        false;

      if (code === 'MFA_ENROLLMENT_REQUIRED' || requiresMfa) {
        toast('MFA setup required for your account. Redirecting to security settings…', 'info');
        router.push('/settings?tab=security&mfa=enroll');
        return;
      }

      const msg = err?.response?.data?.message ?? err?.message ?? '';
      if (msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('unreachable')) {
        setError('Backend is not running. Start the backend server and try again.');
      } else if (!msg || msg === 'Not Found' || msg === 'Unauthorized' || msg.toLowerCase().includes('invalid credential')) {
        const credentialError = tValidation('credentialsInvalid');
        setFieldErrors(current => ({ ...current, password: credentialError }));
        setTouched(current => ({ ...current, password: true }));
        passwordRef.current?.focus();
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

            {/* Error */}
            {error && (
              <div role="alert" className="alert-error mb-5">
                <span className="text-base leading-none">⚠</span>
                <span>{error}</span>
              </div>
            )}
            {notice && <p role="status" className="mb-5 text-sm text-emerald-700">{notice}</p>}

            {/* Form */}
            <form onSubmit={handleLogin} noValidate className="space-y-4">
              <FormField
                ref={emailRef}
                label="Email address"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                error={fieldErrors.email}
                touched={touched.email}
                success={!fieldErrors.email && !!email.trim()}
                onBlur={() => {
                  setTouched(current => ({ ...current, email: true }));
                  setFieldErrors(current => ({ ...current, email: validateEmail(email) }));
                }}
                onChange={e => {
                  const value = e.target.value;
                  setEmail(value);
                  if (touched.email) setFieldErrors(current => ({ ...current, email: validateEmail(value) }));
                }}
              />

              <div className="relative">
                <FormField
                  ref={passwordRef}
                  label="Password"
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  className="pr-20"
                  error={fieldErrors.password}
                  touched={touched.password}
                  success={!fieldErrors.password && !!password.trim()}
                  onBlur={() => {
                    setTouched(current => ({ ...current, password: true }));
                    setFieldErrors(current => ({ ...current, password: validatePassword(password) }));
                  }}
                  onChange={e => {
                    const value = e.target.value;
                    setPassword(value);
                    if (touched.password) setFieldErrors(current => ({ ...current, password: validatePassword(value) }));
                  }}
                />
                <button type="button" aria-label={showPw ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-10 bottom-3 text-slate-400 hover:text-slate-600 transition-colors text-sm">
                  {showPw ? '🙈' : '👁'}
                </button>
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

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
              <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-slate-400">or</span></div>
            </div>

            <a
              href="http://localhost:3001/v1/auth/google"
              className="w-full py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
            >
              <span className="font-bold text-base">G</span>
              Continue with Google
            </a>

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
