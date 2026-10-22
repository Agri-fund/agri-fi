'use client';

import React, { useState } from 'react';
import {
  DEFAULT_SUCCESS_STORIES,
  DealSuccessStory,
  recordTrustInteraction,
} from '@/lib/social-proof';
import { SocialShareModal } from './SocialShareModal';

interface DealSuccessStoriesProps {
  stories?: DealSuccessStory[];
  className?: string;
}

export function DealSuccessStories({
  stories = DEFAULT_SUCCESS_STORIES,
  className = '',
}: DealSuccessStoriesProps) {
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [shareStory, setShareStory] = useState<DealSuccessStory | null>(null);

  const current = stories[activeStoryIndex] || stories[0];

  const handleShare = (story: DealSuccessStory) => {
    setShareStory(story);
    recordTrustInteraction('success_story_shared');
  };

  return (
    <div className={`card p-6 border border-border bg-gradient-to-br from-surface to-canvas ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <h3 className="text-lg font-bold text-foreground">Deal Success Stories & Repayment Proof</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Verified closed trade cycles with 100% principal + realized yield distribution proofs.
          </p>
        </div>

        {/* Carousel selectors */}
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {stories.map((story, idx) => (
            <button
              key={story.id}
              type="button"
              onClick={() => {
                setActiveStoryIndex(idx);
                recordTrustInteraction('success_story_switched');
              }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                idx === activeStoryIndex
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-surface border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {story.commodity}
            </button>
          ))}
        </div>
      </div>

      {/* Main Showcase */}
      {current && (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* Left stats & metrics (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  ✓ Repaid in Full
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {current.tokenSymbol}
                </span>
              </div>
              <h4 className="text-xl font-black text-foreground">
                {current.dealTitle}
              </h4>
              <p className="text-xs text-muted-foreground mt-1">
                Origin: <strong className="text-foreground">{current.originCountry}</strong> • Term: {current.durationMonths} months
              </p>
            </div>

            {/* ROI Metrics Card */}
            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-card border border-border">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Target ROI
                </p>
                <p className="text-lg font-bold text-muted-foreground">
                  {current.targetRoi}%
                </p>
              </div>
              <div className="border-l border-border pl-3">
                <p className="text-[10px] text-emerald-600 uppercase font-bold tracking-wider flex items-center gap-1">
                  <span>Realized ROI</span>
                  <span className="text-[9px] px-1 py-0.2 bg-emerald-500/15 text-emerald-700 rounded font-black">
                    +{Number((current.realizedRoi - current.targetRoi).toFixed(1))}%
                  </span>
                </p>
                <p className="text-2xl font-black text-emerald-600 tabular-nums">
                  {current.realizedRoi}%
                </p>
              </div>
            </div>

            {/* Financial Totals */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-muted-foreground">Total Raised & Disbursed</span>
                <span className="font-bold text-foreground">
                  ${current.totalRaisedUsd.toLocaleString()} USD
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-muted-foreground">Payout Settlement Date</span>
                <span className="font-medium text-foreground">
                  {current.payoutDate}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-border/40">
                <span className="text-muted-foreground">Stellar Escrow Tx</span>
                <span className="font-mono text-primary font-medium hover:underline cursor-pointer">
                  {current.txHash}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleShare(current)}
              className="btn btn-sm w-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 flex items-center justify-center gap-2 cursor-pointer font-semibold"
            >
              <span>🔗</span>
              <span>Share Deal Success (+Earn Referral)</span>
            </button>
          </div>

          {/* Right Farmer Quote & Story (7 cols) */}
          <div className="lg:col-span-7 bg-surface/80 rounded-2xl p-5 border border-border space-y-4">
            <p className="text-xs text-muted-foreground font-medium italic leading-relaxed">
              &ldquo;{current.farmerQuote}&rdquo;
            </p>

            <div className="flex items-center gap-3 pt-2 border-t border-border/60">
              <img
                src={current.farmerAvatar}
                alt={current.borrowerName}
                className="w-11 h-11 rounded-full object-cover border-2 border-primary/30"
              />
              <div>
                <p className="text-xs font-bold text-foreground">{current.borrowerName}</p>
                <p className="text-[11px] text-muted-foreground">{current.borrowerRole}</p>
              </div>
            </div>

            <div className="bg-canvas/80 p-3 rounded-xl border border-border text-xs text-muted-foreground">
              <span className="font-bold text-foreground block mb-0.5">Execution Summary</span>
              {current.summary}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {shareStory && (
        <SocialShareModal
          dealTitle={shareStory.dealTitle}
          dealId={shareStory.dealId}
          roi={shareStory.realizedRoi}
          commodity={shareStory.commodity}
          onClose={() => setShareStory(null)}
        />
      )}
    </div>
  );
}
export default DealSuccessStories;
