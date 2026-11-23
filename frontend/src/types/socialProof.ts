export interface InvestorTestimonial {
  id: string;
  investorName: string;
  investorId: string;
  verified: boolean;
  rating: number; // 1-5
  comment: string;
  createdAt: string;
  dealId?: string;
}

export interface DealSuccessStory {
  id: string;
  dealId: string;
  title: string;
  description: string;
  totalFunded: number;
  totalInvestors: number;
  roi: number;
  completedAt: string;
  imageUrl?: string;
}

export interface CommunityRating {
  dealId: string;
  averageRating: number;
  totalRatings: number;
  ratingDistribution: {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
  };
}

export interface TrustBadge {
  id: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string;
}

export interface SocialProofData {
  testimonials: InvestorTestimonial[];
  successStories: DealSuccessStory[];
  communityRating?: CommunityRating;
  trustBadges: TrustBadge[];
}
