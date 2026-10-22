'use client';

import React from 'react';
import Link from 'next/link';
import { Deal } from '@/lib/api';
import {
  SustainabilityRecommendation,
  getSustainabilityRecommendations,
} from '@/lib/sustainability';

interface SustainabilityRecommendationsProps {
  deal: Deal;
  marketplaceDeals?: Deal[];
  onOpenOffsetModal?: () => void;
}

export default function SustainabilityRecommendations({
  deal,
  marketplaceDeals = [],
  onOpenOffsetModal,
}: SustainabilityRecommendationsProps) {
  const recommendations = getSustainabilityRecommendations(deal, marketplaceDeals);

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  return (
    <section className="card p-6 space-y-4" aria-labelledby="sustainability-recommendations-heading">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">💡</span>
          <div>
            <h2 id="sustainability-recommendations-heading" className="text-base font-bold text-foreground">
              Sustainability & Carbon Optimization
            </h2>
            <p className="text-xs text-muted-foreground">
              Recommended lower-carbon pathways and alternative deals
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          ESG Engine
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {recommendations.slice(0, 4).map((rec, idx) => {
          const isOffsetRec = rec.title.includes('Neutralize');
          const hasAlternative = Boolean(rec.alternativeDealId);

          return (
            <div
              key={idx}
              className="p-4 rounded-2xl border border-border bg-surface hover:border-emerald-300 transition-all flex flex-col justify-between gap-3 group"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-bold text-xs text-foreground group-hover:text-emerald-600 transition-colors">
                    {rec.title}
                  </h3>
                  <span className="flex-shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    -{rec.savingsPercent}% CO2e
                  </span>
                </div>

                <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                  {rec.primaryAction}
                </p>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>Potential savings: <strong className="text-emerald-600">{rec.savingsTons} tCO2e</strong></span>
                  <span>•</span>
                  <span>+{rec.estimatedPointsGain} ESG pts</span>
                </div>

                {isOffsetRec ? (
                  <button
                    type="button"
                    onClick={onOpenOffsetModal}
                    className="font-bold text-emerald-600 hover:text-emerald-700 text-xs flex items-center gap-1"
                  >
                    Offset Now →
                  </button>
                ) : hasAlternative ? (
                  <Link
                    href={`/marketplace/${rec.alternativeDealId}`}
                    className="font-bold text-brand-600 hover:text-brand-700 text-xs flex items-center gap-1"
                  >
                    View Deal →
                  </Link>
                ) : (
                  <span className="text-[10px] font-semibold text-slate-400">
                    Effort: {rec.implementationCostTier}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
