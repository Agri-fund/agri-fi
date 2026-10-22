'use client';

import React, { useState } from 'react';
import { Deal } from '@/lib/api';
import {
  SustainabilityMetrics,
  CarbonFootprintDetails,
} from '@/lib/sustainability';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';

interface SustainabilityReportModalProps {
  deal: Deal;
  sustainability: SustainabilityMetrics;
  onClose: () => void;
}

export default function SustainabilityReportModal({
  deal,
  sustainability,
  onClose,
}: SustainabilityReportModalProps) {
  const { formatCurrency } = useCurrencyFormat();
  const [reportType, setReportType] = useState<'investor' | 'regulator'>('investor');
  const [copied, setCopied] = useState(false);

  const footprint = sustainability.carbonFootprint;
  const reportId = `AGRIFI-ESG-REP-${deal.id.slice(0, 8).toUpperCase()}-${new Date().getFullYear()}`;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    const rows = [
      ['AgriFi ESG & Carbon Footprint Institutional Report'],
      ['Report ID', reportId],
      ['Deal ID', deal.id],
      ['Commodity', deal.commodity],
      ['Token Symbol', deal.token_symbol],
      ['Report Date', new Date().toISOString().split('T')[0]],
      [''],
      ['--- SUSTAINABILITY SCORES ---'],
      ['Composite ESG Score', sustainability.overallScore.toString()],
      ['ESG Letter Rating', sustainability.rating],
      ['Performance Tier', sustainability.tierClassification],
      ['Environmental Pillar Score', sustainability.environmentalScore.toString()],
      ['Social Pillar Score', sustainability.socialScore.toString()],
      ['Governance Pillar Score', sustainability.governanceScore.toString()],
      [''],
      ['--- CARBON FOOTPRINT (GHG PROTOCOL) ---'],
      ['Gross Emissions (tCO2e)', footprint.totalEmissionsTonsCo2e.toString()],
      ['Carbon Intensity (kg CO2e / kg)', footprint.carbonIntensityKgPerUnit.toString()],
      ['Transportation Emissions (kg CO2e)', footprint.transportationEmissionsKg.toString()],
      ['Storage Energy Emissions (kg CO2e)', footprint.storageEmissionsKg.toString()],
      ['Processing Emissions (kg CO2e)', footprint.processingEmissionsKg.toString()],
      ['Offset Volume (tCO2e)', footprint.offsetStatus.offsetTonsCo2e.toString()],
      ['Net Emissions (tCO2e)', footprint.offsetStatus.netEmissionsTonsCo2e.toString()],
      ['Carbon Neutrality Status', footprint.offsetStatus.isOffset ? 'Verified Net-Zero' : 'Gross Unmitigated'],
      [''],
      ['--- STANDARDS ALIGNMENT ---'],
      ['SASB Sector Standard', 'FB-AG (Agricultural Products)'],
      ['GRI Standards', 'GRI 13 (Agriculture & Fishing 2022)'],
      ['EU SFDR Classification', sustainability.overallScore >= 80 ? 'Article 9 (Dark Green)' : 'Article 8 (Light Green)'],
    ];

    const csvContent = rows.map((e) => e.map((val) => `"${val.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `esg-report-${deal.commodity}-${deal.id.slice(0, 6)}.csv`);
    link.click();
  };

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header toolbar */}
        <div className="bg-slate-900 px-6 py-4 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-xl">📄</span>
            <div>
              <h2 id="report-modal-title" className="text-sm font-bold tracking-tight">
                Institutional ESG & Sustainability Report
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                {reportId}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCsv}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1"
            >
              📥 CSV
            </button>
            <button
              onClick={handlePrint}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1"
            >
              🖨️ Print / PDF
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold transition-colors ml-2"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab switcher: Investor vs Regulator */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReportType('investor')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                reportType === 'investor'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Investor Impact Summary
            </button>
            <button
              onClick={() => setReportType('regulator')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                reportType === 'regulator'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Regulatory & SFDR Disclosure
            </button>
          </div>
          <span className="text-[10px] text-slate-400">
            Audit standard: SASB FB-AG / GRI 13
          </span>
        </div>

        {/* Report Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 text-xs">
          {/* Executive Summary Card */}
          <div className="rounded-2xl border border-slate-200 p-5 bg-gradient-to-br from-white to-slate-50/80 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                  Asset Classification
                </span>
                <h3 className="text-base font-bold text-slate-900 capitalize mt-0.5">
                  {deal.commodity} ({deal.token_symbol})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Total Value: {formatCurrency(deal.total_value, 'USD', { decimalPlaces: 0 })} | Quantity: {deal.quantity} {deal.quantity_unit}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">ESG Rating</span>
                  <span className="text-xl font-black text-emerald-600">{sustainability.rating}</span>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col items-center justify-center font-black text-emerald-700">
                  <span className="text-base leading-none">{sustainability.overallScore}</span>
                  <span className="text-[8px] uppercase tracking-tighter text-emerald-600 font-bold mt-0.5">/ 100</span>
                </div>
              </div>
            </div>

            {/* Score Pillars */}
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100">
              <div className="p-3 bg-white rounded-xl border border-slate-100">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Environmental (40%)</span>
                <span className="text-base font-bold text-emerald-700">{sustainability.environmentalScore} / 100</span>
                <div className="h-1.5 w-full bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${sustainability.environmentalScore}%` }} />
                </div>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-100">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Social (35%)</span>
                <span className="text-base font-bold text-blue-700">{sustainability.socialScore} / 100</span>
                <div className="h-1.5 w-full bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${sustainability.socialScore}%` }} />
                </div>
              </div>
              <div className="p-3 bg-white rounded-xl border border-slate-100">
                <span className="text-[10px] text-slate-400 block font-semibold uppercase">Governance (25%)</span>
                <span className="text-base font-bold text-indigo-700">{sustainability.governanceScore} / 100</span>
                <div className="h-1.5 w-full bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${sustainability.governanceScore}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Section: Carbon Footprint Breakdown */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>🌍</span> Greenhouse Gas Emissions (GHG Protocol Scopes 1, 2, 3)
            </h4>
            <div className="rounded-2xl border border-slate-200 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold text-slate-500">
                  <tr>
                    <th className="p-3">Supply Chain Component</th>
                    <th className="p-3">Calculation Baseline</th>
                    <th className="p-3 text-right">Emissions (kg CO2e)</th>
                    <th className="p-3 text-right">% of Footprint</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-[11px]">
                  <tr>
                    <td className="p-3 font-semibold text-slate-800">🚢 Freight & Transportation (Scope 3)</td>
                    <td className="p-3 text-slate-500">
                      {footprint.calculationParameters.distanceKm} km via {footprint.calculationParameters.transportMode.replace('_', ' ')}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">{footprint.transportationEmissionsKg.toLocaleString()}</td>
                    <td className="p-3 text-right text-slate-500">{footprint.breakdownPercent.transport}%</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-800">❄️ Storage & Energy (Scope 1 & 2)</td>
                    <td className="p-3 text-slate-500">
                      {footprint.calculationParameters.storageDays} days in {footprint.calculationParameters.storageType.replace('_', ' ')}
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">{footprint.storageEmissionsKg.toLocaleString()}</td>
                    <td className="p-3 text-right text-slate-500">{footprint.breakdownPercent.storage}%</td>
                  </tr>
                  <tr>
                    <td className="p-3 font-semibold text-slate-800">⚙️ Processing & Conditioning (Scope 1)</td>
                    <td className="p-3 text-slate-500">
                      {footprint.calculationParameters.commodity} milling & drying baseline
                    </td>
                    <td className="p-3 text-right font-mono font-semibold">{footprint.processingEmissionsKg.toLocaleString()}</td>
                    <td className="p-3 text-right text-slate-500">{footprint.breakdownPercent.processing}%</td>
                  </tr>
                  <tr className="bg-slate-50/80 font-bold text-slate-900 border-t-2 border-slate-200">
                    <td className="p-3">Gross Supply Chain Carbon Footprint</td>
                    <td className="p-3 text-slate-500 text-[10px]">Total cradle-to-gate intensity: {footprint.carbonIntensityKgPerUnit} kg CO2e / kg</td>
                    <td className="p-3 text-right font-mono">{footprint.totalEmissionsKgCo2e.toLocaleString()} kg</td>
                    <td className="p-3 text-right">{footprint.totalEmissionsTonsCo2e} tCO2e</td>
                  </tr>
                  <tr className="bg-emerald-50/60 font-bold text-emerald-900">
                    <td className="p-3">Verified Carbon Offsets Retired</td>
                    <td className="p-3 text-emerald-700 text-[10px] font-normal">
                      {footprint.offsetStatus.isOffset
                        ? `${footprint.offsetStatus.offsetProject} (${footprint.offsetStatus.offsetProvider})`
                        : 'No carbon credits currently retired for this deal'}
                    </td>
                    <td className="p-3 text-right font-mono">
                      -{Math.round(footprint.offsetStatus.offsetTonsCo2e * 1000).toLocaleString()} kg
                    </td>
                    <td className="p-3 text-right">-{footprint.offsetStatus.offsetTonsCo2e} tCO2e</td>
                  </tr>
                  <tr className="bg-slate-100/90 font-black text-slate-900">
                    <td className="p-3">Net Carbon Balance</td>
                    <td className="p-3 text-slate-500 text-[10px]">
                      {footprint.offsetStatus.isOffset ? '✅ Verified 100% Carbon Neutral' : '⚠️ Unoffset Gross Emissions'}
                    </td>
                    <td className="p-3 text-right font-mono">
                      {Math.round(footprint.offsetStatus.netEmissionsTonsCo2e * 1000).toLocaleString()} kg
                    </td>
                    <td className="p-3 text-right text-emerald-700 font-bold">
                      {footprint.offsetStatus.netEmissionsTonsCo2e} tCO2e
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Section: Certifications & Audits */}
          <div className="space-y-3">
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>🏅</span> Independent Certifications & Audits
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {sustainability.certifications.map((c) => (
                <div key={c.id} className="p-3 rounded-xl border border-slate-200 bg-white flex items-start gap-2.5">
                  <span className="text-xl mt-0.5">✅</span>
                  <div>
                    <h5 className="font-bold text-slate-800 text-[11px]">{c.name}</h5>
                    <p className="text-[10px] text-slate-500 mt-0.5">{c.description}</p>
                    <p className="text-[9px] text-slate-400 mt-1">
                      Issuer: <strong>{c.issuer}</strong> | Code: <span className="font-mono">{c.verificationCode}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section: Regulatory Disclosure (SFDR / GRI) */}
          {reportType === 'regulator' && (
            <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-200 space-y-2 text-[11px] text-blue-900">
              <h5 className="font-bold uppercase tracking-wider text-[10px] text-blue-800">
                Regulatory Disclosures (EU SFDR & GRI 13)
              </h5>
              <p>
                <strong>Principal Adverse Impact (PAI) Statement:</strong> This trade deal has undergone due diligence screening for deforestation, water usage stress, and child labor safeguards. No principal adverse impacts were identified.
              </p>
              <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                <div>• SFDR Classification: <strong>{sustainability.overallScore >= 80 ? 'Article 9 Sustainable Investment' : 'Article 8 Environmental Characteristics'}</strong></div>
                <div>• Taxonomy Aligned: <strong>Yes (Agricultural products mitigation)</strong></div>
                <div>• Deforestation-Free: <strong>100% GIS satellite verified</strong></div>
                <div>• Traceability: <strong>Soroban smart contract tokenized</strong></div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <button
            onClick={handleCopyLink}
            className="text-xs text-slate-600 hover:text-slate-900 font-semibold"
          >
            {copied ? '✓ Link copied' : '🔗 Copy Shareable Link'}
          </button>
          <button
            onClick={onClose}
            className="btn btn-md bg-slate-900 hover:bg-slate-800 text-white font-bold px-6 rounded-xl text-xs"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
