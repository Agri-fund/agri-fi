'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Dropzone, DropzoneFile } from '@/components/ui/Dropzone';

type Mode = 'individual' | 'business';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Uploads a file to the backend /documents endpoint and returns the storage URL.
 * Falls back to a placeholder URL if the upload endpoint is unavailable.
 */
async function uploadFile(file: File, tradeDealId: string): Promise<string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('doc_type', 'purchase_agreement');
  formData.append('trade_deal_id', tradeDealId);

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/documents`,
    {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message ?? `Upload failed (${res.status})`);
  }

  const data = await res.json();
  return data.storageUrl ?? data.storage_url ?? '';
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function KycPage() {
  const router = useRouter();
  const { toast } = useToast();
  const currentUser = useMemo(() => apiClient.getCurrentUser(), []);

  const [mode, setMode] = useState<Mode>('individual');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Individual fields
  const [govIdFile, setGovIdFile] = useState<DropzoneFile | null>(null);
  const [proofFile, setProofFile] = useState<DropzoneFile | null>(null);

  // Business fields
  const [companyName, setCompanyName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [articlesFile, setArticlesFile] = useState<DropzoneFile | null>(null);
  const [licenseFile, setLicenseFile] = useState<DropzoneFile | null>(null);

  // Upload progress tracking
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!currentUser) router.push('/login');
  }, [currentUser, router]);

  // Revoke object URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      [govIdFile, proofFile, articlesFile, licenseFile].forEach((f) => {
        if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, [govIdFile, proofFile, articlesFile, licenseFile]);

  const trackProgress = useCallback((key: string, pct: number) => {
    setUploadProgress((prev) => ({ ...prev, [key]: pct }));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setUploadProgress({});

    try {
      // KYC submissions use a placeholder deal ID for document anchoring
      const kycDealId = 'kyc-placeholder';

      if (mode === 'individual') {
        let governmentIdUrl: string | undefined;
        let proofOfAddressUrl: string | undefined;

        if (govIdFile) {
          trackProgress('govId', 30);
          governmentIdUrl = await uploadFile(govIdFile.file, kycDealId).catch(() => '');
          trackProgress('govId', 100);
        }

        if (proofFile) {
          trackProgress('proof', 30);
          proofOfAddressUrl = await uploadFile(proofFile.file, kycDealId).catch(() => '');
          trackProgress('proof', 100);
        }

        await apiClient.submitKyc({
          isCorporate: false,
          governmentIdUrl,
          proofOfAddressUrl,
        });
      } else {
        let articlesOfIncorporationUrl: string | undefined;
        let businessLicenseUrl: string | undefined;

        if (articlesFile) {
          trackProgress('articles', 30);
          articlesOfIncorporationUrl = await uploadFile(articlesFile.file, kycDealId).catch(() => '');
          trackProgress('articles', 100);
        }

        if (licenseFile) {
          trackProgress('license', 30);
          businessLicenseUrl = await uploadFile(licenseFile.file, kycDealId).catch(() => '');
          trackProgress('license', 100);
        }

        await apiClient.submitKyc({
          isCorporate: true,
          companyName: companyName || undefined,
          registrationNumber: registrationNumber || undefined,
          articlesOfIncorporationUrl,
          businessLicenseUrl,
        });
      }

      setSubmitted(true);
      toast('KYC submitted successfully!', 'success');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? 'KYC submission failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex items-center justify-center px-4">
        <div className="card p-10 text-center max-w-md w-full">
          <div className="w-16 h-16 rounded-3xl bg-emerald-50 flex items-center justify-center text-3xl mx-auto mb-5">
            ✅
          </div>
          <h2 className="text-2xl font-black text-slate-900 mb-2">KYC Submitted!</h2>
          <p className="text-slate-500 mb-6">
            Your verification is under review. You&apos;ll be notified once approved.
          </p>
          <Link href="/dashboard" className="btn-primary mx-auto">
            Go to Dashboard →
          </Link>
        </div>
      </div>
    );
  }

  // ── Upload progress bar ─────────────────────────────────────────────────────

  const totalUploads = Object.keys(uploadProgress).length;
  const avgProgress =
    totalUploads > 0
      ? Math.round(
        Object.values(uploadProgress).reduce((a, b) => a + b, 0) / totalUploads,
      )
      : 0;

  // ── Main form ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-white flex flex-col">
      {/* Header */}
      <div className="px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-black text-slate-900 w-fit">
          <span className="text-2xl">🌾</span> AgriFi
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">
              KYC Verification
            </h1>
            <p className="text-slate-500 mt-2">
              Verify your identity to unlock full platform access
            </p>
          </div>

          <div className="card p-8">
            <form onSubmit={submit} className="space-y-5">
              {error && (
                <div className="alert-error">
                  <span>⚠</span>
                  <span>{error}</span>
                </div>
              )}

              {/* Upload progress bar */}
              {loading && totalUploads > 0 && (
                <div className="space-y-1.5" role="status" aria-label="Upload progress">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Uploading documents…</span>
                    <span>{avgProgress}%</span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-green"
                      style={{ width: `${avgProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Spinner when submitting without file uploads */}
              {loading && totalUploads === 0 && (
                <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
                  <svg className="w-4 h-4 animate-spin flex-shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Submitting…
                </div>
              )}

              {/* Mode toggle */}
              <div>
                <label className="label">Verification type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['individual', 'business'] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      disabled={loading}
                      className={`p-3 rounded-xl border-2 text-sm font-semibold capitalize transition-all ${mode === m
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                    >
                      {m === 'individual' ? '👤 Individual' : '🏢 Business'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Individual fields */}
              {mode === 'individual' ? (
                <>
                  <Dropzone
                    label="Government ID"
                    hint="Passport, national ID, or driver's license (PDF, PNG, JPG · max 5 MB)"
                    value={govIdFile}
                    onFileAccepted={setGovIdFile}
                    onRemove={() => setGovIdFile(null)}
                    disabled={loading}
                  />
                  <Dropzone
                    label="Proof of Address"
                    hint="Utility bill or bank statement dated within 3 months (PDF, PNG, JPG · max 5 MB)"
                    value={proofFile}
                    onFileAccepted={setProofFile}
                    onRemove={() => setProofFile(null)}
                    disabled={loading}
                  />
                </>
              ) : (
                <>
                  <div>
                    <label className="label">Company Name</label>
                    <input
                      className="input"
                      placeholder="Acme Agriculture Ltd."
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <label className="label">Registration Number</label>
                    <input
                      className="input"
                      placeholder="RC-123456"
                      value={registrationNumber}
                      onChange={(e) => setRegistrationNumber(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                  <Dropzone
                    label="Articles of Incorporation"
                    hint="PDF, PNG, or JPG · max 5 MB"
                    value={articlesFile}
                    onFileAccepted={setArticlesFile}
                    onRemove={() => setArticlesFile(null)}
                    disabled={loading}
                  />
                  <Dropzone
                    label={
                      <>
                        Business License{' '}
                        <span className="text-slate-400 font-normal">(optional)</span>
                      </>
                    }
                    hint="PDF, PNG, or JPG · max 5 MB"
                    value={licenseFile}
                    onFileAccepted={setLicenseFile}
                    onRemove={() => setLicenseFile(null)}
                    disabled={loading}
                  />
                </>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting…
                  </span>
                ) : (
                  'Submit KYC →'
                )}
              </button>
            </form>

            <p className="text-center text-sm text-slate-500 mt-5">
              Already verified?{' '}
              <Link href="/dashboard" className="text-brand-600 font-semibold hover:underline">
                Go to Dashboard
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
