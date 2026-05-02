'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/Toast';

const DEMOS = [
  { label: '👨‍🌾 Farmer',   email: 'farmer@agri-fi.demo',   color: 'hover:border-emerald-400 hover:bg-emerald-50' },
  { label: '💼 Investor', email: 'investor@agri-fi.demo', color: 'hover:border-blue-400 hover:bg-blue-50' },
  { label: '🤝 Trader',   email: 'trader@agri-fi.demo',   color: 'hover:border-violet-400 hover:bg-violet-50' },
];

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
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

            {/* Error */}
            {error && (
              <div className="alert-error mb-5">
                <span className="text-base leading-none">⚠</span>
                <span>{error}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email address</label>
                <input className="input" type="email" required autoComplete="email"
                  placeholder="you@example.com" value={email}
                  onChange={e => setEmail(e.target.value)} />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label mb-0">Password</label>
                </div>
                <div className="relative">
                  <input className="input pr-11" type={showPw ? 'text' : 'password'}
                    required autoComplete="current-password"
                    placeholder="••••••••" value={password}
                    onChange={e => setPassword(e.target.value)} />
                  <button type="button" tabIndex={-1}
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors text-sm">
                    {showPw ? '🙈' : '👁'}
                  </button>
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
