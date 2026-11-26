'use client';

import React from 'react';
import { SocialProofData } from '@/types/socialProof';
import { InvestorTestimonials } from './InvestorTestimonials';
import { DealSuccessStories } from './DealSuccessStories';
import { CommunityRatings } from './CommunityRatings';
import { TrustBadges } from './TrustBadges';

interface SocialProofPanelProps {
  data: SocialProofData;
}

export const SocialProofPanel: React.FC<SocialProofPanelProps> = ({ data }) => {
  return (
    <div className="social-proof-panel space-y-6">
      <TrustBadges badges={data.trustBadges} />

      {data.communityRating && (
        <CommunityRatings rating={data.communityRating} />
      )}

      <InvestorTestimonials testimonials={data.testimonials} />

      <DealSuccessStories stories={data.successStories} />
    </div>
  );
};
