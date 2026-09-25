'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface FeeConfiguration {
  id: string;
  dealType: string;
  investorTier: 'retail' | 'vip' | 'institutional';
  feeType: 'platform_origination' | 'platform_success' | 'investor_entry' | 'early_exit';
  ratePercent: number;
  description: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export default function FeeConfigurationEditPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isNew = params.id === 'new';
  const [isLoading, setIsLoading] = useState(!isNew);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [dealTypes, setDealTypes] = useState<string[]>([]);

  const [form, setForm] = useState<Partial<FeeConfiguration>>({
    dealType: '',
    investorTier: 'retail',
    feeType: 'platform_origination',
    ratePercent: 0,
    description: '',
    effectiveFrom: new Date().toISOString().split('T')[0],
    effectiveTo: null,
  });

  useEffect(() => {
    // Fetch deal types
    fetch('/api/admin/fee-configurations/deal-types', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then((r) => r.json())
      .then(setDealTypes)
      .catch(() => setError('Failed to load deal types'));

    // If editing, fetch the configuration
    if (!isNew) {
      fetch(`/api/admin/fee-configurations/${params.id}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
        .then((r) => r.json())
        .then((data) => {
          setForm({
            ...data,
            effectiveFrom: data.effectiveFrom.split('T')[0],
            effectiveTo: data.effectiveTo
              ? data.effectiveTo.split('T')[0]
              : null,
          });
          setIsLoading(false);
        })
        .catch(() => {
          setError('Failed to load configuration');
          setIsLoading(false);
        });
    }
  }, [isNew, params.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');

    try {
      const url = isNew
        ? '/api/admin/fee-configurations'
        : `/api/admin/fee-configurations/${params.id}`;

      const method = isNew ? 'POST' : 'PUT';

      const payload = {
        dealType: form.dealType,
        investorTier: form.investorTier,
        feeType: form.feeType,
        ratePercent: Number(form.ratePercent),
        description: form.description || null,
        effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom) : new Date(),
        effectiveTo: form.effectiveTo ? new Date(form.effectiveTo) : null,
      };

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save configuration');
      }

      router.push('/admin/fee-configurations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="p-6 text-center">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <Link
          href="/admin/fee-configurations"
          className="text-blue-600 hover:text-blue-900 mb-4 inline-block"
        >
          ← Back to Fee Configurations
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">
          {isNew ? 'Create Fee Configuration' : 'Edit Fee Configuration'}
        </h1>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div className="grid grid-cols-2 gap-6">
          {/* Deal Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Deal Type *
            </label>
            {isNew ? (
              <select
                value={form.dealType || ''}
                onChange={(e) => setForm({ ...form, dealType: e.target.value })}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select a deal type</option>
                {dealTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            ) : (
              <div className="px-3 py-2 bg-gray-100 rounded-lg text-gray-900">
                {form.dealType}
              </div>
            )}
          </div>

          {/* Investor Tier */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Investor Tier *
            </label>
            {isNew ? (
              <select
                value={form.investorTier || 'retail'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    investorTier: e.target.value as any,
                  })
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="retail">Retail</option>
                <option value="vip">VIP</option>
                <option value="institutional">Institutional</option>
              </select>
            ) : (
              <div className="px-3 py-2 bg-gray-100 rounded-lg text-gray-900">
                {form.investorTier}
              </div>
            )}
          </div>

          {/* Fee Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fee Type *
            </label>
            {isNew ? (
              <select
                value={form.feeType || 'platform_origination'}
                onChange={(e) =>
                  setForm({ ...form, feeType: e.target.value as any })
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="platform_origination">Platform Origination</option>
                <option value="platform_success">Platform Success</option>
                <option value="investor_entry">Investor Entry</option>
                <option value="early_exit">Early Exit</option>
              </select>
            ) : (
              <div className="px-3 py-2 bg-gray-100 rounded-lg text-gray-900">
                {form.feeType?.replace(/_/g, ' ')}
              </div>
            )}
          </div>

          {/* Rate Percent */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Rate (%) *
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              max="100"
              value={form.ratePercent || 0}
              onChange={(e) =>
                setForm({ ...form, ratePercent: parseFloat(e.target.value) })
              }
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Effective From */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Effective From *
            </label>
            {isNew ? (
              <input
                type="date"
                value={form.effectiveFrom || ''}
                onChange={(e) =>
                  setForm({ ...form, effectiveFrom: e.target.value })
                }
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            ) : (
              <div className="px-3 py-2 bg-gray-100 rounded-lg text-gray-900">
                {form.effectiveFrom}
              </div>
            )}
          </div>

          {/* Effective To */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Expires (Optional)
            </label>
            <input
              type="date"
              value={form.effectiveTo || ''}
              onChange={(e) =>
                setForm({ ...form, effectiveTo: e.target.value || null })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            <p className="text-xs text-gray-500 mt-1">Leave blank for indefinite</p>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Description (Optional)
          </label>
          <textarea
            value={form.description || ''}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="e.g., Special rate for Q2 2024"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 pt-4 border-t border-gray-200">
          <Link
            href="/admin/fee-configurations"
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSaving}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : isNew ? 'Create' : 'Update'}
          </button>
        </div>
      </form>
    </div>
  );
}
