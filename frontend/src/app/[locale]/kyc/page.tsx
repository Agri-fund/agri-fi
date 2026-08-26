'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiClient, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { Dropzone, DropzoneFile } from '@/components/ui/Dropzone';
import { useTranslations } from 'next-intl';

type Step = 0 | 1 | 2 | 3 | 4;

interface DraftPayload {
  step: Step;
  personal: {
    fullName: string;
    dateOfBirth: string;
    nationality: string;
    address: string;
  };
  files: {
    frontName: string;
    backName: string;
    proofName: string;
    selfieName: string;
  };
  savedAt: string;
}

const LOCAL_KEY = 'kycWizard.draft.v1';
const AUTO_SAVE_MS = 30_000;

function emptyDraft(): DraftPayload {
  return {
    step: 0,
    personal: {
      fullName: '',
      dateOfBirth: '',
      nationality: '',
      address: '',
    },
    files: {
      frontName: '',
      backName: '',
      proofName: '',
      selfieName: '',
    },
    savedAt: new Date().toISOString(),
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('doc_type', 'purchase_agreement');
  formData.append('trade_deal_id', 'kyc-placeholder');

  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/documents`,
    {
      method: 'POST',
      headers: getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {},
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

export default function KycPage() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('kyc');
  const currentUser = useMemo(() => apiClient.getCurrentUser(), []);

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<DraftPayload>(emptyDraft());
  const [front, setFront] = useState<DropzoneFile | null>(null);
  const [back, setBack] = useState<DropzoneFile | null>(null);
  const [proof, setProof] = useState<DropzoneFile | null>(null);
  const [selfie, setSelfie] = useState<DropzoneFile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isHydrated = useRef(false);

  useEffect(() => {
    if (!currentUser) {
      router.push('/login');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const remote = await fetch('/api/auth/kyc/draft', {
          headers: getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {},
        });
        const remoteData = await remote.json().catch(() => ({}));

        const localRaw = localStorage.getItem(LOCAL_KEY);
        const localData = localRaw ? (JSON.parse(localRaw) as DraftPayload) : null;
        const incoming = (remoteData?.draft ?? localData) as DraftPayload | null;

        if (!cancelled && incoming) {
          setDraft({
            ...emptyDraft(),
            ...incoming,
            personal: {
              ...emptyDraft().personal,
              ...(incoming.personal ?? {}),
            },
            files: {
              ...emptyDraft().files,
              ...(incoming.files ?? {}),
            },
          });
          setStep(incoming.step ?? 0);
          setRestoredAt(incoming.savedAt ?? new Date().toISOString());
        }
      } catch {
        // If draft restore fails, we just start fresh.
      } finally {
        isHydrated.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, router]);

  useEffect(() => {
    return () => {
      [front, back, proof, selfie].forEach((file) => {
        if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      });
    };
  }, [front, back, proof, selfie]);

  const persistDraft = async (nextStep: Step, nextDraft = draft) => {
    const payload: DraftPayload = {
      ...nextDraft,
      step: nextStep,
      savedAt: new Date().toISOString(),
    };

    setDraft(payload);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(payload));
    } catch {
      // local draft persistence is best-effort
    }

    if (!isHydrated.current) return;

    try {
      await fetch('/api/auth/kyc/draft', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {}),
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Remote draft sync is best-effort; local storage keeps the flow resumable.
    }
  };

  useEffect(() => {
    if (!isHydrated.current) return;
    const timer = setInterval(() => {
      void persistDraft(step);
    }, AUTO_SAVE_MS);
    return () => clearInterval(timer);
  }, [step, draft]);

  const validateStep = (currentStep: Step): boolean => {
    const nextErrors: Record<string, string> = {};

    if (currentStep === 0) {
      if (!draft.personal.fullName.trim()) nextErrors.fullName = t('errors.fullName');
      if (!draft.personal.dateOfBirth.trim()) nextErrors.dateOfBirth = t('errors.dateOfBirth');
      else if (draft.personal.dateOfBirth > todayIso()) nextErrors.dateOfBirth = t('errors.dateOfBirthPast');
      if (!draft.personal.nationality.trim()) nextErrors.nationality = t('errors.nationality');
      if (!draft.personal.address.trim()) nextErrors.address = t('errors.address');
    }

    if (currentStep === 1) {
      if (!front) nextErrors.front = t('errors.frontRequired');
      if (!back) nextErrors.back = t('errors.backRequired');
      if (front && front.width && front.width < 500) nextErrors.front = t('errors.photoWidth');
      if (back && back.width && back.width < 500) nextErrors.back = t('errors.photoWidth');
    }

    if (currentStep === 2) {
      if (!proof) nextErrors.proof = t('errors.proofRequired');
      if (proof && proof.width && proof.width < 500 && proof.file.type.startsWith('image/')) {
        nextErrors.proof = t('errors.photoWidth');
      }
    }

    if (currentStep === 3) {
      if (!selfie) nextErrors.selfie = t('errors.selfieRequired');
      if (selfie && selfie.width && selfie.width < 500) nextErrors.selfie = t('errors.photoWidth');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = async () => {
    if (!validateStep(step)) return;
    await persistDraft((step + 1) as Step);
    setStep((current) => ((current + 1) as Step));
  };

  const goBack = () => setStep((current) => ((current > 0 ? current - 1 : current) as Step));

  const savePersonal = (field: keyof DraftPayload['personal'], value: string) => {
    setDraft((current) => ({
      ...current,
      personal: {
        ...current.personal,
        [field]: value,
      },
    }));
  };

  const submit = async () => {
    if (!validateStep(0) || !validateStep(1) || !validateStep(2) || !validateStep(3)) {
      return;
    }

    setSubmitting(true);
    try {
      const frontUrl = front ? await uploadFile(front.file) : '';
      const backUrl = back ? await uploadFile(back.file) : '';
      const proofUrl = proof ? await uploadFile(proof.file) : '';
      const selfieUrl = selfie ? await uploadFile(selfie.file) : '';

      const payload = {
        isCorporate: false,
        fullName: draft.personal.fullName,
        dateOfBirth: draft.personal.dateOfBirth,
        nationality: draft.personal.nationality,
        address: draft.personal.address,
        governmentIdUrl: frontUrl || undefined,
        identityDocumentBackUrl: backUrl || undefined,
        proofOfAddressUrl: proofUrl || undefined,
        selfieUrl: selfieUrl || undefined,
      };

      const result = await apiClient.submitKyc(payload);
      localStorage.removeItem(LOCAL_KEY);
      setDraft(emptyDraft());
      setFront(null);
      setBack(null);
      setProof(null);
      setSelfie(null);
      toast(t('submitted'), 'success');
      setStep(4);
      await persistDraft(4, emptyDraft());
      void result;
    } catch (error: any) {
      setErrors({ submit: error?.response?.data?.message ?? error?.message ?? t('errors.submitFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentUser) return null;

  const progress = ((step + 1) / 5) * 100;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.12),_transparent_32%),linear-gradient(180deg,_#f8fffb_0%,_#ffffff_48%,_#f7fafc_100%)]">
      <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-black text-slate-900">
            <span className="mr-2 text-2xl">🌾</span> AgriFi
          </Link>
          {restoredAt && <span className="text-xs text-slate-500">{t('restored', { time: new Date(restoredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>}
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white shadow-2xl shadow-emerald-100/60">
          <div className="bg-gradient-to-r from-emerald-800 via-lime-600 to-amber-500 px-6 py-6 text-white md:px-10">
            <p className="text-xs uppercase tracking-[0.35em] text-white/70">{t('badge')}</p>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-3xl font-black md:text-4xl">{t('title')}</h1>
                <p className="mt-2 max-w-2xl text-white/80">{t('subtitle')}</p>
              </div>
              <div className="rounded-full bg-white/10 px-4 py-2 text-sm">
                {t('stepLabel', { current: step + 1, total: 5 })}
              </div>
            </div>
            <div className="mt-5 h-2 rounded-full bg-white/15">
              <div className="h-2 rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="grid gap-8 px-6 py-6 md:px-10 md:py-8">
            {errors.submit && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errors.submit}</div>
            )}

            {step === 0 && (
              <section className="grid gap-4 md:grid-cols-2">
                <WizardField label={t('fields.fullName')} error={errors.fullName}>
                  <input className="input" value={draft.personal.fullName} onChange={(e) => savePersonal('fullName', e.target.value)} />
                </WizardField>
                <WizardField label={t('fields.dateOfBirth')} error={errors.dateOfBirth}>
                  <input type="date" className="input" value={draft.personal.dateOfBirth} onChange={(e) => savePersonal('dateOfBirth', e.target.value)} />
                </WizardField>
                <WizardField label={t('fields.nationality')} error={errors.nationality}>
                  <input className="input" value={draft.personal.nationality} onChange={(e) => savePersonal('nationality', e.target.value)} />
                </WizardField>
                <WizardField label={t('fields.address')} error={errors.address} className="md:col-span-2">
                  <textarea className="input min-h-[130px]" value={draft.personal.address} onChange={(e) => savePersonal('address', e.target.value)} />
                </WizardField>
              </section>
            )}

            {step === 1 && (
              <section className="grid gap-4 md:grid-cols-2">
                <WizardField label={t('fields.idFront')} error={errors.front} className="md:col-span-1">
                  <Dropzone
                    capture="environment"
                    maxSizeBytes={10 * 1024 * 1024}
                    label={t('fields.idFront')}
                    hint={t('hints.documents')}
                    onFileAccepted={(entry) => {
                      setFront(entry);
                      setDraft((current) => ({
                        ...current,
                        files: { ...current.files, frontName: entry.file.name },
                      }));
                    }}
                    value={front}
                    onRemove={() => setFront(null)}
                  />
                </WizardField>
                <WizardField label={t('fields.idBack')} error={errors.back}>
                  <Dropzone
                    capture="environment"
                    maxSizeBytes={10 * 1024 * 1024}
                    label={t('fields.idBack')}
                    hint={t('hints.documents')}
                    onFileAccepted={(entry) => {
                      setBack(entry);
                      setDraft((current) => ({
                        ...current,
                        files: { ...current.files, backName: entry.file.name },
                      }));
                    }}
                    value={back}
                    onRemove={() => setBack(null)}
                  />
                </WizardField>
              </section>
            )}

            {step === 2 && (
              <section className="grid gap-4">
                <WizardField label={t('fields.proofOfAddress')} error={errors.proof}>
                  <Dropzone
                    capture="environment"
                    maxSizeBytes={10 * 1024 * 1024}
                    label={t('fields.proofOfAddress')}
                    hint={t('hints.proof')}
                    onFileAccepted={(entry) => {
                      setProof(entry);
                      setDraft((current) => ({
                        ...current,
                        files: { ...current.files, proofName: entry.file.name },
                      }));
                    }}
                    value={proof}
                    onRemove={() => setProof(null)}
                  />
                </WizardField>
              </section>
            )}

            {step === 3 && (
              <section className="grid gap-4">
                <WizardField label={t('fields.selfie')} error={errors.selfie}>
                  <Dropzone
                    capture="user"
                    maxSizeBytes={10 * 1024 * 1024}
                    label={t('fields.selfie')}
                    hint={t('hints.selfie')}
                    onFileAccepted={(entry) => {
                      setSelfie(entry);
                      setDraft((current) => ({
                        ...current,
                        files: { ...current.files, selfieName: entry.file.name },
                      }));
                    }}
                    value={selfie}
                    onRemove={() => setSelfie(null)}
                  />
                </WizardField>
              </section>
            )}

            {step === 4 && (
              <section className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
                <div className="rounded-3xl border border-slate-200 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('review.personal')}</p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Row label={t('fields.fullName')} value={draft.personal.fullName} />
                    <Row label={t('fields.dateOfBirth')} value={draft.personal.dateOfBirth} />
                    <Row label={t('fields.nationality')} value={draft.personal.nationality} />
                    <Row label={t('fields.address')} value={draft.personal.address} />
                  </div>
                </div>
                <div className="rounded-3xl border border-slate-200 p-5">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('review.files')}</p>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <p>{t('fields.idFront')}: {draft.files.frontName || t('review.pending')}</p>
                    <p>{t('fields.idBack')}: {draft.files.backName || t('review.pending')}</p>
                    <p>{t('fields.proofOfAddress')}: {draft.files.proofName || t('review.pending')}</p>
                    <p>{t('fields.selfie')}: {draft.files.selfieName || t('review.pending')}</p>
                  </div>
                </div>
              </section>
            )}

            <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
              <button type="button" onClick={() => router.push('/dashboard')} className="btn-secondary md:order-2">
                {t('exit')}
              </button>
              <div className="flex gap-3 md:order-1">
                {step > 0 && (
                  <button type="button" onClick={goBack} className="btn-secondary">
                    {t('back')}
                  </button>
                )}
                {step < 4 ? (
                  <button type="button" onClick={goNext} className="btn-primary">
                    {t('next')}
                  </button>
                ) : (
                  <button type="button" onClick={submit} disabled={submitting} className="btn-primary">
                    {submitting ? t('submitting') : t('submit')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WizardField({ label, children, error, className }: { label: string; children: ReactNode; error?: string; className?: string }) {
  return (
    <label className={`space-y-2 ${className ?? ''}`}>
      <span className="text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">{label}</p>
      <p className="mt-1 font-medium text-slate-900">{value || '—'}</p>
    </div>
  );
}
