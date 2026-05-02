'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/Toast';

const ROLES = [
  { value: 'farmer',        emoji: '👨‍🌾', label: 'Farmer',   desc: 'List crops & raise funding',   color: 'border-emerald-400 bg-emerald-50 ring-emerald-400' },
  { value: 'investor',      emoji: '💼',   label: 'Investor', desc: 'Fund projects & earn returns', color: 'border-blue-400 bg-blue-50 ring-blue-400' },
  { value: 'trader',        emoji: '🤝',   label: 'Trader',   desc: 'Manage trade deals',           color: 'border-violet-400 bg-violet-50 ring-violet-400' },
  { value: 'company_admin', emoji: '🏢',   label: 'Company',  desc: 'Buy produce in bulk',          color: 'border-orange-400 bg-orange-50 ring-orange-400' },
];

const STEPS = ['Choose role', 'Your details', 'Done'];

export default function RegisterPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: '', country: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json();
        const msg = d.message ?? 'Registration failed';
        throw new Error(
          msg.toLowerCase().includes('unavailable') || res.status === 503
            ? 'Backend is not running. Start the backend server and try again.'
            : msg
        );
      }
      await apiClient.login(form.email, form.password);
      await apiClient.getMe();
      toast('Account created! Welcome to AgriFi 🎉', 'success');
      router.push('/kyc');
    } catch (err: any) {
      setError(err.message ?? 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left decorative panel ── */}
      <div className="hidden lg:flex lg:w-5/12 relative overflow-hidden bg-dark-gradient flex-col justify-between p-12">
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        <div className="absolute top-0 right-0 w-72 h-72 bg-brand-500/10 rounded-full blur-3xl" />

        <Link href="/" className="relative flex items-center gap-2.5 w-fit">
          <span className="text-3xl">🌾</span>
          <span className="font-black text-white text-xl">AgriFi</span>
        </Link>

        <div className="relative space-y-6">
          <h2 className="text-3xl font-black text-white leading-tight">
            Join the agricultural<br />finance revolution
          </h2>
          <div className="space-y-3">
            {[
              '🌍 Pan-African farmer network',
              '🔐 Stellar blockchain security',
              '📈 Transparent ROI tracking',
              '💸 Instant escrow payouts',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 text-slate-300 text-sm">
                <span className="text-base">{item.slice(0,2)}</span>
                <span>{item.slice(3)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative text-xs text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="text-brand-400 font-semibold hover:text-brand-300 transition-colors">Sign in</Link>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Mobile logo */}
        <div className="lg:hidden px-6 py-5 border-b border-slate-100">
          <Link href="/" className="flex items-center gap-2 w-fit">
            <span className="text-2xl">🌾</span>
            <span className="font-black text-slate-900 text-lg">AgriFi</span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            {/* Progress */}
            <div className="flex items-center gap-2 mb-8">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                    i < step ? 'bg-brand-600 text-white' :
                    i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' :
                    'bg-slate-100 text-slate-400'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span className={`text-xs font-medium hidden sm:block ${i === step ? 'text-slate-900' : 'text-slate-400'}`}>{s}</span>
                  {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-brand-400' : 'bg-slate-200'}`} />}
                </div>
              ))}
            </div>

            {/* Header */}
            <div className="mb-7">
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                {step === 0 ? 'What describes you?' : 'Create your account'}
              </h1>
              <p className="text-slate-500 mt-2 text-sm">
                {step === 0 ? 'Choose your role to get a personalized experience.' : 'Fill in your details to get started.'}
              </p>
            </div>

            {error && (
              <div className="alert-error mb-5">
                <span>⚠</span><span>{error}</span>
              </div>
            )}

            {/* Step 0: Role selection */}
            {step === 0 && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {ROLES.map(r => (
                    <button key={r.value} type="button"
                      onClick={() => { setForm(f => ({ ...f, role: r.value })); setStep(1); }}
                      className={`p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md active:scale-95 ${
                        form.role === r.value ? r.color + ' ring-2' : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}>
                      <div className="text-3xl mb-2">{r.emoji}</div>
                      <p className="font-bold text-slate-900 text-sm">{r.label}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{r.desc}</p>
                    </button>
                  ))}
                </div>
                <p className="text-center text-sm text-slate-500 pt-2">
                  Already have an account?{' '}
                  <Link href="/login" className="text-brand-600 font-semibold hover:underline">Sign in</Link>
                </p>
              </div>
            )}

            {/* Step 1: Details */}
            {step === 1 && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Selected role pill */}
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-xl">{ROLES.find(r => r.value === form.role)?.emoji}</span>
                  <span className="text-sm font-semibold text-slate-700">{ROLES.find(r => r.value === form.role)?.label}</span>
                  <button type="button" onClick={() => setStep(0)}
                    className="ml-auto text-xs text-brand-600 font-semibold hover:underline">Change</button>
                </div>

                <div>
                  <label className="label">Full name</label>
                  <input className="input" type="text" required placeholder="Amara Diallo"
                    value={form.name} onChange={set('name')} />
                </div>

                <div>
                  <label className="label">Email address</label>
                  <input className="input" type="email" required placeholder="you@example.com"
                    value={form.email} onChange={set('email')} />
                </div>

                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <input className="input pr-11" type={showPw ? 'text' : 'password'}
                      required minLength={8} placeholder="Min. 8 characters"
                      value={form.password} onChange={set('password')} />
                    <button type="button" tabIndex={-1}
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">
                      {showPw ? '🙈' : '👁'}
                    </button>
                  </div>
                  {form.password.length > 0 && (
                    <div className="mt-2 flex gap-1">
                      {[4,6,8].map(n => (
                        <div key={n} className={`flex-1 h-1 rounded-full transition-all ${
                          form.password.length >= n ? 'bg-brand-500' : 'bg-slate-200'
                        }`} />
                      ))}
                      <span className="text-xs text-slate-400 ml-1">
                        {form.password.length < 4 ? 'Weak' : form.password.length < 8 ? 'Fair' : 'Strong'}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="label">Country</label>
                  <input className="input" type="text" required placeholder="Nigeria"
                    value={form.country} onChange={set('country')} />
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setStep(0)} className="btn-secondary flex-none px-4">
                    ← Back
                  </button>
                  <button type="submit" disabled={loading} className="btn-primary flex-1 py-3">
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        Creating account…
                      </span>
                    ) : 'Create Account →'}
                  </button>
                </div>

                <p className="text-center text-xs text-slate-400">
                  By creating an account you agree to our{' '}
                  <span className="text-brand-600 cursor-pointer hover:underline">Terms of Service</span>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
