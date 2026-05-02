'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/Toast';

type Mode = 'individual' | 'business';

export default function KycPage() {
  const router = useRouter();
  const { toast } = useToast();
  const currentUser = useMemo(() => apiClient.getCurrentUser(), []);

  const [mode, setMode] = useState<Mode>('individual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [governmentIdUrl, setGovernmentIdUrl] = useState('');
  const [proofOfAddressUrl, setProofOfAddressUrl] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [businessLicenseUrl, setBusinessLicenseUrl] = useState('');
  const [articlesOfIncorporationUrl, setArticlesOfIncorporationUrl] = useState('');

  useEffect(() => {
    if (!currentUser) router.push('/login');
  }, [currentUser, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const payload = mode === 'business'
        ? { isCorporate: true, companyName: companyName || undefined, registrationNumber: registrationNumber || undefined, businessLicenseUrl: businessLicenseUrl || undefined, articlesOfIncorporationUrl: articlesOfIncorporationUrl || undefined }
        : { isCorporate: false, governmentIdUrl: governmentIdUrl || undefined, proofOfAddressUrl: proofOfAddressUrl || undefined };
      await apiClient.submitKyc(payload);
      setSubmitted(true);
      toast('KYC submitted successfully!', 'success');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'KYC submission failed');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex items-center justify-center px-4">
        <div className="card p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex items-center justify-center text-3xl mx-auto mb-5">✅</div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">KYC Submitted!</h2>
          <p className="text-slate-500 mb-6">Your verification is under review. You&apos;ll be notified once approved.</p>
          <Link href="/dashboard" className="btn-primary mx-auto">Go to Dashboard →</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex flex-col">
      <div className="px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-black text-slate-900 w-fit">
          <span className="text-2xl">🌾</span> AgriFi
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">KYC Verification</h1>
            <p className="text-slate-500 mt-2">Verify your identity to unlock full platform access</p>
          </div>

          <div className="card p-8">
            <form onSubmit={submit} className="space-y-5">
              {error && <div className="alert-error"><span>⚠</span><span>{error}</span></div>}

              {/* Mode toggle */}
              <div>
                <label className="label">Verification type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['individual', 'business'] as Mode[]).map(m => (
                    <button key={m} type="button"
                      onClick={() => setMode(m)}
                      className={`p-3 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${
                        mode === m
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                      }`}>
                      {m === 'individual' ? '👤 Individual' : '🏢 Business'}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'individual' ? (
                <>
                  <div>
                    <label className="label">Government ID URL</label>
                    <input className="input" type="url" placeholder="https://drive.google.com/..."
                      value={governmentIdUrl} onChange={e => setGovernmentIdUrl(e.target.value)} />
                    <p className="label-hint">Link to a hosted copy of your government-issued ID</p>
                  </div>
                  <div>
                    <label className="label">Proof of Address URL</label>
                    <input className="input" type="url" placeholder="https://drive.google.com/..."
                      value={proofOfAddressUrl} onChange={e => setProofOfAddressUrl(e.target.value)} />
                    <p className="label-hint">Utility bill, bank statement, etc.</p>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Company Name</label>
                    <input className="input" placeholder="Acme Agriculture Ltd."
                      value={companyName} onChange={e => setCompanyName(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Registration Number</label>
                    <input className="input" placeholder="RC-123456"
                      value={registrationNumber} onChange={e => setRegistrationNumber(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Articles of Incorporation URL</label>
                    <input className="input" type="url" placeholder="https://..."
                      value={articlesOfIncorporationUrl} onChange={e => setArticlesOfIncorporationUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Business License URL <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input className="input" type="url" placeholder="https://..."
                      value={businessLicenseUrl} onChange={e => setBusinessLicenseUrl(e.target.value)} />
                  </div>
                </>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Submitting…
                  </span>
                ) : 'Submit KYC →'}
              </button>
            </form>

            <p className="text-center text-sm text-slate-500 mt-5">
              Already verified?{' '}
              <Link href="/dashboard" className="text-brand-600 font-semibold hover:underline">Go to Dashboard</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
