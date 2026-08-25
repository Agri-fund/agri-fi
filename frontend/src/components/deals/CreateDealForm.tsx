'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useForm, useWatch, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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

const DRAFT_STORAGE_KEY = 'createDealForm.draft';
const DRAFT_SAVE_DEBOUNCE_MS = 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CreateDealForm: React.FC<CreateDealFormProps> = ({ onSuccess, onCancel }) => {
  const t = useTranslations('deals');
  const tc = useTranslations('common');

  const dealSchema = z.object({
    commodity: z.string().min(1, t('validation.commodityRequired')),
    quantity: z.number({ invalid_type_error: t('validation.invalidId') }).min(1, t('validation.quantityMin')),
    quantity_unit: z.enum(['kg', 'tons']),
    total_value: z.number({ invalid_type_error: t('validation.invalidId') }).min(1001, t('validation.totalValueMin')),
    token_price: z.number({ invalid_type_error: t('validation.invalidId') }).refine((val) => val === 100, {
      message: t('validation.tokenPriceFixed'),
    }),
    delivery_date: z.string().min(1, t('validation.deliveryDateRequired')).refine((val) => {
      const selectedDate = new Date(val);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return selectedDate > today;
    }, {
      message: t('validation.deliveryDateFuture'),
    }),
    farmer_id: z.string().uuid(t('validation.invalidId')).optional().or(z.literal('')),
    trader_id: z.string().uuid(t('validation.invalidId')).optional().or(z.literal('')),
  });

  type DealFormData = z.infer<typeof dealSchema>;

  const { toast, promise } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    control,
  } = useForm<DealFormData>({
    resolver: zodResolver(dealSchema),
    defaultValues: {
      commodity: '',
      quantity: 0,
      quantity_unit: 'kg' as 'kg' | 'tons',
      total_value: 0,
      token_price: 100,
      delivery_date: '',
      farmer_id: '',
      trader_id: '',
    },
  });

  const totalValue = useWatch({ control, name: 'total_value' }) || 0;
  const tokenPrice = useWatch({ control, name: 'token_price' }) || 0;
  const watchedValues = useWatch({ control });

  const [restoredAt, setRestoredAt] = useState<string | null>(null);
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
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { values: DealFormData; savedAt: string };
        if (parsed?.values) {
          reset(parsed.values);
          setRestoredAt(parsed.savedAt);
        }
      }
    } catch {
      // Corrupt or inaccessible localStorage — ignore and start fresh.
    }
    hasHydrated.current = true;
  }, [reset]);

  // Persist the draft to localStorage on field change, debounced by 1s.
  useEffect(() => {
    if (!hasHydrated.current) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(
          DRAFT_STORAGE_KEY,
          JSON.stringify({ values: watchedValues, savedAt: new Date().toISOString() })
        );
      } catch {
        // Storage full or unavailable — draft persistence is best-effort.
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [watchedValues]);

  const onSubmit: SubmitHandler<DealFormData> = async (data) => {
    // Clean up optional fields
    const payload = {
      ...data,
      farmer_id: data.farmer_id || undefined,
      trader_id: data.trader_id || undefined,
    };

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
      return response.json();
    });

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
      onSuccess?.();
    } catch (error: any) {
      console.error('Deal creation error:', error);
    }
  };

  return (
    <div className="bg-white rounded-lg">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">{t('createTitle')}</h2>

      {restoredAt && (
        <div className="alert-info mb-5">
          <span>💾</span>
          <p className="flex-1">
            {t('draftRestored', {
              time: new Date(restoredAt).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
          <button
            type="button"
            onClick={() => setRestoredAt(null)}
            className="text-blue-700 hover:text-blue-900 font-semibold text-xs flex-shrink-0"
          >
            {tc('dismiss')}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="flex flex-col">
          <label htmlFor="commodity" className="mb-1 text-sm font-semibold text-gray-700">
            {t('commodity')}
          </label>
          <input
            {...register('commodity')}
            id="commodity"
            placeholder="e.g. Cocoa, Coffee"
            className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
              errors.commodity ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.commodity && (
            <span className="text-red-500 text-xs mt-1 font-medium">{errors.commodity.message}</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col">
            <label htmlFor="quantity" className="mb-1 text-sm font-semibold text-gray-700">
              {t('quantity')}
            </label>
            <input
              {...register('quantity', { valueAsNumber: true })}
              id="quantity"
              type="number"
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
                errors.quantity ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.quantity && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.quantity.message}</span>
            )}
          </div>

          <div className="flex flex-col">
            <label htmlFor="quantity_unit" className="mb-1 text-sm font-semibold text-gray-700">
              {t('unit')}
            </label>
            <select
              {...register('quantity_unit')}
              id="quantity_unit"
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 bg-white ${
                errors.quantity_unit ? 'border-red-500' : 'border-gray-300'
              }`}
            >
              <option value="kg">kg</option>
              <option value="tons">tons</option>
            </select>
            {errors.quantity_unit && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.quantity_unit.message}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col">
            <label htmlFor="total_value" className="mb-1 text-sm font-semibold text-gray-700">
              {t('totalValue')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                {...register('total_value', { valueAsNumber: true })}
                id="total_value"
                type="number"
                className={`pl-7 pr-3 py-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
                  errors.total_value ? 'border-red-500' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.total_value && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.total_value.message}</span>
            )}
          </div>

          <div className="flex flex-col">
            <label htmlFor="token_price" className="mb-1 text-sm font-semibold text-gray-700">
              {t('tokenPrice')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                {...register('token_price', { valueAsNumber: true })}
                id="token_price"
                type="number"
                className={`pl-7 pr-3 py-2 w-full border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
                  errors.token_price ? 'border-red-500' : 'border-gray-300'
                }`}
              />
            </div>
            {errors.token_price && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.token_price.message}</span>
            )}
          </div>
        </div>

        {totalValue > 1000 && tokenPrice === 100 && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3 flex items-center gap-2">
            <span className="text-green-600 text-lg">🪙</span>
            <span className="text-sm text-green-800">
              {t('tokenInfo', { count: Math.floor(totalValue / 100), price: 100 })}
            </span>
          </div>
        )}

        <div className="flex flex-col">
          <label htmlFor="delivery_date" className="mb-1 text-sm font-semibold text-gray-700">
            {t('deliveryDate')}
          </label>
          <input
            {...register('delivery_date')}
            id="delivery_date"
            type="date"
            className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
              errors.delivery_date ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {errors.delivery_date && (
            <span className="text-red-500 text-xs mt-1 font-medium">{errors.delivery_date.message}</span>
          )}
        </div>

        <div className="space-y-4 pt-4 border-t border-gray-100">
          <div className="flex flex-col">
            <label htmlFor="farmer_id" className="mb-1 text-sm font-semibold text-gray-700">
              {t('farmerId')}
            </label>
            <input
              {...register('farmer_id')}
              id="farmer_id"
              placeholder="UUID"
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
                errors.farmer_id ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.farmer_id && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.farmer_id.message}</span>
            )}
          </div>

          <div className="flex flex-col">
            <label htmlFor="trader_id" className="mb-1 text-sm font-semibold text-gray-700">
              {t('traderId')}
            </label>
            <input
              {...register('trader_id')}
              id="trader_id"
              placeholder="UUID"
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 ${
                errors.trader_id ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.trader_id && (
              <span className="text-red-500 text-xs mt-1 font-medium">{errors.trader_id.message}</span>
            )}
          </div>
        </div>

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
};
