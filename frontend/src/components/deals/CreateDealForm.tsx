'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getOpenDeals, getStoredToken } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { useTranslations } from 'next-intl';

interface CoFarmerRow {
  email: string;
  portionPercent: string;
}

interface CreateDealFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

type Step = 0 | 1 | 2 | 3 | 4 | 5;
type RiskRating = 'Low' | 'Medium' | 'High';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CreateDealForm: React.FC<CreateDealFormProps> = ({ onSuccess, onCancel }) => {
  const t = useTranslations('deals');
  const tc = useTranslations('common');

interface DocumentItem {
  key: string;
  label: string;
  file: File | null;
}

interface LogisticsItem {
  milestone: string;
  timeline: string;
  owner: string;
}

interface DealDraft {
  title: string;
  commodity: string;
  country: string;
  region: string;
  short_description: string;
  long_description: string;
  quantity: number;
  quantity_unit: 'kg' | 'tons';
  total_value: number;
  min_investment_lot: number;
  expected_roi: number;
  duration_days: number;
  risk_rating: RiskRating;
  farm_location: string;
  farm_latitude: string;
  farm_longitude: string;
}

const STORAGE_KEY = 'createDealWizard.draft.v1';
const STEP_LABELS: Step[] = [0, 1, 2, 3, 4, 5];

const COMMODITY_DOCS: Record<string, Array<{ key: string; label: string }>> = {
  maize: [
    { key: 'soil_report', label: 'Soil report' },
    { key: 'contract', label: 'Offtake contract' },
  ],
  wheat: [
    { key: 'soil_report', label: 'Soil report' },
    { key: 'certification', label: 'Certification' },
  ],
  coffee: [
    { key: 'soil_report', label: 'Soil report' },
    { key: 'certification', label: 'Certification' },
    { key: 'contract', label: 'Supply contract' },
  ],
  cocoa: [
    { key: 'soil_report', label: 'Soil report' },
    { key: 'certification', label: 'Certification' },
    { key: 'contract', label: 'Supply contract' },
  ],
};

const DEFAULT_DOCS: Array<{ key: string; label: string }> = [
  { key: 'soil_report', label: 'Soil report' },
  { key: 'certification', label: 'Certification' },
  { key: 'contract', label: 'Contract' },
];

const LOGISTICS_PRESETS: Record<string, LogisticsItem[]> = {
  maize: [
    { milestone: 'Harvest completion', timeline: 'Week 1', owner: 'Farm lead' },
    { milestone: 'Warehouse intake', timeline: 'Week 2', owner: 'Logistics partner' },
    { milestone: 'Buyer handover', timeline: 'Week 4', owner: 'Trader' },
  ],
  coffee: [
    { milestone: 'Cherry sorting', timeline: 'Week 1', owner: 'Farm lead' },
    { milestone: 'Dry milling', timeline: 'Week 3', owner: 'Processor' },
    { milestone: 'Export dispatch', timeline: 'Week 6', owner: 'Shipping agent' },
  ],
  cocoa: [
    { milestone: 'Bean fermentation', timeline: 'Week 1', owner: 'Farm lead' },
    { milestone: 'Quality grading', timeline: 'Week 2', owner: 'Quality team' },
    { milestone: 'Container loading', timeline: 'Week 5', owner: 'Freight partner' },
  ],
};

function defaultDocuments(commodity: string): DocumentItem[] {
  const required = COMMODITY_DOCS[commodity.toLowerCase()] ?? DEFAULT_DOCS;
  return required.map((doc) => ({ ...doc, file: null }));
}

function defaultLogistics(commodity: string): LogisticsItem[] {
  return LOGISTICS_PRESETS[commodity.toLowerCase()] ?? [
    { milestone: 'Harvest readiness', timeline: 'Week 1', owner: 'Farm lead' },
    { milestone: 'Packing and QA', timeline: 'Week 2', owner: 'Operations' },
    { milestone: 'Shipment handover', timeline: 'Week 4', owner: 'Logistics partner' },
  ];
}

function loadImage(file: File): Promise<PhotoItem> {
  const previewUrl = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({
        file,
        previewUrl,
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error('Unable to read image dimensions'));
    };
    image.src = previewUrl;
  });
}

function money(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function asNumber(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function CreateDealForm({ onSuccess, onCancel }: CreateDealFormProps) {
  const t = useTranslations('deals');
  const tc = useTranslations('common');
  const { toast } = useToast();

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<DealDraft>({
    title: '',
    commodity: '',
    country: '',
    region: '',
    short_description: '',
    long_description: '',
    quantity: 0,
    quantity_unit: 'kg',
    total_value: 0,
    min_investment_lot: 0,
    expected_roi: 0,
    duration_days: 0,
    risk_rating: 'Medium',
    farm_location: '',
    farm_latitude: '',
    farm_longitude: '',
  });
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>(defaultDocuments(''));
  const [logisticsPlan, setLogisticsPlan] = useState<LogisticsItem[]>(defaultLogistics(''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const hasHydrated = useRef(false);

  // #891 — co-investment: optional co-farmer invitations created with the deal
  const [coFarmers, setCoFarmers] = useState<CoFarmerRow[]>([]);
  const [coFarmerError, setCoFarmerError] = useState<string | null>(null);

  const addCoFarmerRow = () => setCoFarmers((rows) => [...rows, { email: '', portionPercent: '' }]);
  const removeCoFarmerRow = (index: number) =>
    setCoFarmers((rows) => rows.filter((_, i) => i !== index));
  const updateCoFarmerRow = (index: number, patch: Partial<CoFarmerRow>) =>
    setCoFarmers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Validates the co-farmer rows; returns an i18n error key or null. */
  const validateCoFarmers = (): string | null => {
    let committedTotal = 0;
    for (const row of coFarmers) {
      if (!EMAIL_PATTERN.test(row.email)) return 'invalidEmail';
      const portion = Number(row.portionPercent);
      if (!row.portionPercent || Number.isNaN(portion) || portion <= 0 || portion > 100) {
        return 'invalidPortion';
      }
      committedTotal += portion;
    }
    if (committedTotal > 100) return 'totalTooHigh';
    return null;
  };

  // Restore a saved draft (if any) on mount, before the debounced-save effect
  // below starts running so we don't immediately clobber it with defaults.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          draft: DealDraft;
          step: Step;
          photos?: Array<{ previewUrl: string; width: number; height: number; name: string }>;
          documents?: Array<{ key: string; label: string; fileName?: string }>;
          logisticsPlan?: LogisticsItem[];
          savedAt?: string;
        };
        if (parsed?.draft) {
          setDraft(parsed.draft);
          setStep(parsed.step ?? 0);
          setDocuments((parsed.documents?.length ? parsed.documents : defaultDocuments(parsed.draft.commodity)).map((doc) => ({
            key: doc.key,
            label: doc.label,
            file: null,
          })));
          setLogisticsPlan(parsed.logisticsPlan?.length ? parsed.logisticsPlan : defaultLogistics(parsed.draft.commodity));
          setRestoredAt(parsed.savedAt ?? new Date().toISOString());
        }
      }
    } catch {
      // Ignore corrupt local state.
    }
    hasHydrated.current = true;
  }, []);

  useEffect(() => {
    return () => {
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    };
  }, [photos]);

  useEffect(() => {
    if (!hasHydrated.current) return;
    setSaving(true);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            draft,
            step,
            documents: documents.map((doc) => ({ key: doc.key, label: doc.label })),
            logisticsPlan,
            savedAt: new Date().toISOString(),
          }),
        );
      } catch {
        // Draft persistence is best-effort.
      } finally {
        setSaving(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, documents, logisticsPlan, step]);

  useEffect(() => {
    setDocuments(defaultDocuments(draft.commodity));
    setLogisticsPlan(defaultLogistics(draft.commodity));
  }, [draft.commodity]);

  const updateField = (key: keyof DealDraft, value: string | number) => {
    setDraft((current) => ({ ...current, [key]: value } as DealDraft));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const setDocFile = (key: string, file: File | null) => {
    setDocuments((current) => current.map((doc) => (doc.key === key ? { ...doc, file } : doc)));
  };

  const validateStep = async (currentStep: Step): Promise<boolean> => {
    const nextErrors: Record<string, string> = {};

    if (currentStep === 0) {
      if (!draft.title.trim()) nextErrors.title = t('validation.titleRequired');
      if (!draft.commodity.trim()) nextErrors.commodity = t('validation.commodityRequired');
      if (!draft.country.trim()) nextErrors.country = t('validation.countryRequired');
      if (!draft.short_description.trim()) nextErrors.short_description = t('validation.shortDescriptionRequired');

      if (!nextErrors.title) {
        try {
          const matches = await getOpenDeals(1, 20, { q: draft.title.trim() });
          const duplicate = matches.data.some((deal) => (deal.title ?? '').trim().toLowerCase() === draft.title.trim().toLowerCase());
          if (duplicate) nextErrors.title = t('validation.duplicateTitle');
        } catch {
          // If the duplicate lookup fails, we let the user continue and rely on backend validation too.
        }
      }
    }

    if (currentStep === 1) {
      if (draft.quantity <= 0) nextErrors.quantity = t('validation.quantityMin');
      if (draft.total_value <= 0) nextErrors.total_value = t('validation.totalValueMin');
      if (draft.min_investment_lot <= 0) nextErrors.min_investment_lot = t('validation.minInvestmentLot');
      if (draft.expected_roi <= 0) nextErrors.expected_roi = t('validation.expectedRoiMin');
      if (draft.duration_days <= 0) nextErrors.duration_days = t('validation.durationRequired');
      if (!draft.risk_rating) nextErrors.risk_rating = t('validation.riskRequired');
    }

    // Validate co-farmer rows before creating the deal (#891)
    const coFarmerValidation = validateCoFarmers();
    if (coFarmerValidation) {
      setCoFarmerError(coFarmerValidation);
      return;
    }
    setCoFarmerError(null);

    const creationPromise = fetch('/api/trade-deals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }).then(async (response) => {
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create deal');
      }
    }

    if (currentStep === 3) {
      const missingDoc = requiredDocs.find((doc) => !documents.find((entry) => entry.key === doc.key)?.file);
      if (missingDoc) nextErrors.documents = t('validation.documentRequired', { name: missingDoc.label });
    }

    if (currentStep === 4) {
      const invalidMilestone = logisticsPlan.find((entry) => !entry.milestone.trim() || !entry.timeline.trim() || !entry.owner.trim());
      if (invalidMilestone) nextErrors.logistics = t('validation.logisticsRequired');
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const goNext = async () => {
    if (!(await validateStep(step))) return;
    setStep((current) => (current < 5 ? ((current + 1) as Step) : current));
  };

  const goBack = () => setStep((current) => (current > 0 ? ((current - 1) as Step) : current));

  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files) return;
    const nextFiles = Array.from(files).slice(0, 10 - photos.length);
    const loaded: PhotoItem[] = [];
    for (const file of nextFiles) {
      loaded.push(await loadImage(file));
    }
    setPhotos((current) => current.concat(loaded));
  };

  const removePhoto = (previewUrl: string) => {
    setPhotos((current) => {
      const next = current.filter((photo) => photo.previewUrl !== previewUrl);
      const removed = current.find((photo) => photo.previewUrl === previewUrl);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const submit = async () => {
    if (!(await validateStep(4)) || !(await validateStep(3)) || !(await validateStep(2)) || !(await validateStep(1)) || !(await validateStep(0))) {
      setStep((current) => (current > 0 ? current : 0));
      return;
    }

    setSubmitting(true);
    try {
      const deal = await promise(creationPromise, {
        loading: tc('processing'),
        success: tc('success'),
        error: tc('error'),
      });

      // Fire the co-farmer invitations against the freshly created deal.
      // Best-effort: a failed invitation does not roll back deal creation.
      const dealId = (deal as { id?: string })?.id;
      if (dealId && coFarmers.length > 0) {
        const results = await Promise.allSettled(
          coFarmers.map((row) =>
            fetch(`/api/trade-deals/${dealId}/co-farmers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: row.email,
                portionPercent: Number(row.portionPercent),
              }),
            }).then((response) => {
              if (!response.ok) throw new Error(`Invite failed (${response.status})`);
            }),
          ),
        );
        if (results.some((r) => r.status === 'rejected')) {
          toast(t('coFarmers.inviteFailed'), 'error');
        }
      }

      reset();
      setCoFarmers([]);
      try {
        localStorage.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // Best-effort cleanup — nothing to do if storage is unavailable.
      }

      toast(t('submitSuccess'), 'success');
      localStorage.removeItem(STORAGE_KEY);
      setDraft({
        title: '',
        commodity: '',
        country: '',
        region: '',
        short_description: '',
        long_description: '',
        quantity: 0,
        quantity_unit: 'kg',
        total_value: 0,
        min_investment_lot: 0,
        expected_roi: 0,
        duration_days: 0,
        risk_rating: 'Medium',
        farm_location: '',
        farm_latitude: '',
        farm_longitude: '',
      });
      setPhotos([]);
      setDocuments(defaultDocuments(''));
      setLogisticsPlan(defaultLogistics(''));
      setStep(0);
      onSuccess?.();
    } catch (error: any) {
      setErrors({ submit: error?.message ?? t('validation.submitFailed') });
    } finally {
      setSubmitting(false);
    }
  };

  const warningHighRoi = draft.expected_roi > 50;

  return (
    <div className="rounded-3xl bg-white shadow-2xl shadow-emerald-100/50 border border-emerald-100 overflow-hidden">
      <div className="bg-gradient-to-r from-emerald-700 via-lime-600 to-amber-500 px-6 py-5 text-white">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-white/80">{t('wizardBadge')}</p>
            <h2 className="text-2xl md:text-3xl font-black mt-1">{t('createTitle')}</h2>
            <p className="text-white/80 mt-2 max-w-2xl">{t('createSubtitle')}</p>
          </div>
          <div className="hidden md:flex items-center gap-2 text-xs bg-white/10 rounded-full px-4 py-2">
            <span>{saving ? t('saving') : t('saved')}</span>
            {restoredAt && <span className="opacity-80">| {t('draftRestored', { time: new Date(restoredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-6 gap-2">
          {STEP_LABELS.map((idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setStep(idx)}
              className={`rounded-full px-2 py-2 text-[11px] font-semibold transition ${
                idx === step ? 'bg-white text-emerald-800' : idx < step ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70'
              }`}
            >
              {idx + 1}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 md:p-8">
        {errors.submit && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errors.submit}
          </div>
        )}

        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">{t(`steps.${step + 1}.eyebrow`)}</p>
            <h3 className="text-xl md:text-2xl font-black text-slate-900">{t(`steps.${step + 1}.title`)}</h3>
          </div>
          <div className="text-right text-sm text-slate-500">
            <p>{t('stepLabel', { current: step + 1, total: 6 })}</p>
          </div>
        </div>

        {step === 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('fields.title')} error={errors.title}>
              <input className="input" value={draft.title} onChange={(e) => updateField('title', e.target.value)} />
            </Field>
            <Field label={t('fields.commodity')} error={errors.commodity}>
              <input className="input" value={draft.commodity} onChange={(e) => updateField('commodity', e.target.value)} placeholder="Cocoa, maize, coffee" />
            </Field>
            <Field label={t('fields.country')} error={errors.country}>
              <input className="input" value={draft.country} onChange={(e) => updateField('country', e.target.value)} />
            </Field>
            <Field label={t('fields.region')} optional>
              <input className="input" value={draft.region} onChange={(e) => updateField('region', e.target.value)} />
            </Field>
            <Field label={t('fields.shortDescription')} error={errors.short_description} className="md:col-span-2">
              <textarea className="input min-h-[120px]" value={draft.short_description} onChange={(e) => updateField('short_description', e.target.value)} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('fields.quantity')} error={errors.quantity}>
              <input type="number" className="input" value={draft.quantity} onChange={(e) => updateField('quantity', asNumber(e.target.value))} />
            </Field>
            <Field label={t('fields.unit')}>
              <select className="input bg-white" value={draft.quantity_unit} onChange={(e) => updateField('quantity_unit', e.target.value)}>
                <option value="kg">kg</option>
                <option value="tons">tons</option>
              </select>
            </Field>
            <Field label={t('fields.totalValue')} error={errors.total_value}>
              <input type="number" className="input" value={draft.total_value} onChange={(e) => updateField('total_value', asNumber(e.target.value))} />
            </Field>
            <Field label={t('fields.minInvestment')} error={errors.min_investment_lot}>
              <input type="number" className="input" value={draft.min_investment_lot} onChange={(e) => updateField('min_investment_lot', asNumber(e.target.value))} />
            </Field>
            <Field label={t('fields.expectedRoi')} error={errors.expected_roi}>
              <input type="number" className="input" value={draft.expected_roi} onChange={(e) => updateField('expected_roi', asNumber(e.target.value))} />
            </Field>
            <Field label={t('fields.duration')} error={errors.duration_days}>
              <input type="number" className="input" value={draft.duration_days} onChange={(e) => updateField('duration_days', asNumber(e.target.value))} />
            </Field>
            <Field label={t('fields.risk')} error={errors.risk_rating}>
              <select className="input bg-white" value={draft.risk_rating} onChange={(e) => updateField('risk_rating', e.target.value as RiskRating)}>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </Field>
            <Field label={t('fields.roiWarning')} className="md:col-span-2">
              <div className={`rounded-2xl border px-4 py-3 text-sm ${warningHighRoi ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
                {warningHighRoi ? t('roiWarningHigh') : t('roiWarningNormal')}
              </div>
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('fields.longDescription')} error={errors.long_description} className="md:col-span-2">
              <textarea className="input min-h-[160px]" value={draft.long_description} onChange={(e) => updateField('long_description', e.target.value)} />
            </Field>
            <Field label={t('fields.farmLocation')} error={errors.farm_location}>
              <input className="input" value={draft.farm_location} onChange={(e) => updateField('farm_location', e.target.value)} />
            </Field>
            <Field label={t('fields.mapPoint')} error={errors.farm_location_map}>
              <div className="grid grid-cols-2 gap-3">
                <input className="input" value={draft.farm_latitude} onChange={(e) => updateField('farm_latitude', e.target.value)} placeholder="Latitude" />
                <input className="input" value={draft.farm_longitude} onChange={(e) => updateField('farm_longitude', e.target.value)} placeholder="Longitude" />
              </div>
            </Field>
            <Field label={t('fields.farmPhotos')} error={errors.photos} className="md:col-span-2">
              <div className="rounded-2xl border border-dashed border-slate-300 p-4">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="block w-full text-sm text-slate-600"
                  onChange={(e) => handlePhotoFiles(e.target.files)}
                />
                <p className="mt-2 text-xs text-slate-500">{t('photoHelper')}</p>
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                  {photos.map((photo) => (
                    <button key={photo.previewUrl} type="button" onClick={() => removePhoto(photo.previewUrl)} className="group rounded-2xl overflow-hidden border border-slate-200 text-left">
                      <img src={photo.previewUrl} alt={photo.file.name} className="h-32 w-full object-cover" />
                      <div className="p-2 text-xs text-slate-600">
                        <p className="font-semibold truncate">{photo.file.name}</p>
                        <p>{photo.width}px x {photo.height}px</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4 md:grid-cols-2">
            {requiredDocs.map((doc) => {
              const current = documents.find((item) => item.key === doc.key);
              return (
                <Field key={doc.key} label={doc.label}>
                  <div className="rounded-2xl border border-slate-200 p-4">
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg"
                      className="block w-full text-sm text-slate-600"
                      onChange={(e) => setDocFile(doc.key, e.target.files?.[0] ?? null)}
                    />
                    {current?.file && <p className="mt-2 text-xs text-slate-500">{current.file.name}</p>}
                  </div>
                </Field>
              );
            })}
            <Field label={t('fields.extraDocs')} className="md:col-span-2" error={errors.documents}>
              <p className="text-sm text-slate-500">{t('docHelper')}</p>
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-4">
            {logisticsPlan.map((item, index) => (
              <div key={index} className="grid gap-3 rounded-2xl border border-slate-200 p-4 md:grid-cols-3">
                <input className="input" value={item.milestone} onChange={(e) => setLogisticsPlan((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, milestone: e.target.value } : row))} placeholder={t('fields.milestone')} />
                <input className="input" value={item.timeline} onChange={(e) => setLogisticsPlan((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, timeline: e.target.value } : row))} placeholder={t('fields.timeline')} />
                <input className="input" value={item.owner} onChange={(e) => setLogisticsPlan((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, owner: e.target.value } : row))} placeholder={t('fields.owner')} />
              </div>
            ))}
            {errors.logistics && <p className="text-sm text-red-600">{errors.logistics}</p>}
          </div>
        )}

        {step === 5 && (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-3xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('preview.card')}</p>
              <div className="mt-4 rounded-3xl overflow-hidden border border-slate-200">
                <div className="h-2 bg-gradient-to-r from-emerald-500 to-lime-500" />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-xl font-black text-slate-900">{draft.title || t('preview.placeholderTitle')}</h4>
                      <p className="text-sm text-slate-500">{draft.commodity || t('preview.placeholderCommodity')}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{draft.risk_rating}</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{draft.short_description || t('preview.placeholderSummary')}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <Metric label={t('fields.totalValue')} value={money(draft.total_value)} />
                    <Metric label={t('fields.minInvestment')} value={money(draft.min_investment_lot)} />
                    <Metric label={t('fields.expectedRoi')} value={`${draft.expected_roi}%`} />
                    <Metric label={t('fields.duration')} value={`${draft.duration_days} days`} />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 p-5 shadow-sm space-y-4">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t('preview.detailPage')}</p>
              <div className="space-y-4 rounded-3xl bg-slate-50 p-5">
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">{t('fields.farmLocation')}</p>
                  <p className="font-semibold text-slate-900">{draft.farm_location}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">{t('fields.longDescription')}</p>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{draft.long_description}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">{t('preview.map')}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {draft.farm_latitude}, {draft.farm_longitude}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-xs text-slate-400 uppercase tracking-[0.2em]">{t('preview.documents')}</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {documents.filter((doc) => doc.file).map((doc) => (
                      <li key={doc.key}>{doc.label}: {doc.file?.name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3 border-t border-slate-100 pt-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn-secondary">
                {tc('dismiss')}
              </button>
            )}
            {step > 0 && (
              <button type="button" onClick={goBack} className="btn-secondary">
                {t('back')}
              </button>
            )}
          </div>

          <div className="flex gap-3">
            {step < 5 ? (
              <button type="button" onClick={goNext} className="btn-primary">
                {t('next')}
              </button>
            ) : (
              <button type="button" onClick={submit} disabled={submitting} className="btn-primary">
                {submitting ? tc('processing') : t('submitForReview')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

        {/* #891 — Co-investment: invite co-farmers onto this deal */}
        <div className="space-y-3 pt-4 border-t border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-800">{t('coFarmers.title')}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{t('coFarmers.description')}</p>
          </div>

          {coFarmers.map((row, index) => (
            <div key={index} className="grid grid-cols-[1fr_100px_auto] gap-2 items-start">
              <div className="flex flex-col">
                <label htmlFor={`co-farmer-email-${index}`} className="sr-only">
                  {t('coFarmers.emailLabel')}
                </label>
                <input
                  id={`co-farmer-email-${index}`}
                  type="email"
                  value={row.email}
                  onChange={(e) => updateCoFarmerRow(index, { email: e.target.value })}
                  placeholder="farmer@example.com"
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div className="flex flex-col">
                <label htmlFor={`co-farmer-portion-${index}`} className="sr-only">
                  {t('coFarmers.portionLabel')}
                </label>
                <input
                  id={`co-farmer-portion-${index}`}
                  type="number"
                  min="1"
                  max="100"
                  value={row.portionPercent}
                  onChange={(e) => updateCoFarmerRow(index, { portionPercent: e.target.value })}
                  placeholder="%"
                  className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <button
                type="button"
                onClick={() => removeCoFarmerRow(index)}
                className="px-3 py-2 text-sm text-red-600 hover:text-red-800 font-semibold"
              >
                {t('coFarmers.remove')}
              </button>
            </div>
          ))}

          {coFarmerError && (
            <span className="text-red-500 text-xs font-medium block">{t(`coFarmers.${coFarmerError}`)}</span>
          )}

          <button
            type="button"
            onClick={addCoFarmerRow}
            className="text-sm text-green-700 hover:text-green-900 font-semibold"
          >
            + {t('coFarmers.add')}
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-green-600 text-white font-bold py-3 px-4 rounded-md hover:bg-green-700 disabled:bg-green-300 transition-colors shadow-sm mt-6"
        >
          {isSubmitting ? t('creating') : t('createButton')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full bg-gray-100 text-gray-700 font-bold py-3 px-4 rounded-md hover:bg-gray-200 transition-colors mt-2"
          >
            {t('cancel')}
          </button>
        )}
      </form>
    </div>
  );
}
