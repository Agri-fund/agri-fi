import { describe, it, expect } from 'vitest';
import {
  calculateCarbonFootprint,
  aggregateSustainabilityScore,
  resolveEcoCertifications,
  getDealSustainability,
  getSustainabilityRecommendations,
  calculateOffsetCost,
  simulateOffsetPurchase,
  TRANSPORT_EMISSION_FACTORS,
  STORAGE_EMISSION_FACTORS,
  COMMODITY_PROCESSING_FACTORS,
  VERIFIED_OFFSET_PROJECTS,
} from '../sustainability';
import { Deal } from '../api';

const mockDeal: Deal = {
  id: 'deal-test-cocoa-01',
  commodity: 'cocoa',
  quantity: 50,
  quantity_unit: 'tons',
  total_value: 120000,
  funded_amount: 80000,
  total_invested: 80000,
  token_count: 1200,
  tokens_remaining: 400,
  token_symbol: 'COCOA-001',
  status: 'open',
  delivery_date: '2026-12-01',
  duration_days: 90,
  created_at: '2026-09-01T00:00:00Z',
  esg_score: 82,
  environmental_score: 85,
  social_score: 80,
  governance_score: 81,
  esg_rating: 'AA',
  esg_status: 'approved',
  esg_breakdown: {
    deforestationFree: true,
    waterEfficiencyRating: 90,
    organicOrRegenerativePractices: true,
    renewableEnergyUsagePercent: 65,
    fairPricePremiumPercent: 15,
  },
};

describe('Sustainability Tracking & Carbon Footprint Calculation', () => {
  describe('Carbon Footprint Calculation', () => {
    it('calculates transportation, storage, and processing emissions correctly', () => {
      const footprint = calculateCarbonFootprint(mockDeal, {
        distanceKm: 1000,
        weightTons: 50,
        transportMode: 'road_freight',
        storageDays: 30,
        storageType: 'ambient_warehouse',
        renewableEnergyPercent: 0,
      });

      // Transport: 1000 km * 50 tons * 0.0962 kg/t-km = 4810 kg
      expect(footprint.transportationEmissionsKg).toBe(4810);

      // Storage: 1 month * 50 tons * 2.45 kg/t-month = 122.5 kg -> rounded ~123 kg
      expect(footprint.storageEmissionsKg).toBe(123);

      // Processing: 50 tons * 115 kg/t = 5750 kg
      expect(footprint.processingEmissionsKg).toBe(5750);

      // Total = 4810 + 122.5 + 5750 = 10682.5 kg -> 10.68 t
      expect(footprint.totalEmissionsKgCo2e).toBe(10683);
      expect(footprint.totalEmissionsTonsCo2e).toBe(10.68);
      expect(footprint.breakdownPercent.transport).toBeGreaterThan(0);
      expect(footprint.breakdownPercent.storage).toBeGreaterThan(0);
      expect(footprint.breakdownPercent.processing).toBeGreaterThan(0);
    });

    it('accounts for renewable energy in storage reduction', () => {
      const dirtyStorage = calculateCarbonFootprint(mockDeal, {
        renewableEnergyPercent: 0,
        storageDays: 60,
      });
      const cleanStorage = calculateCarbonFootprint(mockDeal, {
        renewableEnergyPercent: 80,
        storageDays: 60,
      });

      expect(cleanStorage.storageEmissionsKg).toBeLessThan(dirtyStorage.storageEmissionsKg);
    });

    it('reflects sea vs road vs rail emission factor variances', () => {
      const road = calculateCarbonFootprint(mockDeal, { transportMode: 'road_freight', distanceKm: 2000 });
      const sea = calculateCarbonFootprint(mockDeal, { transportMode: 'sea_freight', distanceKm: 2000 });
      const rail = calculateCarbonFootprint(mockDeal, { transportMode: 'rail_freight', distanceKm: 2000 });

      expect(sea.transportationEmissionsKg).toBeLessThan(rail.transportationEmissionsKg);
      expect(rail.transportationEmissionsKg).toBeLessThan(road.transportationEmissionsKg);
    });
  });

  describe('Sustainability Score Aggregation', () => {
    it('aggregates environmental, social, and governance metrics with weighted scoring', () => {
      // 90 * 0.4 (36) + 80 * 0.35 (28) + 70 * 0.25 (17.5) = 81.5 -> 82
      const result = aggregateSustainabilityScore(90, 80, 70);
      expect(result.overallScore).toBe(82);
      expect(result.rating).toBe('AA');
      expect(result.tierClassification).toBe('Outperformer');
    });

    it('identifies Industry Leaders with AAA ratings (>= 88)', () => {
      const result = aggregateSustainabilityScore(95, 92, 90);
      expect(result.overallScore).toBeGreaterThanOrEqual(88);
      expect(result.rating).toBe('AAA');
      expect(result.tierClassification).toBe('Industry Leader');
    });

    it('classifies transition tier for low scores', () => {
      const result = aggregateSustainabilityScore(45, 50, 40);
      expect(result.overallScore).toBeLessThan(55);
      expect(result.tierClassification).toBe('In Transition');
    });
  });

  describe('Eco-Friendly Certifications Display', () => {
    it('resolves organic, fair trade, and rainforest alliance certifications for qualified deals', () => {
      const certs = resolveEcoCertifications(mockDeal);
      const certTypes = certs.map((c) => c.type);

      expect(certTypes).toContain('organic');
      expect(certTypes).toContain('fair_trade');
      expect(certTypes).toContain('rainforest_alliance');
      expect(certs.every((c) => c.badgeText && c.verificationCode)).toBe(true);
    });
  });

  describe('Sustainability Recommendations', () => {
    it('generates lower-carbon alternative and modal shift suggestions', () => {
      const recommendations = getSustainabilityRecommendations(mockDeal, []);
      expect(recommendations.length).toBeGreaterThan(0);

      const hasModalOrOffset = recommendations.some(
        (r) => r.savingsTons > 0 && r.primaryAction.length > 0,
      );
      expect(hasModalOrOffset).toBe(true);
    });
  });

  describe('Carbon Offset Integration', () => {
    it('calculates accurate offset costs for deal footprint', () => {
      const project = VERIFIED_OFFSET_PROJECTS[0];
      const calculation = calculateOffsetCost(15.5, project);

      expect(calculation.tonsToOffset).toBe(15.5);
      expect(calculation.pricePerTonUsd).toBe(project.pricePerTonUsd);
      expect(calculation.totalCostUsd).toBe(Number((15.5 * project.pricePerTonUsd).toFixed(2)));
    });

    it('simulates verified offset retirement with unique certificate ID', () => {
      const project = VERIFIED_OFFSET_PROJECTS[0];
      const status = simulateOffsetPurchase(mockDeal, project, 10.68);

      expect(status.isOffset).toBe(true);
      expect(status.offsetTonsCo2e).toBe(10.68);
      expect(status.netEmissionsTonsCo2e).toBe(0);
      expect(status.offsetCertificateId).toMatch(/^AGRIFI-OFFSET-/);
      expect(status.retiredAt).toBeDefined();
    });
  });
});
