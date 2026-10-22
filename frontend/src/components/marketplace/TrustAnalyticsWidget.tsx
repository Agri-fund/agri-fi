'use client';

import React, { useState, useEffect } from 'react';
import { getTrustAnalytics, TrustAnalytics } from '@/lib/social-proof';

interface TrustAnalyticsWidgetProps {
  className?: string;
}

export function TrustAnalyticsWidget({ className = '' }: TrustAnalyticsWidgetProps) {
  const [analytics, setAnalytics] = useState<TrustAnalytics>(() => getTrustAnalytics());

  useEffect(() => {
    // Refresh periodically or on focus
    const handleFocus = () => setAnalytics(getTrustAnalytics());
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  return (
    <div className={`card p-6 border border-border bg-gradient-to-br from-surface to-canvas ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">📈</span>
            <h3 className="text-base font-bold text-foreground">Trust Signals & Conversion Impact</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold border border-emerald-500/20">
              Live A/B Analytics
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Empirical conversion lift and investor confidence tracking across deals with active social proof.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-muted-foreground">Updated:</span>
          <span className="text-xs font-mono font-medium text-foreground">
            {new Date(analytics.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Uplift */}
        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 space-y-1">
          <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
            Conversion Uplift
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-emerald-600 tabular-nums">
              +{analytics.conversionUpliftPercent}%
            </span>
            <span className="text-xs text-emerald-600 font-semibold">vs. Baseline</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Target: &gt; +30% conversion goal achieved</p>
        </div>

        {/* Metric 2: Social Proof Conversion */}
        <div className="p-4 rounded-xl border border-border bg-surface space-y-1">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Active Trust Conversion
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-foreground tabular-nums">
              {analytics.socialProofConversionRate}%
            </span>
            <span className="text-xs text-muted-foreground line-through font-medium">
              {analytics.baselineConversionRate}% base
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground">Fund rate when trust badges & reviews are viewed</p>
        </div>

        {/* Metric 3: Trust Signal Impressions */}
        <div className="p-4 rounded-xl border border-border bg-surface space-y-1">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Trust Impressions
          </p>
          <p className="text-3xl font-black text-foreground tabular-nums">
            {analytics.totalImpressions.toLocaleString()}+
          </p>
          <p className="text-[10px] text-muted-foreground">Deals audited with verified smart escrow</p>
        </div>

        {/* Metric 4: Verified Interactions */}
        <div className="p-4 rounded-xl border border-border bg-surface space-y-1">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Community Interactions
          </p>
          <p className="text-3xl font-black text-primary tabular-nums">
            {analytics.socialProofInteractions.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">Helpful votes, reviews, shares & forum Q&A</p>
        </div>
      </div>

      {/* Conversion comparison visualization */}
      <div className="mt-5 p-4 rounded-xl border border-border bg-canvas space-y-3">
        <h4 className="text-xs font-bold text-foreground">
          Investor Decision Velocity (Cohort Comparison)
        </h4>

        <div className="space-y-2 text-xs">
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-muted-foreground">Deals with Verified Trust Signals & Community Reviews</span>
              <span className="font-bold text-emerald-600">{analytics.socialProofConversionRate}% Funded</span>
            </div>
            <div className="h-3 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                style={{ width: `${(analytics.socialProofConversionRate / 10) * 100}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-muted-foreground">Standard Baseline (No Social Proof Display)</span>
              <span className="font-bold text-muted-foreground">{analytics.baselineConversionRate}% Funded</span>
            </div>
            <div className="h-3 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
              <div
                className="h-full bg-neutral-400 rounded-full"
                style={{ width: `${(analytics.baselineConversionRate / 10) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default TrustAnalyticsWidget;
