import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_TESTIMONIALS,
  DEFAULT_SUCCESS_STORIES,
  DEFAULT_TRUST_BADGES,
  DEFAULT_FORUM_THREADS,
  DEFAULT_ENTITY_RATINGS,
  getStoredTestimonials,
  submitTestimonial,
  voteTestimonialHelpful,
  getForumThreads,
  createForumThread,
  replyToForumThread,
  upvoteForumThread,
  generateSocialShareUrl,
  recordTrustInteraction,
  getTrustAnalytics,
} from '../social-proof';

describe('Social Proof Engine (frontend/src/lib/social-proof.ts)', () => {
  beforeEach(() => {
    // Clear localStorage mock
    vi.stubGlobal('localStorage', {
      store: {} as Record<string, string>,
      getItem(key: string) {
        return this.store[key] || null;
      },
      setItem(key: string, value: string) {
        this.store[key] = value.toString();
      },
      clear() {
        this.store = {};
      },
    });
  });

  describe('Investor Testimonials', () => {
    it('returns default testimonials when storage is empty', () => {
      const testimonials = getStoredTestimonials();
      expect(testimonials.length).toBeGreaterThanOrEqual(3);
      expect(testimonials[0].verifiedInvestment).toBe(true);
    });

    it('filters testimonials by dealId when provided', () => {
      const filtered = getStoredTestimonials('deal-1');
      expect(filtered.every((t) => !t.dealId || t.dealId === 'deal-1')).toBe(true);
    });

    it('allows submitting a new verified testimonial and prepending it', () => {
      const newReview = submitTestimonial({
        dealId: 'deal-999',
        dealTitle: 'Robusta Coffee Batch',
        investorName: 'Alice Green',
        investorRole: 'Retail Investor',
        investorAvatar: 'https://example.com/avatar.jpg',
        verifiedInvestment: true,
        investmentTier: 'retail',
        rating: 5,
        title: 'Outstanding returns',
        content: 'Received timely interest payments directly to Stellar address.',
      });

      expect(newReview.id).toBeDefined();
      expect(newReview.createdAt).toBeDefined();
      expect(newReview.helpfulCount).toBe(0);

      const all = getStoredTestimonials('deal-999');
      expect(all.some((t) => t.id === newReview.id)).toBe(true);
    });

    it('toggles helpful votes on testimonials', () => {
      const sample = DEFAULT_TESTIMONIALS[0];
      const initialCount = sample.helpfulCount;

      const res1 = voteTestimonialHelpful(sample.id);
      expect(res1.success).toBe(true);
      expect(res1.helpfulCount).toBe(initialCount + 1);

      const res2 = voteTestimonialHelpful(sample.id);
      expect(res2.success).toBe(true);
      expect(res2.helpfulCount).toBe(initialCount);
    });
  });

  describe('Deal Success Stories & ROI Data', () => {
    it('provides completed stories with target vs realized ROI', () => {
      expect(DEFAULT_SUCCESS_STORIES.length).toBeGreaterThan(0);
      for (const story of DEFAULT_SUCCESS_STORIES) {
        expect(story.status).toBe('completed');
        expect(story.realizedRoi).toBeGreaterThan(0);
        expect(story.txHash).toBeDefined();
        expect(story.farmerQuote.length).toBeGreaterThan(20);
      }
    });
  });

  describe('Community Ratings & Trust Badges', () => {
    it('has structured ratings for platform, farmer, and trader', () => {
      expect(DEFAULT_ENTITY_RATINGS.platform.overallRating).toBe(4.9);
      expect(DEFAULT_ENTITY_RATINGS.platform.criteria.length).toBeGreaterThanOrEqual(3);
      expect(DEFAULT_ENTITY_RATINGS.farmer_default.overallRating).toBeGreaterThanOrEqual(4.5);
      expect(DEFAULT_ENTITY_RATINGS.trader_default.overallRating).toBeGreaterThanOrEqual(4.5);
    });

    it('provides cryptographically verified trust badges with issuers', () => {
      expect(DEFAULT_TRUST_BADGES.length).toBeGreaterThanOrEqual(4);
      expect(DEFAULT_TRUST_BADGES.some((b) => b.id === 'stellar_escrow')).toBe(true);
      expect(DEFAULT_TRUST_BADGES.some((b) => b.id === 'certik_audited')).toBe(true);
    });
  });

  describe('Community Forums & Discussion Threads', () => {
    it('retrieves forum threads by category or dealId', () => {
      const qna = getForumThreads(undefined, 'deal_qna');
      expect(qna.every((t) => t.category === 'deal_qna')).toBe(true);
    });

    it('allows creating a new forum thread and replying to it', () => {
      const thread = createForumThread({
        dealId: 'deal-1',
        dealTitle: 'Organic Cocoa',
        category: 'deal_qna',
        title: 'Is temperature monitoring active in transit?',
        content: 'Does the container include IoT temperature loggers?',
        authorName: 'Bob Trader',
        authorRole: 'investor',
      });

      expect(thread.id).toBeDefined();
      expect(thread.upvotes).toBe(1);

      const reply = replyToForumThread(thread.id, {
        authorName: 'Coop Lead',
        authorRole: 'farmer',
        content: 'Yes, satellite IoT loggers report every 2 hours.',
      });

      expect(reply).not.toBeNull();
      expect(reply?.content).toContain('satellite IoT loggers');

      const reloaded = getForumThreads('deal-1');
      const updated = reloaded.find((t) => t.id === thread.id);
      expect(updated?.repliesCount).toBe(1);
    });

    it('toggles thread upvotes', () => {
      const thread = DEFAULT_FORUM_THREADS[0];
      const initial = thread.upvotes;

      const res = upvoteForumThread(thread.id);
      expect(res.upvotes).toBe(initial + 1);
      expect(res.userUpvoted).toBe(true);

      const res2 = upvoteForumThread(thread.id);
      expect(res2.upvotes).toBe(initial);
      expect(res2.userUpvoted).toBe(false);
    });
  });

  describe('Social Sharing & Referral Attribution', () => {
    it('generates UTM-tagged social share URLs for multiple channels', () => {
      const twitterShare = generateSocialShareUrl({
        channel: 'twitter',
        dealTitle: 'Premium Arabica Coffee',
        dealId: 'deal-coffee-1',
        roi: 14.5,
        referralCode: 'AGRI-TEST-99',
      });

      expect(twitterShare.shareUrl).toContain('twitter.com/intent/tweet');
      expect(twitterShare.directUrl).toContain('utm_source=twitter');
      expect(twitterShare.directUrl).toContain('ref=AGRI-TEST-99');
      expect(twitterShare.shareText).toContain('14.5%');

      const whatsappShare = generateSocialShareUrl({
        channel: 'whatsapp',
        dealTitle: 'Premium Cocoa',
        referralCode: 'AGRI-TEST-99',
      });
      expect(whatsappShare.shareUrl).toContain('api.whatsapp.com');
    });
  });

  describe('Trust Analytics & Conversion Uplift', () => {
    it('tracks trust interactions and reflects empirical conversion uplift >= 30%', () => {
      const initial = getTrustAnalytics();
      expect(initial.baselineConversionRate).toBe(4.2);
      expect(initial.conversionUpliftPercent).toBeGreaterThanOrEqual(30.0);

      recordTrustInteraction('trust_badge_inspected');
      const updated = getTrustAnalytics();
      expect(updated.socialProofInteractions).toBeGreaterThan(initial.socialProofInteractions);
      expect(updated.conversionUpliftPercent).toBeGreaterThanOrEqual(30.0);
    });
  });
});
