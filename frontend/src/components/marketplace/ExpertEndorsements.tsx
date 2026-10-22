'use client';

import React from 'react';
import {
  DEFAULT_EXPERT_ENDORSEMENTS,
  ExpertEndorsement,
  recordTrustInteraction,
} from '@/lib/social-proof';

interface ExpertEndorsementsProps {
  dealId?: string;
  endorsements?: ExpertEndorsement[];
  className?: string;
}

export function ExpertEndorsements({
  dealId,
  endorsements = DEFAULT_EXPERT_ENDORSEMENTS,
  className = '',
}: ExpertEndorsementsProps) {
  const filtered = dealId
    ? endorsements.filter((e) => !e.dealId || e.dealId === dealId)
    : endorsements;

  if (filtered.length === 0) return null;

  return (
    <div className={`card p-6 border border-border bg-gradient-to-r from-emerald-500/5 via-surface to-primary/5 ${className}`}>
      <div className="flex items-center justify-between pb-3 border-b border-border mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎓</span>
          <div>
            <h3 className="text-base font-bold text-foreground">Independent Expert Endorsements</h3>
            <p className="text-xs text-muted-foreground">Evaluations by accredited agricultural economists and commodity risk directors</p>
          </div>
        </div>
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
          Independent Due Diligence
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((expert) => (
          <div
            key={expert.id}
            onClick={() => recordTrustInteraction('expert_endorsement_read')}
            className="p-4 rounded-xl border border-border bg-surface/80 hover:bg-surface hover:border-primary/30 transition-all space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <img
                  src={expert.avatar}
                  alt={expert.expertName}
                  className="w-10 h-10 rounded-full object-cover border border-border"
                />
                <div>
                  <h4 className="text-xs font-bold text-foreground">{expert.expertName}</h4>
                  <p className="text-[11px] text-muted-foreground">{expert.expertTitle}</p>
                  <p className="text-[10px] text-primary/80 font-medium">{expert.organization}</p>
                </div>
              </div>
              <div className="flex text-amber-500 text-xs">
                {'★'.repeat(Math.round(expert.rating))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground italic leading-relaxed">
              &ldquo;{expert.endorsementQuote}&rdquo;
            </p>

            <div className="pt-2 border-t border-border/50 flex flex-wrap gap-1.5">
              {expert.keyPillars.map((pillar) => (
                <span
                  key={pillar}
                  className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-foreground/80 border border-border"
                >
                  ✓ {pillar}
                </span>
              ))}
            </div>

            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
              <span>{expert.accreditation}</span>
              <span>Verified: {expert.verifiedAt}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export default ExpertEndorsements;
