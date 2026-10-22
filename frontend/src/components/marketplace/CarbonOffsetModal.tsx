'use client';

import React, { useState } from 'react';
import { Deal } from '@/lib/api';
import {
  CarbonFootprintDetails,
  CarbonOffsetOption,
  VERIFIED_OFFSET_PROJECTS,
  calculateOffsetCost,
  simulateOffsetPurchase,
} from '@/lib/sustainability';
import { useCurrencyFormat } from '@/hooks/useCurrencyFormat';

interface CarbonOffsetModalProps {
  deal: Deal;
  footprint: CarbonFootprintDetails;
  onClose: () => void;
  onOffsetComplete?: (updatedDeal: Deal) => void;
}

export default function CarbonOffsetModal({
  deal,
  footprint,
  onClose,
  onOffsetComplete,
}: CarbonOffsetModalProps) {
  const { formatCurrency } = useCurrencyFormat();
  const [selectedProject, setSelectedProject] = useState<CarbonOffsetOption>(
    VERIFIED_OFFSET_PROJECTS[0],
  );
  const [offsetMultiplier, setOffsetMultiplier] = useState<number>(1.0); // 1.0 = 100% Net Zero
  const [isProcessing, setIsProcessing] = useState(false);
  const [receipt, setReceipt] = useState<any | null>(null);

  const baseTons = footprint.totalEmissionsTonsCo2e;
  const targetedTons = Number((baseTons * offsetMultiplier).toFixed(2));
  const { totalCostUsd } = calculateOffsetCost(targetedTons, selectedProject);

  const handlePurchase = () => {
    setIsProcessing(true);
    setTimeout(() => {
      const offsetResult = simulateOffsetPurchase(
        deal,
        selectedProject,
        targetedTons,
      );

      const updatedDeal: Deal = {
        ...deal,
        esg_score: Math.min(100, (deal.esg_score ?? 75) + 12),
        esg_rating: 'AAA',
        esg_breakdown: {
          ...(deal.esg_breakdown || {}),
          carbonOffset: offsetResult,
        },
      };

      setReceipt({
        ...offsetResult,
        totalCostUsd,
        projectName: selectedProject.name,
        standard: selectedProject.standard,
        commodity: deal.commodity,
      });
      setIsProcessing(false);

      if (onOffsetComplete) {
        onOffsetComplete(updatedDeal);
      }
    }, 1000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offset-modal-title"
    >
      <div
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-2xl bg-white/20 text-2xl">
              🌱
            </span>
            <div>
              <h2 id="offset-modal-title" className="text-lg font-bold">
                Carbon Neutrality & Offset Retirement
              </h2>
              <p className="text-xs text-emerald-100">
                Neutralize emissions for {deal.commodity} ({deal.token_symbol})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close offset modal"
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center text-sm font-bold transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {receipt ? (
            /* Success Receipt State */
            <div className="text-center space-y-4 py-4 animate-in zoom-in-95">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto shadow-inner">
                ✓
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  Carbon Neutrality Verified!
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  {targetedTons} tCO2e of verified carbon removal credits have been retired in perpetuity on your behalf.
                </p>
              </div>

              {/* Certificate Box */}
              <div className="rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-5 text-left space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                    Retirement Certificate
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-700">
                    {receipt.offsetCertificateId}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Project</span>
                    <strong className="text-slate-800">{receipt.projectName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Registry Standard</span>
                    <strong className="text-slate-800">{receipt.standard}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Volume Neutralized</span>
                    <strong className="text-emerald-700">{receipt.offsetTonsCo2e} metric tons CO2e</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Retired On</span>
                    <strong className="text-slate-800">{new Date(receipt.retiredAt).toLocaleDateString()}</strong>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={onClose}
                  className="btn btn-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 rounded-xl"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            /* Purchase Flow */
            <>
              {/* Emission summary banner */}
              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                    Calculated Deal Emissions
                  </span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-2xl font-black text-slate-900">
                      {baseTons}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      tCO2e gross footprint
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Includes {footprint.breakdownPercent.transport}% transport, {footprint.breakdownPercent.storage}% storage, {footprint.breakdownPercent.processing}% processing
                  </p>
                </div>
                <div className="flex items-center gap-2 bg-emerald-100 text-emerald-800 px-3 py-1.5 rounded-xl text-xs font-bold">
                  <span>🌍 Goal: Net-Zero</span>
                </div>
              </div>

              {/* Offset Target Slider / Presets */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Select Neutrality Level
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { label: '50% Partial', val: 0.5, desc: 'Halve Footprint' },
                    { label: '100% Net-Zero', val: 1.0, desc: 'Full Neutrality' },
                    { label: '200% Climate Positive', val: 2.0, desc: 'Net Carbon Negative' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setOffsetMultiplier(preset.val)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        offsetMultiplier === preset.val
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="font-bold text-xs">{preset.label}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">{preset.desc}</div>
                      <div className="text-[11px] font-bold text-emerald-700 mt-1">
                        {(baseTons * preset.val).toFixed(2)} tCO2e
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Choose Verified Project */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Select Verified Carbon Offset Project
                </label>
                <div className="space-y-2.5">
                  {VERIFIED_OFFSET_PROJECTS.map((project) => {
                    const isSelected = selectedProject.id === project.id;
                    return (
                      <div
                        key={project.id}
                        onClick={() => setSelectedProject(project)}
                        className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                          isSelected
                            ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-bold text-slate-900">
                                {project.name}
                              </h4>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                {project.standard}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">
                              {project.description}
                            </p>
                            <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-400">
                              <span>📍 {project.location}</span>
                              <span>Vintage: {project.vintage}</span>
                              <span className="text-emerald-700 font-semibold">Tier: {project.rating}</span>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-sm font-black text-slate-900">
                              ${project.pricePerTonUsd}
                            </span>
                            <span className="text-[10px] text-slate-400 block">/ ton</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cost Summary & CTA */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Total Offset Cost
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-black text-slate-900">
                      {formatCurrency(totalCostUsd, 'USD', { decimalPlaces: 2 })}
                    </span>
                    <span className="text-xs text-slate-500">
                      for {targetedTons} tCO2e
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="btn btn-md border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handlePurchase}
                    disabled={isProcessing}
                    className="btn btn-md flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 rounded-xl text-xs shadow-md shadow-emerald-600/20 disabled:opacity-50"
                  >
                    {isProcessing ? 'Retiring Credits...' : 'Neutralize Footprint →'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
