'use client';

import React, { useState } from 'react';
import { DEFAULT_TRUST_BADGES, TrustBadge, recordTrustInteraction } from '@/lib/social-proof';

interface TrustBadgesProps {
  badges?: TrustBadge[];
  compact?: boolean;
  className?: string;
}

export function TrustBadges({
  badges = DEFAULT_TRUST_BADGES,
  compact = false,
  className = '',
}: TrustBadgesProps) {
  const [selectedBadge, setSelectedBadge] = useState<TrustBadge | null>(null);

  const handleBadgeClick = (badge: TrustBadge) => {
    setSelectedBadge(badge);
    recordTrustInteraction('trust_badge_inspected');
  };

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {badges.slice(0, 3).map((badge) => (
          <span
            key={badge.id}
            onClick={() => handleBadgeClick(badge)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors"
            title={`${badge.name}: ${badge.description}`}
          >
            <span>{badge.icon}</span>
            <span>{badge.name}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className={`card p-5 border border-border bg-card/60 backdrop-blur-sm ${className}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            <h3 className="text-base font-bold text-foreground">Verified Trust & Protocol Security</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cryptographically audited safeguards, licensed custody, and historical repayment proofs.
          </p>
        </div>
        <span className="text-[11px] font-medium px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 w-fit">
          100% Soroban Protected
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {badges.map((badge) => (
          <button
            key={badge.id}
            type="button"
            onClick={() => handleBadgeClick(badge)}
            className="flex flex-col text-left p-3 rounded-xl border border-border bg-surface/50 hover:bg-surface hover:border-primary/40 hover:shadow-sm transition-all group cursor-pointer"
          >
            <div className="flex items-center justify-between gap-1 mb-1.5">
              <span className="text-2xl p-1 rounded-lg bg-primary/10 group-hover:scale-110 transition-transform">
                {badge.icon}
              </span>
              <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                {badge.category}
              </span>
            </div>
            <p className="text-xs font-bold text-foreground line-clamp-1 group-hover:text-primary transition-colors">
              {badge.name}
            </p>
            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">
              {badge.description}
            </p>
            <div className="mt-auto pt-2 flex items-center justify-between text-[10px] text-primary/80 font-medium">
              <span>View proof</span>
              <span>→</span>
            </div>
          </button>
        ))}
      </div>

      {/* Verification Details Modal / Flyout */}
      {selectedBadge && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-3xl p-2 rounded-xl bg-primary/10 border border-primary/20">
                  {selectedBadge.icon}
                </span>
                <div>
                  <h4 className="text-base font-bold text-foreground">{selectedBadge.name}</h4>
                  <span className="text-xs text-muted-foreground capitalize">Category: {selectedBadge.category}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBadge(null)}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
                aria-label="Close dialog"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-foreground/90 bg-muted/40 p-3 rounded-xl border border-border/60">
              {selectedBadge.description}
            </p>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Verifying Authority</span>
                <span className="font-semibold text-foreground text-right">{selectedBadge.credentialIssuer}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Verification Date</span>
                <span className="font-medium text-foreground">{selectedBadge.verifiedAt}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">Security Standard</span>
                <span className="font-medium text-emerald-600">Active & Enforced On-Chain</span>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              {selectedBadge.verificationUrl && (
                <a
                  href={selectedBadge.verificationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm flex-1 bg-primary text-primary-foreground hover:opacity-90 text-center"
                >
                  Verify On-Chain Audit ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => setSelectedBadge(null)}
                className="btn btn-sm border border-border text-foreground hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default TrustBadges;
