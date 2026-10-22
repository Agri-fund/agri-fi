'use client';

import React, { useState } from 'react';
import { Deal } from '@/lib/api';
import {
  SustainabilityMetrics,
  CarbonFootprintDetails,
  TransportMode,
  StorageType,
  calculateCarbonFootprint,
} from '@/lib/sustainability';
import EcoCertificationBadges from './EcoCertificationBadges';
import CarbonOffsetModal from './CarbonOffsetModal';
import SustainabilityReportModal from './SustainabilityReportModal';

interface CarbonFootprintWidgetProps {
  deal: Deal;
  sustainability: SustainabilityMetrics;
  onDealUpdated?: (updated: Deal) => void;
}

export default function CarbonFootprintWidget({
  deal,
  sustainability,
  onDealUpdated,
}: CarbonFootprintWidgetProps) {
  const [showOffsetModal, setShowOffsetModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);

  // Simulator parameters
  const baseFootprint = sustainability.carbonFootprint;
  const [simTransportMode, setSimTransportMode] = useState<TransportMode>(
    baseFootprint.calculationParameters.transportMode,
  );
  const [simRenewablePct, setSimRenewablePct] = useState<number>(
    baseFootprint.calculationParameters.renewableEnergyPercent,
  );

  const simulatedFootprint = showSimulator
    ? calculateCarbonFootprint(deal, {
        transportMode: simTransportMode,
        renewableEnergyPercent: simRenewablePct,
      })
    : baseFootprint;

  const isNetZero = simulatedFootprint.offsetStatus.isOffset;
  const savingsVsBaseline = simulatedFootprint.varianceVsBenchmarkPercent;

  return (
    <>
      <section
        className="card p-6 space-y-6 border border-emerald-100 bg-gradient-to-br from-white via-emerald-50/20 to-white shadow-sm"
        aria-labelledby="carbon-footprint-heading"
      >
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100/80 text-emerald-700 flex items-center justify-center text-xl shadow-inner">
              🌱
            </div>
            <div>
              <h2 id="carbon-footprint-heading" className="text-base font-bold text-foreground">
                Sustainability & Carbon Footprint
              </h2>
              <p className="text-xs text-muted-foreground">
                GHG Protocol Scope 1, 2, 3 agricultural emissions tracking
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-border bg-surface hover:bg-neutral-muted transition-colors flex items-center gap-1.5 text-foreground"
            >
              <span>📄</span> ESG Report
            </button>
            <button
              type="button"
              onClick={() => setShowOffsetModal(true)}
              className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow-sm flex items-center gap-1.5 ${
                isNetZero
                  ? 'bg-teal-100 text-teal-800 hover:bg-teal-200'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20'
              }`}
            >
              <span>{isNetZero ? '✓' : '⚡'}</span>
              {isNetZero ? 'Carbon Neutral' : 'Neutralize Deal'}
            </button>
          </div>
        </div>

        {/* Eco-Friendly Certifications Banner */}
        {sustainability.certifications.length > 0 && (
          <div className="p-3 rounded-2xl bg-surface border border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Eco-Friendly Certifications:
            </span>
            <EcoCertificationBadges certifications={sustainability.certifications} size="sm" />
          </div>
        )}

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Total Gross Emissions */}
          <div className="p-4 rounded-2xl bg-surface border border-border">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Total Footprint
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-black text-foreground">
                {simulatedFootprint.totalEmissionsTonsCo2e}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">tCO2e</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {simulatedFootprint.totalEmissionsKgCo2e.toLocaleString()} kg total emissions
            </p>
          </div>

          {/* Carbon Intensity */}
          <div className="p-4 rounded-2xl bg-surface border border-border">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Carbon Intensity
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-2xl font-black text-foreground">
                {simulatedFootprint.carbonIntensityKgPerUnit}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">kg CO2e / kg</span>
            </div>
            <p className="text-[11px] font-medium text-emerald-600 mt-1">
              {savingsVsBaseline <= 0 ? (
                <span>↓ {Math.abs(savingsVsBaseline)}% lower than baseline</span>
              ) : (
                <span>↑ {savingsVsBaseline}% above baseline</span>
              )}
            </p>
          </div>

          {/* Net Carbon Balance */}
          <div className="p-4 rounded-2xl bg-surface border border-border">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
              Net Neutrality Status
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              {isNetZero ? (
                <>
                  <span className="text-2xl font-black text-teal-600">0.00</span>
                  <span className="text-xs font-bold text-teal-600">Net tCO2e</span>
                </>
              ) : (
                <>
                  <span className="text-2xl font-black text-amber-600">
                    {simulatedFootprint.offsetStatus.netEmissionsTonsCo2e}
                  </span>
                  <span className="text-xs font-bold text-amber-600">Net tCO2e</span>
                </>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1 truncate">
              {isNetZero ? (
                <span className="text-teal-700 font-semibold">100% Net-Zero Certified</span>
              ) : (
                <span>Unmitigated • Offset available</span>
              )}
            </p>
          </div>
        </div>

        {/* Component Breakdown Progress Bar & Details */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
            <span>Emissions by Supply Chain Component</span>
            <span>100% Full Lifecycle</span>
          </div>

          {/* Segmented bar */}
          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden flex" role="progressbar" aria-label="Carbon emission breakdown">
            <div
              className="bg-blue-500 h-full transition-all duration-500"
              style={{ width: `${simulatedFootprint.breakdownPercent.transport}%` }}
              title={`Transport: ${simulatedFootprint.breakdownPercent.transport}%`}
            />
            <div
              className="bg-cyan-400 h-full transition-all duration-500"
              style={{ width: `${simulatedFootprint.breakdownPercent.storage}%` }}
              title={`Storage: ${simulatedFootprint.breakdownPercent.storage}%`}
            />
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: `${simulatedFootprint.breakdownPercent.processing}%` }}
              title={`Processing: ${simulatedFootprint.breakdownPercent.processing}%`}
            />
          </div>

          {/* Breakdown cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="p-2.5 rounded-xl bg-surface border border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
                <span className="text-xs text-foreground font-medium">🚢 Transportation</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-foreground">
                  {simulatedFootprint.transportationEmissionsKg.toLocaleString()} kg
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  ({simulatedFootprint.breakdownPercent.transport}%)
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-surface border border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 inline-block" />
                <span className="text-xs text-foreground font-medium">❄️ Storage Energy</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-foreground">
                  {simulatedFootprint.storageEmissionsKg.toLocaleString()} kg
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  ({simulatedFootprint.breakdownPercent.storage}%)
                </span>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-surface border border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span className="text-xs text-foreground font-medium">⚙️ Processing</span>
              </div>
              <div className="text-right">
                <span className="text-xs font-bold text-foreground">
                  {simulatedFootprint.processingEmissionsKg.toLocaleString()} kg
                </span>
                <span className="text-[10px] text-muted-foreground block">
                  ({simulatedFootprint.breakdownPercent.processing}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Simulator Toggle */}
        <div className="pt-2 border-t border-border">
          <button
            type="button"
            onClick={() => setShowSimulator(!showSimulator)}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-1.5"
          >
            <span>{showSimulator ? '▼' : '▶'}</span>
            <span>{showSimulator ? 'Hide Carbon Reduction Simulator' : '⚡ Simulate Low-Carbon Supply Chain (Transport & Solar)'}</span>
          </button>

          {showSimulator && (
            <div className="mt-3 p-4 rounded-2xl bg-surface border border-emerald-200 space-y-4 animate-in fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold text-foreground mb-1.5">
                    Transport Mode
                  </label>
                  <select
                    value={simTransportMode}
                    onChange={(e) => setSimTransportMode(e.target.value as TransportMode)}
                    className="w-full text-xs p-2 rounded-xl border border-border bg-canvas text-foreground focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="sea_freight">🚢 Container Vessel (0.016 kg/t-km)</option>
                    <option value="rail_freight">🚆 Electric Freight Rail (0.028 kg/t-km)</option>
                    <option value="road_freight">🚛 Heavy Diesel Truck (0.096 kg/t-km)</option>
                    <option value="air_freight">✈️ Cargo Air Freight (0.602 kg/t-km)</option>
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11px] font-bold text-foreground">
                      Solar / Renewable Energy in Storage
                    </label>
                    <span className="text-xs font-bold text-emerald-600">{simRenewablePct}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={simRenewablePct}
                    onChange={(e) => setSimRenewablePct(Number(e.target.value))}
                    className="w-full accent-emerald-600"
                  />
                </div>
              </div>

              {simulatedFootprint.totalEmissionsTonsCo2e !== baseFootprint.totalEmissionsTonsCo2e && (
                <div className="p-3 rounded-xl bg-emerald-50 text-emerald-900 border border-emerald-200 flex items-center justify-between text-xs">
                  <span>
                    Simulated impact: <strong>{simulatedFootprint.totalEmissionsTonsCo2e} tCO2e</strong>
                  </span>
                  <span className="font-bold text-emerald-700">
                    {simulatedFootprint.totalEmissionsTonsCo2e < baseFootprint.totalEmissionsTonsCo2e
                      ? `↓ Saves ${(baseFootprint.totalEmissionsTonsCo2e - simulatedFootprint.totalEmissionsTonsCo2e).toFixed(2)} tCO2e`
                      : `↑ Adds ${(simulatedFootprint.totalEmissionsTonsCo2e - baseFootprint.totalEmissionsTonsCo2e).toFixed(2)} tCO2e`}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Carbon Offset Modal */}
      {showOffsetModal && (
        <CarbonOffsetModal
          deal={deal}
          footprint={simulatedFootprint}
          onClose={() => setShowOffsetModal(false)}
          onOffsetComplete={(updated) => {
            if (onDealUpdated) onDealUpdated(updated);
          }}
        />
      )}

      {/* Sustainability Report Modal */}
      {showReportModal && (
        <SustainabilityReportModal
          deal={deal}
          sustainability={sustainability}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </>
  );
}
