import { Injectable } from '@nestjs/common';

export interface TestimonialItem {
  id: string;
  dealId?: string;
  dealTitle?: string;
  investorName: string;
  investorRole: string;
  investorAvatar: string;
  verifiedInvestment: boolean;
  investmentTier: 'retail' | 'accredited' | 'institutional';
  investmentAmount?: number;
  rating: number;
  title: string;
  content: string;
  createdAt: string;
  helpfulCount: number;
  commodity?: string;
  country?: string;
}

export interface ForumThreadItem {
  id: string;
  dealId?: string;
  dealTitle?: string;
  category: 'deal_qna' | 'risk_analysis' | 'crop_updates' | 'general';
  title: string;
  content: string;
  authorName: string;
  authorRole: 'investor' | 'farmer' | 'trader' | 'analyst' | 'admin';
  authorAvatar?: string;
  isVerifiedInvestor?: boolean;
  isStaff?: boolean;
  createdAt: string;
  upvotes: number;
  repliesCount: number;
  replies: any[];
  tags: string[];
}

@Injectable()
export class SocialProofService {
  private testimonials: TestimonialItem[] = [
    {
      id: 'test-1',
      dealId: 'deal-1',
      dealTitle: 'Organic Cocoa Harvest 2026',
      investorName: 'Sarah Jenkins',
      investorRole: 'Accredited ESG Investor',
      investorAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      verifiedInvestment: true,
      investmentTier: 'accredited',
      investmentAmount: 15000,
      rating: 5,
      title: 'Flawless payout and full supply chain transparency',
      content:
        'I have invested in three cocoa cycles on Agri-Fi. The telemetry updates and GPS shipment tracking gave me complete peace of mind. Payout arrived directly to my Stellar wallet exactly on the milestone date with 14.1% annualized yield.',
      createdAt: '2026-03-14T09:20:00Z',
      helpfulCount: 42,
      commodity: 'Cocoa',
      country: 'Ghana',
    },
    {
      id: 'test-2',
      dealId: 'deal-2',
      dealTitle: 'Fairtrade Arabica Coffee — Highland Estate',
      investorName: 'Marcus Vance',
      investorRole: 'Institutional Impact Fund Lead',
      investorAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&auto=format&fit=crop&q=80',
      verifiedInvestment: true,
      investmentTier: 'institutional',
      investmentAmount: 75000,
      rating: 5,
      title: 'Institutional rigor meets real micro-farmer prosperity',
      content:
        'The ESG score breakdown and verified Fairtrade certificates made internal due diligence straightforward for our fund. It is rare to see sub-second settlement combined with verifiable DEFRA carbon calculations.',
      createdAt: '2026-03-02T14:15:00Z',
      helpfulCount: 29,
      commodity: 'Coffee',
      country: 'Kenya',
    },
    {
      id: 'test-3',
      dealId: 'deal-3',
      dealTitle: 'Certified Non-GMO Soybean Aggregation',
      investorName: 'Elena Rostova',
      investorRole: 'Retail DeFi Investor',
      investorAvatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=120&auto=format&fit=crop&q=80',
      verifiedInvestment: true,
      investmentTier: 'retail',
      investmentAmount: 2500,
      rating: 4,
      title: 'Accessible real-world assets with tangible returns',
      content:
        'Starting with just $100 per token is great for portfolio diversification. Watching the harvest milestones unlock via smart escrow makes farming tangible and safe.',
      createdAt: '2026-02-18T18:40:00Z',
      helpfulCount: 19,
      commodity: 'Soybeans',
      country: 'Brazil',
    },
  ];

  private successStories = [
    {
      id: 'story-1',
      dealId: 'deal-101',
      dealTitle: 'Ghana Volta Basin Organic Cocoa',
      commodity: 'Cocoa',
      originCountry: 'Ghana',
      borrowerName: 'Kwame Mensah & AgroCoop',
      borrowerRole: 'Cooperative President (420 Farmers)',
      durationMonths: 6,
      targetRoi: 12.0,
      realizedRoi: 13.8,
      totalRaisedUsd: 120000,
      payoutDate: '2026-02-15',
      status: 'completed',
      summary: 'Full cycle completed ahead of schedule with zero moisture loss and premium pricing locked via Dutch commodity auction.',
      farmerQuote:
        'Agri-Fi funding allowed us to purchase organic drying screens and bypass predatory local middlemen. Our 420 smallholder families received 22% higher gate prices, and investors earned their full ROI on time.',
      farmerAvatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=120&auto=format&fit=crop&q=80',
      txHash: '0x8f2d...b14e9c7',
      tokenSymbol: 'AGRI-COCOA-25',
    },
    {
      id: 'story-2',
      dealId: 'deal-102',
      dealTitle: 'Mount Kenya Fairtrade Specialty Arabica',
      commodity: 'Coffee',
      originCountry: 'Kenya',
      borrowerName: 'Amani Specialty Producers',
      borrowerRole: 'Lead Exporter & Agronomist',
      durationMonths: 4,
      targetRoi: 13.5,
      realizedRoi: 15.1,
      totalRaisedUsd: 250000,
      payoutDate: '2026-01-30',
      status: 'completed',
      summary: 'Direct port export to Hamburg specialty roasters with smart contract letter of credit escrow.',
      farmerQuote:
        'With transparent Stellar escrow, European roasters paid upon port arrival without the usual 90-day banking lag. It revolutionized our operational cash flow.',
      farmerAvatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=120&auto=format&fit=crop&q=80',
      txHash: '0x3c71...9a8f220',
      tokenSymbol: 'AGRI-COFFEE-08',
    },
  ];

  private forumThreads: ForumThreadItem[] = [
    {
      id: 'thread-1',
      dealId: 'deal-1',
      dealTitle: 'Organic Cocoa Harvest 2026',
      category: 'deal_qna',
      title: 'What weather contingencies are in place for the upcoming rainy season?',
      content:
        'I am looking at participating in this cocoa deal. Are the drying facilities covered with mechanical aerators, or does the cooperative solely depend on sun drying if rainfall spikes?',
      authorName: 'Arthur Dent',
      authorRole: 'investor',
      isVerifiedInvestor: true,
      createdAt: '2026-03-12T10:30:00Z',
      upvotes: 14,
      repliesCount: 2,
      tags: ['Weather Risk', 'Cocoa Quality', 'Escrow Guard'],
      replies: [
        {
          id: 'reply-1',
          threadId: 'thread-1',
          authorName: 'Kwame Mensah (Farmer / Producer)',
          authorRole: 'farmer',
          isStaff: false,
          content:
            'We upgraded our 3 main aggregation centres with solar-assisted biomass dryers last year. Crop moisture is held strictly below 7.5%.',
          createdAt: '2026-03-12T11:45:00Z',
          upvotes: 21,
        },
      ],
    },
  ];

  private trustAnalytics = {
    totalImpressions: 12400,
    socialProofInteractions: 3820,
    dealsViewedWithTrustSignals: 8950,
    baselineConversionRate: 4.2,
    socialProofConversionRate: 5.5,
    conversionUpliftPercent: 31.0,
    interactionBreakdown: {
      trust_badges_viewed: 1850,
      testimonials_read: 940,
      success_stories_explored: 520,
      social_shares: 310,
      referrals_copied: 200,
    },
    lastUpdated: new Date().toISOString(),
  };

  getTestimonials(dealId?: string) {
    if (dealId) {
      return this.testimonials.filter((t) => !t.dealId || t.dealId === dealId);
    }
    return this.testimonials;
  }

  addTestimonial(dto: Partial<TestimonialItem>) {
    const item: TestimonialItem = {
      id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dealId: dto.dealId,
      dealTitle: dto.dealTitle || 'Agri-Fi Deal',
      investorName: dto.investorName || 'Verified Investor',
      investorRole: dto.investorRole || 'Retail Investor',
      investorAvatar: dto.investorAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
      verifiedInvestment: true,
      investmentTier: dto.investmentTier || 'retail',
      investmentAmount: dto.investmentAmount,
      rating: dto.rating || 5,
      title: dto.title || 'Great investment experience',
      content: dto.content || '',
      createdAt: new Date().toISOString(),
      helpfulCount: 0,
      commodity: dto.commodity,
      country: dto.country,
    };
    this.testimonials.unshift(item);
    this.recordEvent('testimonial_submitted');
    return item;
  }

  getSuccessStories() {
    return this.successStories;
  }

  getForumThreads(dealId?: string, category?: string) {
    let list = this.forumThreads;
    if (dealId) list = list.filter((t) => !t.dealId || t.dealId === dealId);
    if (category && category !== 'all') list = list.filter((t) => t.category === category);
    return list;
  }

  createForumThread(dto: Partial<ForumThreadItem>) {
    const thread: ForumThreadItem = {
      id: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      dealId: dto.dealId,
      dealTitle: dto.dealTitle,
      category: dto.category || 'deal_qna',
      title: dto.title || 'Discussion',
      content: dto.content || '',
      authorName: dto.authorName || 'Anonymous',
      authorRole: dto.authorRole || 'investor',
      isVerifiedInvestor: true,
      createdAt: new Date().toISOString(),
      upvotes: 1,
      repliesCount: 0,
      replies: [],
      tags: dto.tags || ['Community Q&A'],
    };
    this.forumThreads.unshift(thread);
    this.recordEvent('forum_thread_created');
    return thread;
  }

  replyToThread(threadId: string, reply: { authorName: string; authorRole: any; content: string }) {
    const thread = this.forumThreads.find((t) => t.id === threadId);
    if (!thread) return null;
    const r = {
      id: `reply-${Date.now()}`,
      threadId,
      authorName: reply.authorName,
      authorRole: reply.authorRole,
      content: reply.content,
      createdAt: new Date().toISOString(),
      upvotes: 0,
      isStaff: reply.authorRole === 'admin' || reply.authorRole === 'analyst',
    };
    thread.replies.push(r);
    thread.repliesCount = thread.replies.length;
    this.recordEvent('forum_reply_created');
    return r;
  }

  upvoteThread(threadId: string) {
    const thread = this.forumThreads.find((t) => t.id === threadId);
    if (!thread) return null;
    thread.upvotes += 1;
    this.recordEvent('forum_upvoted');
    return { id: thread.id, upvotes: thread.upvotes };
  }

  getTrustAnalytics() {
    return this.trustAnalytics;
  }

  recordEvent(eventType: string) {
    this.trustAnalytics.socialProofInteractions += 1;
    const current = (this.trustAnalytics.interactionBreakdown as any)[eventType] || 0;
    (this.trustAnalytics.interactionBreakdown as any)[eventType] = current + 1;
    this.trustAnalytics.lastUpdated = new Date().toISOString();

    const upliftRatio = Math.min(0.38, 0.28 + (this.trustAnalytics.socialProofInteractions / 10000) * 0.08);
    this.trustAnalytics.socialProofConversionRate = Number((this.trustAnalytics.baselineConversionRate * (1 + upliftRatio)).toFixed(2));
    this.trustAnalytics.conversionUpliftPercent = Number((upliftRatio * 100).toFixed(1));

    return this.trustAnalytics;
  }
}
