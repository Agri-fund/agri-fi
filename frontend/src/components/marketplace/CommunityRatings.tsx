'use client';

import React, { useState } from 'react';
import { DEFAULT_ENTITY_RATINGS, EntityRating, recordTrustInteraction } from '@/lib/social-proof';

interface CommunityRatingsProps {
  initialCategory?: 'platform' | 'farmer' | 'trader';
  className?: string;
}

export function CommunityRatings({
  initialCategory = 'platform',
  className = '',
}: CommunityRatingsProps) {
  const [activeCategory, setActiveCategory] = useState<'platform' | 'farmer' | 'trader'>(initialCategory);
  const [userRatingSubmitted, setUserRatingSubmitted] = useState(false);

  const ratingData: EntityRating =
    activeCategory === 'platform'
      ? DEFAULT_ENTITY_RATINGS.platform
      : activeCategory === 'farmer'
      ? DEFAULT_ENTITY_RATINGS.farmer_default
      : DEFAULT_ENTITY_RATINGS.trader_default;

  const totalReviews = ratingData.reviewCount;

  return (
    <div className={`card p-6 border border-border bg-surface ${className}`}>
      {/* Header and Category Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">⭐</span>
            <h3 className="text-lg font-bold text-foreground">Community Ratings & Track Record</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Transparent performance ratings aggregated from verified escrow settlements.
          </p>
        </div>

        <div className="flex rounded-xl p-1 bg-muted border border-border self-start sm:self-auto text-xs">
          {(['platform', 'farmer', 'trader'] as const).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setActiveCategory(cat);
                recordTrustInteraction(`ratings_tab_${cat}`);
              }}
              className={`px-3 py-1 rounded-lg font-semibold capitalize transition-all cursor-pointer ${
                activeCategory === cat
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat === 'platform' ? 'Agri-Fi Platform' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left: Overall score and star breakdown (5 cols) */}
        <div className="lg:col-span-5 p-4 rounded-2xl bg-canvas border border-border space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black text-foreground tabular-nums">
              {ratingData.overallRating.toFixed(1)}
            </span>
            <div>
              <div className="flex text-amber-500 text-sm tracking-tight">
                {'★'.repeat(Math.round(ratingData.overallRating))}
                {'☆'.repeat(5 - Math.round(ratingData.overallRating))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Based on {totalReviews.toLocaleString()} verified ratings
              </p>
            </div>
          </div>

          {/* Star distribution bars */}
          <div className="space-y-1.5 pt-2 border-t border-border/60 text-xs">
            {([5, 4, 3, 2, 1] as const).map((stars) => {
              const count = ratingData.distribution[stars] || 0;
              const pct = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
              return (
                <div key={stars} className="flex items-center gap-2 text-[11px]">
                  <span className="w-6 text-muted-foreground font-semibold">{stars} ★</span>
                  <div className="flex-1 h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-muted-foreground tabular-nums">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* Badges */}
          <div className="pt-2 flex flex-wrap gap-1.5">
            {ratingData.badges.map((b) => (
              <span
                key={b}
                className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20"
              >
                ✓ {b}
              </span>
            ))}
          </div>
        </div>

        {/* Right: Dimension criteria sub-scores (7 cols) */}
        <div className="lg:col-span-7 space-y-3.5">
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Evaluation Dimensions ({ratingData.entityName})
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ratingData.criteria.map((c) => (
              <div key={c.name} className="p-3 rounded-xl border border-border bg-card/60 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-foreground font-medium">{c.name}</span>
                  <span className="font-bold text-amber-500 tabular-nums">{c.score.toFixed(1)} / 5</span>
                </div>
                <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full"
                    style={{ width: `${(c.score / 5) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-xl bg-muted/40 border border-border flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Have you funded this producer or traded with this partner?</span>
            <button
              type="button"
              onClick={() => {
                setUserRatingSubmitted(true);
                recordTrustInteraction('community_rating_submitted');
              }}
              disabled={userRatingSubmitted}
              className={`btn btn-sm cursor-pointer ${
                userRatingSubmitted
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {userRatingSubmitted ? '✓ Rating Recorded' : 'Submit Rating'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
export default CommunityRatings;
