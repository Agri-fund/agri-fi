import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EcoCertificationBadges from '../EcoCertificationBadges';
import CarbonFootprintWidget from '../CarbonFootprintWidget';
import SustainabilityRecommendations from '../SustainabilityRecommendations';
import CarbonOffsetModal from '../CarbonOffsetModal';
import SustainabilityReportModal from '../SustainabilityReportModal';
import { Deal } from '@/lib/api';
import {
  getDealSustainability,
  calculateCarbonFootprint,
  EcoCertification,
} from '@/lib/sustainability';

// Mock deal data
const testDeal: Deal = {
  id: 'deal-test-cocoa-99',
  commodity: 'cocoa',
  quantity: 100,
  quantity_unit: 'tons',
  total_value: 250000,
  funded_amount: 150000,
  total_invested: 150000,
  token_count: 2500,
  tokens_remaining: 1000,
  token_symbol: 'COCOA-099',
  status: 'open',
  delivery_date: '2027-01-15',
  duration_days: 90,
  created_at: '2026-09-01T00:00:00Z',
  esg_score: 84,
  environmental_score: 86,
  social_score: 82,
  governance_score: 85,
  esg_rating: 'AA',
  esg_status: 'approved',
  esg_breakdown: {
    deforestationFree: true,
    waterEfficiencyRating: 92,
    organicOrRegenerativePractices: true,
    renewableEnergyUsagePercent: 70,
    fairPricePremiumPercent: 18,
  },
};

describe('Sustainability & Carbon Footprint Components (#1185)', () => {
  describe('EcoCertificationBadges', () => {
    const certs: EcoCertification[] = [
      {
        id: 'cert-1',
        type: 'organic',
        name: 'USDA Organic',
        badgeText: 'USDA Organic',
        badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        issuer: 'Control Union',
        issueDate: '2025-01-01',
        expiryDate: '2027-01-01',
        verificationCode: 'ORG-1234',
        description: 'Certified Organic',
      },
      {
        id: 'cert-2',
        type: 'carbon_neutral',
        name: 'Verified Carbon Neutral',
        badgeText: '100% Carbon Neutral',
        badgeColor: 'bg-teal-50 text-teal-700 border-teal-200',
        issuer: 'Gold Standard',
        issueDate: '2025-01-01',
        expiryDate: '2026-01-01',
        verificationCode: 'NEUT-5678',
        description: 'Carbon Neutral',
      },
    ];

    it('renders all certification badges with text and icons', () => {
      render(<EcoCertificationBadges certifications={certs} />);
      expect(screen.getByText('USDA Organic')).toBeInTheDocument();
      expect(screen.getByText('100% Carbon Neutral')).toBeInTheDocument();
    });

    it('returns null if empty array is passed', () => {
      const { container } = render(<EcoCertificationBadges certifications={[]} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('CarbonFootprintWidget', () => {
    it('renders total footprint, intensity, and component breakdowns', () => {
      const sustainability = getDealSustainability(testDeal);
      render(
        <CarbonFootprintWidget
          deal={testDeal}
          sustainability={sustainability}
        />,
      );

      expect(screen.getByText('Sustainability & Carbon Footprint')).toBeInTheDocument();
      expect(screen.getByText(/Total Footprint/i)).toBeInTheDocument();
      expect(screen.getByText(/Carbon Intensity/i)).toBeInTheDocument();
      expect(screen.getByText(/Transportation/i)).toBeInTheDocument();
      expect(screen.getByText(/Storage Energy/i)).toBeInTheDocument();
      expect(screen.getByText(/Processing/i)).toBeInTheDocument();
    });

    it('toggles the interactive simulator', () => {
      const sustainability = getDealSustainability(testDeal);
      render(
        <CarbonFootprintWidget
          deal={testDeal}
          sustainability={sustainability}
        />,
      );

      const simButton = screen.getByText(/Simulate Low-Carbon Supply Chain/i);
      fireEvent.click(simButton);

      expect(screen.getByText(/Transport Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Solar \/ Renewable Energy in Storage/i)).toBeInTheDocument();
    });
  });

  describe('SustainabilityRecommendations', () => {
    it('renders lower carbon alternatives and emission savings', () => {
      render(
        <SustainabilityRecommendations
          deal={testDeal}
          marketplaceDeals={[]}
        />,
      );

      expect(
        screen.getByText('Sustainability & Carbon Optimization'),
      ).toBeInTheDocument();
      expect(screen.getAllByText(/Potential savings/i).length).toBeGreaterThan(0);
    });
  });

  describe('CarbonOffsetModal', () => {
    it('renders offset targets and verified project choices', () => {
      const footprint = calculateCarbonFootprint(testDeal);
      render(
        <CarbonOffsetModal
          deal={testDeal}
          footprint={footprint}
          onClose={vi.fn()}
        />,
      );

      expect(
        screen.getByText('Carbon Neutrality & Offset Retirement'),
      ).toBeInTheDocument();
      expect(screen.getByText('100% Net-Zero')).toBeInTheDocument();
      expect(
        screen.getByText(/East African Smallholder Agroforestry/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Total Offset Cost/i)).toBeInTheDocument();
    });
  });

  describe('SustainabilityReportModal', () => {
    it('renders institutional ESG report and GHG Protocol scopes', () => {
      const sustainability = getDealSustainability(testDeal);
      render(
        <SustainabilityReportModal
          deal={testDeal}
          sustainability={sustainability}
          onClose={vi.fn()}
        />,
      );

      expect(
        screen.getByText('Institutional ESG & Sustainability Report'),
      ).toBeInTheDocument();
      expect(screen.getByText(/Asset Classification/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Greenhouse Gas Emissions \(GHG Protocol Scopes 1, 2, 3\)/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Freight & Transportation/i)).toBeInTheDocument();
    });

    it('switches between investor summary and regulatory disclosure', () => {
      const sustainability = getDealSustainability(testDeal);
      render(
        <SustainabilityReportModal
          deal={testDeal}
          sustainability={sustainability}
          onClose={vi.fn()}
        />,
      );

      const regButton = screen.getByText('Regulatory & SFDR Disclosure');
      fireEvent.click(regButton);

      expect(
        screen.getByText(/Regulatory Disclosures \(EU SFDR & GRI 13\)/i),
      ).toBeInTheDocument();
    });
  });
});
