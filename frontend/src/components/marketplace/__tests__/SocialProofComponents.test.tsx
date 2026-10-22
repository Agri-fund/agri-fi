import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrustBadges from '../TrustBadges';
import InvestorTestimonials from '../InvestorTestimonials';
import DealSuccessStories from '../DealSuccessStories';
import CommunityRatings from '../CommunityRatings';
import DealForum from '../DealForum';
import ExpertEndorsements from '../ExpertEndorsements';
import SocialShareModal from '../SocialShareModal';
import TrustAnalyticsWidget from '../TrustAnalyticsWidget';

describe('Social Proof & Community Components (#1182)', () => {
  beforeEach(() => {
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

  describe('TrustBadges Component', () => {
    it('renders full trust badges security list', () => {
      render(<TrustBadges />);
      expect(screen.getByText('Verified Trust & Protocol Security')).toBeDefined();
      expect(screen.getByText('Stellar Smart Escrow')).toBeDefined();
      expect(screen.getByText('Smart Contract Audited')).toBeDefined();
    });

    it('renders compact inline trust badges', () => {
      render(<TrustBadges compact />);
      expect(screen.getByText('Stellar Smart Escrow')).toBeDefined();
    });

    it('opens credential verification details on badge click', () => {
      render(<TrustBadges />);
      const badgeBtn = screen.getByText('Stellar Smart Escrow').closest('button');
      if (badgeBtn) fireEvent.click(badgeBtn);

      expect(screen.getByText('Verifying Authority')).toBeDefined();
      expect(screen.getByText('Stellar Development Foundation / Soroban')).toBeDefined();
    });
  });

  describe('InvestorTestimonials Component', () => {
    it('renders testimonials with star ratings and verified investor badges', () => {
      render(<InvestorTestimonials />);
      expect(screen.getByText('Verified Investor Testimonials')).toBeDefined();
      expect(screen.getAllByText('✓ Verified Investor').length).toBeGreaterThan(0);
      expect(screen.getByText('Write a Review')).toBeDefined();
    });

    it('filters reviews by star rating', () => {
      render(<InvestorTestimonials />);
      const star5Btn = screen.getByText('5 ★');
      fireEvent.click(star5Btn);
      expect(screen.queryByText('Accessible real-world assets with tangible returns')).toBeNull();
    });

    it('handles helpful button click', () => {
      render(<InvestorTestimonials />);
      const helpfulBtns = screen.getAllByText(/Helpful/);
      fireEvent.click(helpfulBtns[0]);
      expect(helpfulBtns[0]).toBeDefined();
    });
  });

  describe('DealSuccessStories Component', () => {
    it('displays target and realized ROI and repayment status', () => {
      render(<DealSuccessStories />);
      expect(screen.getByText('Deal Success Stories & Repayment Proof')).toBeDefined();
      expect(screen.getByText('Target ROI')).toBeDefined();
      expect(screen.getByText('Realized ROI')).toBeDefined();
      expect(screen.getAllByText('✓ Repaid in Full').length).toBeGreaterThan(0);
    });

    it('allows switching between commodities in the success carousel', () => {
      render(<DealSuccessStories />);
      const coffeeBtn = screen.getByRole('button', { name: 'Coffee' });
      fireEvent.click(coffeeBtn);
      expect(screen.getByText(/Mount Kenya Fairtrade Specialty Arabica/i)).toBeDefined();
    });
  });

  describe('CommunityRatings Component', () => {
    it('renders platform trust rating and star distributions', () => {
      render(<CommunityRatings initialCategory="platform" />);
      expect(screen.getByText('Community Ratings & Track Record')).toBeDefined();
      expect(screen.getByText('4.9')).toBeDefined();
      expect(screen.getByText('Stellar Escrow Reliability & Security')).toBeDefined();
    });

    it('switches category to farmer and trader', () => {
      render(<CommunityRatings initialCategory="platform" />);
      const farmerTab = screen.getByRole('button', { name: 'farmer' });
      fireEvent.click(farmerTab);
      expect(screen.getByText('Historical Loan Repayment')).toBeDefined();

      const traderTab = screen.getByRole('button', { name: 'trader' });
      fireEvent.click(traderTab);
      expect(screen.getByText('Logistics & Transit Punctuality')).toBeDefined();
    });
  });

  describe('DealForum Component', () => {
    it('renders discussion threads and question composer button', () => {
      render(<DealForum />);
      expect(screen.getByText('Community & Deal Discussion Forum')).toBeDefined();
      expect(screen.getByText('Ask Question / Start Thread')).toBeDefined();
    });

    it('expands thread replies when clicked', () => {
      render(<DealForum />);
      const threadTitle = screen.getByText(/What weather contingencies/i);
      fireEvent.click(threadTitle);

      expect(screen.getByText(/Discussion & Verified Responses/i)).toBeDefined();
      expect(screen.getByText(/Kwame Mensah/i)).toBeDefined();
    });

    it('opens ask question modal', () => {
      render(<DealForum />);
      const askBtn = screen.getByText('Ask Question / Start Thread');
      fireEvent.click(askBtn);

      expect(screen.getByText('Ask a Question / Start a Discussion')).toBeDefined();
      expect(screen.getByText('Post Question')).toBeDefined();
    });
  });

  describe('ExpertEndorsements Component', () => {
    it('renders independent agricultural experts and key pillars', () => {
      render(<ExpertEndorsements />);
      expect(screen.getByText('Independent Expert Endorsements')).toBeDefined();
      expect(screen.getByText('Dr. Tariq Al-Mansoor')).toBeDefined();
      expect(screen.getByText('✓ Robust Export Demand')).toBeDefined();
    });
  });

  describe('SocialShareModal Component', () => {
    it('renders social channels and referral preview', () => {
      const onClose = vi.fn();
      render(
        <SocialShareModal
          dealTitle="Premium Cocoa"
          dealId="deal-cocoa-1"
          roi={13.8}
          commodity="Cocoa"
          onClose={onClose}
        />,
      );

      expect(screen.getByText('Share Deal & Earn Referral')).toBeDefined();
      expect(screen.getByText('X / Twitter')).toBeDefined();
      expect(screen.getByText('WhatsApp')).toBeDefined();
      expect(screen.getByText('LinkedIn')).toBeDefined();

      const closeBtn = screen.getByText('✕');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('TrustAnalyticsWidget Component', () => {
    it('displays conversion uplift percentage and A/B comparison metrics', () => {
      render(<TrustAnalyticsWidget />);
      expect(screen.getByText('Trust Signals & Conversion Impact')).toBeDefined();
      expect(screen.getByText('Conversion Uplift')).toBeDefined();
      expect(screen.getByText(/\+31/)).toBeDefined();
      expect(screen.getByText('Active Trust Conversion')).toBeDefined();
      expect(screen.getByText('Trust Impressions')).toBeDefined();
    });
  });
});
