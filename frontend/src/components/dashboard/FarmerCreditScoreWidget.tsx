'use client';

import React, { useEffect, useState } from 'react';
import { apiClient, CreditScoreDisclosure } from '@/lib/api';

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Excellent: { bg: 'bg-emerald-50 text-emerald-700', text: 'text-emerald-600', border: 'border-emerald-200' },
  Good: { bg: 'bg-blue-50 text-blue-700', text: 'text-blue-600', border: 'border-blue-200' },
  Fair: { bg: 'bg-amber-50 text-amber-700', text: 'text-amber-600', border: 'border-amber-200' },
  Poor: { bg: 'bg-rose-50 text-rose-700', text: 'text-rose-600', border: 'border-rose-200' },
};

export default function FarmerCreditScoreWidget() {
  const [data, setData] = useState<CreditScoreDisclosure | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTips, setShowTips] = useState(false);

  useEffect(() => {
    fetchScore();
  }, []);

  const fetchScore = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getCreditScore();
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load credit score disclosure');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="card p-6 animate-pulse space-y-4">
        <div className="h-6 w-48 bg-slate-200 rounded" />
        <div className="h-24 bg-slate-100 rounded-2xl" />
        <div className="h-32 bg-slate-100 rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return null; // Gracefully degrade if endpoint is unavailable or user lacks permission
  }

  const scorePct = Math.min(Math.max(((data.score - 300) / 550) * 100, 0), 100);
  const tierStyle = TIER_COLORS[data.tier] ?? TIER_COLORS.Good;

  return (
    <div className="card p-6 border border-slate-200/80 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title text-base">Farmer Credit Score & Borrowing Power</h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${tierStyle.bg} ${tierStyle.border}`}>
              {data.tier}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Institutional rating determined by on-time delivery, KYC longevity, and sensor compliance.
          </p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-black text-slate-900 tracking-tight flex items-baseline justify-end gap-1">
            <span>{data.score}</span>
            <span className="text-xs font-medium text-slate-400">/ 850</span>
          </div>
          <p className="text-[10px] text-slate-400 mt-0.5">
            Max Deal Limit: <span className="font-bold text-slate-700">${data.maxDealSizeUsdc.toLocaleString()}</span>
          </p>
        </div>
      </div>

      {/* Progress Track */}
      <div>
        <div className="h-3 rounded-full bg-slate-100 p-0.5 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 via-blue-500 to-emerald-500 transition-all duration-700"
            style={{ width: `${scorePct}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
          <span>300 (Poor)</span>
          <span>580 (Fair)</span>
          <span>670 (Good)</span>
          <span>750+ (Excellent)</span>
        </div>
      </div>

      {/* Factors Breakdown */}
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
          Scoring Factors & Weights
        </h3>

        <div className="grid sm:grid-cols-2 gap-3">
          {Object.entries(data.breakdown).map(([key, factor]) => (
            <div key={key} className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-slate-800">{factor.name}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                  {factor.weightPercent}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-tight">
                {factor.description}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      factor.impact === 'positive'
                        ? 'bg-emerald-500'
                        : factor.impact === 'negative'
                        ? 'bg-rose-500'
                        : 'bg-blue-500'
                    }`}
                    style={{ width: `${factor.scorePercent}%` }}
                  />
                </div>
                <span className="text-[10px] font-bold text-slate-700">{factor.scorePercent}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Improvement Tips Section */}
      <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 p-4">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setShowTips(!showTips)}
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">💡</span>
            <span className="text-xs font-bold text-emerald-900">
              What improves your score? ({data.tips.length} recommendations)
            </span>
          </div>
          <button
            type="button"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 transition-colors"
          >
            {showTips ? 'Hide tips ↑' : 'Show tips ↓'}
          </button>
        </div>

        {showTips && (
          <ul className="mt-3 space-y-2 pt-3 border-t border-emerald-200/50 text-xs text-emerald-950">
            {data.tips.map((tip, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                <span className="leading-relaxed">{tip}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
