'use client';

import { useEffect, useState } from 'react';
import { getTaxSettings, saveTaxSettings, TaxReportFormat } from '@/lib/api/tax-report';
import {
  getJurisdictionOptions,
  validateTIN,
  formatTIN,
  JurisdictionCode,
  JURISDICTION_CONFIGS,
} from '@/lib/tax/tin-validation';

export function TaxSettings() {
  const [jurisdiction, setJurisdiction] = useState<JurisdictionCode>('US');
  const [tin, setTin] = useState('');
  const [tinMasked, setTinMasked] = useState(false);
  const [preferredFormat, setPreferredFormat] = useState<TaxReportFormat>('csv');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [tinError, setTinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const config = JURISDICTION_CONFIGS[jurisdiction];

  // Load existing settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getTaxSettings();
        setJurisdiction(settings.jurisdiction);
        setPreferredFormat(settings.preferredFormat);
        if (settings.tin) {
          setTin(settings.tin);
          setTinMasked(true); // Show masked from API
        }
      } catch (error) {
        console.error('Failed to load tax settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleTINChange = (value: string) => {
    setTin(value);
    setTinMasked(false);

    // Clear error if user starts typing
    if (value.length > 0) {
      setTinError(null);
    }
  };

  const handleValidateTIN = () => {
    if (!tin) {
      setTinError(`${config.label} is required`);
      return;
    }

    const validation = validateTIN(tin, jurisdiction);
    if (!validation.valid) {
      setTinError(validation.error || 'Invalid TIN format');
      return;
    }

    setTinError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    // Validate TIN if provided
    if (tin && !tinMasked) {
      const validation = validateTIN(tin, jurisdiction);
      if (!validation.valid) {
        setSaveError(validation.error || 'Invalid TIN format');
        setSaving(false);
        return;
      }
    }

    try {
      await saveTaxSettings({
        jurisdiction,
        tin: tin && !tinMasked ? tin : undefined,
        tinEncrypted: true,
        preferredFormat,
      });

      setSaveSuccess(true);
      setTinMasked(tin ? true : false);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save tax settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-slate-500">Loading tax settings...</div>;
  }

  return (
    <div className="max-w-2xl bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
      <h2 className="text-lg font-bold text-slate-900 mb-6">Tax Settings & Reporting</h2>

      {/* Jurisdiction Selection */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          Tax Jurisdiction
        </label>
        <select
          value={jurisdiction}
          onChange={(e) => {
            setJurisdiction(e.target.value as JurisdictionCode);
            setTin('');
            setTinMasked(false);
            setTinError(null);
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {getJurisdictionOptions().map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-xs text-slate-500">{config.name}</p>
      </div>

      {/* TIN Input */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-slate-700 mb-2">
          {config.label}
          <span className="text-slate-400 font-normal text-xs ml-2">({config.format})</span>
        </label>
        <div className="relative">
          <input
            type={tinMasked ? 'password' : 'text'}
            value={tin}
            onChange={(e) => handleTINChange(e.target.value)}
            placeholder={config.example}
            disabled={tinMasked && !!tin} // Disable if showing masked
            className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500"
          />
          {tinMasked && tin && (
            <button
              type="button"
              onClick={() => {
                setTin('');
                setTinMasked(false);
                setTinError(null);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Update
            </button>
          )}
        </div>
        {tinError && <p className="mt-1 text-xs text-red-600">{tinError}</p>}
        {tin && !tinMasked && !tinError && (
          <p className="mt-1 text-xs text-slate-500">Example: {config.example}</p>
        )}
      </div>

      {/* Preferred Export Format */}
      <div className="mb-6">
        <label className="block text-sm font-semibold text-slate-700 mb-3">
          Preferred Tax Report Format
        </label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value="csv"
              checked={preferredFormat === 'csv'}
              onChange={() => setPreferredFormat('csv')}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-700">CSV (Excel-compatible)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              value="pdf"
              checked={preferredFormat === 'pdf'}
              onChange={() => setPreferredFormat('pdf')}
              className="w-4 h-4"
            />
            <span className="text-sm text-slate-700">PDF (Printable)</span>
          </label>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mb-6 bg-blue-50 border border-blue-200 rounded p-4">
        <p className="text-xs text-blue-900">
          <strong>Privacy & Security:</strong> Your Tax Identification Number (TIN) is encrypted
          using industry-standard AES-256 encryption and stored securely. It will only be included
          in your tax reports and is never shared with third parties.
        </p>
      </div>

      {/* Error Message */}
      {saveError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-3">
          <p className="text-sm text-red-700">{saveError}</p>
        </div>
      )}

      {/* Success Message */}
      {saveSuccess && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded p-3">
          <p className="text-sm text-green-700">✓ Tax settings saved successfully</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:bg-slate-300 cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
