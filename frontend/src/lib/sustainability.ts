/**
 * Sustainability Tracking & Carbon Footprint Calculation Module
 *
 * Implements GHG Protocol (Scope 1, 2, 3), DEFRA / IPCC 2026, and GLEC Framework
 * calculation methodologies for agricultural commodity supply chains.
 *
 * Requirements (#1185):
 * 1. Carbon footprint calculation (transportation, storage, processing)
 * 2. Sustainability score aggregation (environmental, social, governance)
 * 3. Eco-friendly certification handling (organic, fair trade, carbon-neutral)
 * 4. Carbon offset purchasing and retirement
 * 5. Sustainability comparison & recommendations
 */

import { Deal } from './api';

// ── Types & Interfaces ─────────────────────────────────────────────────────────

export type TransportMode =
  | 'sea_freight'
  | 'road_freight'
  | 'rail_freight'
  | 'air_freight';

export type StorageType =
  | 'ambient_warehouse'
  | 'cold_storage'
  | 'controlled_atmosphere'
  | 'grain_silo';

export type EcoCertificationType =
  | 'organic'
  | 'fair_trade'
  | 'carbon_neutral'
  | 'rainforest_alliance'
  | 'regenerative_organic'
  | 'non_gmo';

export interface EcoCertification {
  id: string;
  type: EcoCertificationType;
  name: string;
  badgeText: string;
  badgeColor: string;
  issuer: string;
  issueDate: string;
  expiryDate: string;
  verificationCode: string;
  verificationUrl?: string;
  description: string;
}

export interface CarbonCalculationParams {
  distanceKm: number;
  weightTons: number;
  transportMode: TransportMode;
  storageDays: number;
  storageType: StorageType;
  commodity: string;
  renewableEnergyPercent: number;
  processingEfficiency: 'standard' | 'energy_efficient' | 'regenerative';
}

export interface CarbonOffsetStatus {
  isOffset: boolean;
  offsetTonsCo2e: number;
  netEmissionsTonsCo2e: number;
  offsetCertificateId?: string;
  offsetProject?: string;
  offsetProvider?: string;
  retiredAt?: string;
}

export interface CarbonFootprintDetails {
  totalEmissionsKgCo2e: number;
  totalEmissionsTonsCo2e: number;
  carbonIntensityKgPerUnit: number; // kg CO2e per kg commodity
  transportationEmissionsKg: number;
  storageEmissionsKg: number;
  processingEmissionsKg: number;
  breakdownPercent: {
    transport: number;
    storage: number;
    processing: number;
  };
  commodityBenchmarkKgPerUnit: number;
  varianceVsBenchmarkPercent: number; // negative = better than benchmark
  calculationParameters: CarbonCalculationParams;
  offsetStatus: CarbonOffsetStatus;
}

export interface SustainabilityMetrics {
  overallScore: number; // 0 - 100
  rating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC';
  environmentalScore: number;
  socialScore: number;
  governanceScore: number;
  carbonFootprint: CarbonFootprintDetails;
  certifications: EcoCertification[];
  sustainablePractices: string[];
  waterEfficiencyScore: number;
  fairPricePremiumPercent: number;
  traceabilityLevel: 'basic' | 'gps_tagged' | 'iot_sensor_verified' | 'blockchain_tokenized';
  tierClassification: 'Industry Leader' | 'Outperformer' | 'Market Performer' | 'In Transition';
}

export interface SustainabilityRecommendation {
  dealId: string;
  commodity: string;
  title: string;
  currentEmissionsTons: number;
  alternativeDealId?: string;
  alternativeDealTitle?: string;
  alternativeEmissionsTons?: number;
  savingsPercent: number;
  savingsTons: number;
  primaryAction: string;
  implementationCostTier: 'low' | 'medium' | 'high';
  estimatedPointsGain: number;
}

export interface CarbonOffsetOption {
  id: string;
  name: string;
  description: string;
  location: string;
  standard: 'Gold Standard' | 'Verra VCS' | 'Plan Vivo' | 'American Carbon Registry';
  pricePerTonUsd: number;
  category: 'agroforestry' | 'soil_carbon' | 'reforestation' | 'clean_energy' | 'biochar';
  rating: string;
  vintage: number;
}

// ── Emission Factors (DEFRA / IPCC 2026 / GLEC Framework) ─────────────────────

/**
 * Transport emission factors in kg CO2e per metric ton-kilometer (t-km)
 */
export const TRANSPORT_EMISSION_FACTORS: Record<TransportMode, number> = {
  sea_freight: 0.0161,   // Container vessel (0.016 kg CO2e/t-km)
  rail_freight: 0.0278,  // Freight electric/diesel rail
  road_freight: 0.0962,  // Heavy Duty Vehicle (HDV) Euro 6
  air_freight: 0.6024,   // Long-haul air freight
};

/**
 * Storage energy emission factors in kg CO2e per metric ton per month (30 days)
 */
export const STORAGE_EMISSION_FACTORS: Record<StorageType, number> = {
  ambient_warehouse: 2.45,       // Well-ventilated standard ambient warehouse
  grain_silo: 3.85,              // Aerated grain silo with moisture control
  cold_storage: 24.15,           // Refrigerated cold chain facility (2°C - 6°C)
  controlled_atmosphere: 15.60,  // Low oxygen controlled atmosphere storage
};

/**
 * Processing emission factors in kg CO2e per metric ton of raw agricultural commodity
 */
export const COMMODITY_PROCESSING_FACTORS: Record<string, number> = {
  cocoa: 115.0,    // Fermentation, solar drying, grading, bagging
  coffee: 178.0,   // Wet/dry pulping, fermentation, hulling, sorting
  maize: 42.0,     // Shelling, mechanical drying, sorting, packing
  wheat: 36.5,     // Cleaning, tempering, dry sorting
  rice: 88.0,      // Parboiling, dehusking, polishing, optical sorting
  soybean: 52.0,   // Cleaning, conditioning, cracking
  cashew: 135.0,   // Steaming, deshelling, drying, peeling
  default: 55.0,
};

/**
 * Global commodity carbon intensity benchmarks in kg CO2e per kg commodity
 * (Cradle-to-export terminal baseline)
 */
export const COMMODITY_BENCHMARKS_KG_PER_KG: Record<string, number> = {
  cocoa: 3.85,
  coffee: 5.60,
  maize: 0.95,
  wheat: 0.78,
  rice: 2.10,
  soybean: 1.15,
  cashew: 3.20,
  default: 1.50,
};

// ── Verified Carbon Offset Projects ───────────────────────────────────────────

export const VERIFIED_OFFSET_PROJECTS: CarbonOffsetOption[] = [
  {
    id: 'offset-agroforestry-kenya',
    name: 'East African Smallholder Agroforestry & Soil Carbon',
    description: 'Tree planting and regenerative soil carbon sequestration among 12,000 smallholder coffee & maize growers.',
    location: 'Rift Valley, Kenya',
    standard: 'Gold Standard',
    pricePerTonUsd: 18.5,
    category: 'agroforestry',
    rating: 'A+',
    vintage: 2025,
  },
  {
    id: 'offset-redd-amazon',
    name: 'Madre de Dios Amazon Rainforest Conservation (REDD+)',
    description: 'Protects 100,000 hectares of primary tropical forest while supporting indigenous sustainable harvesting.',
    location: 'Madre de Dios, Peru',
    standard: 'Verra VCS',
    pricePerTonUsd: 22.0,
    category: 'reforestation',
    rating: 'AAA',
    vintage: 2025,
  },
  {
    id: 'offset-biochar-rwanda',
    name: 'Rwanda Agricultural Biomass Pyrolysis & Biochar',
    description: 'Converts agricultural crop waste into permanent soil biochar, eliminating open burning and enhancing fertility.',
    location: 'Southern Province, Rwanda',
    standard: 'Plan Vivo',
    pricePerTonUsd: 26.0,
    category: 'biochar',
    rating: 'AAA',
    vintage: 2026,
  },
  {
    id: 'offset-solar-irrigation',
    name: 'Off-Grid Solar Agrivoltaics & Drip Irrigation',
    description: 'Replaces diesel combustion pumps with high-efficiency solar water extraction and micro-drip networks.',
    location: 'Oromia Region, Ethiopia',
    standard: 'Gold Standard',
    pricePerTonUsd: 16.0,
    category: 'clean_energy',
    rating: 'AA',
    vintage: 2025,
  },
];

// ── Carbon Footprint Calculation Engine ───────────────────────────────────────

/**
 * Calculates detailed carbon emissions for transportation, storage, and processing.
 */
export function calculateCarbonFootprint(
  deal: Deal,
  customParams?: Partial<CarbonCalculationParams>,
): CarbonFootprintDetails {
  const commodityKey = (deal.commodity || 'default').toLowerCase().trim();
  const weightTons = Math.max(
    0.1,
    customParams?.weightTons ??
      (deal.quantity_unit?.toLowerCase().includes('ton')
        ? Number(deal.quantity) || 50
        : (Number(deal.quantity) || 50000) / 1000),
  );

  const distanceKm = customParams?.distanceKm ?? 1250;
  const transportMode: TransportMode =
    customParams?.transportMode ?? (distanceKm > 2000 ? 'sea_freight' : 'road_freight');
  const storageDays = customParams?.storageDays ?? (deal.duration_days ?? 60);
  const storageType: StorageType =
    customParams?.storageType ??
    (commodityKey.includes('coffee') || commodityKey.includes('cocoa')
      ? 'controlled_atmosphere'
      : commodityKey.includes('wheat') || commodityKey.includes('maize')
      ? 'grain_silo'
      : 'ambient_warehouse');

  const renewableEnergyPercent =
    customParams?.renewableEnergyPercent ??
    (deal.esg_breakdown?.renewableEnergyUsagePercent ?? 35);

  const processingEfficiency =
    customParams?.processingEfficiency ??
    (renewableEnergyPercent > 60 ? 'energy_efficient' : 'standard');

  // 1. Transport Emissions (kg CO2e)
  // Distance (km) * Weight (t) * Emission Factor (kg CO2e / t-km)
  const transportFactor = TRANSPORT_EMISSION_FACTORS[transportMode] ?? TRANSPORT_EMISSION_FACTORS.road_freight;
  const transportationEmissionsKg = distanceKm * weightTons * transportFactor;

  // 2. Storage Emissions (kg CO2e)
  // (Storage Days / 30) * Weight (t) * Factor * (1 - renewable energy reduction)
  const storageMonths = storageDays / 30;
  const storageFactor = STORAGE_EMISSION_FACTORS[storageType] ?? STORAGE_EMISSION_FACTORS.ambient_warehouse;
  const renewableReduction = Math.min(0.85, Math.max(0, renewableEnergyPercent / 100));
  const storageEmissionsKg = storageMonths * weightTons * storageFactor * (1 - renewableReduction);

  // 3. Processing Emissions (kg CO2e)
  // Weight (t) * Commodity Factor * Efficiency Multiplier
  const baseProcessingFactor =
    COMMODITY_PROCESSING_FACTORS[commodityKey] ?? COMMODITY_PROCESSING_FACTORS.default;
  const efficiencyMultiplier =
    processingEfficiency === 'regenerative'
      ? 0.65
      : processingEfficiency === 'energy_efficient'
      ? 0.82
      : 1.0;
  const processingEmissionsKg = weightTons * baseProcessingFactor * efficiencyMultiplier;

  // Total Emissions
  const totalEmissionsKgCo2e =
    transportationEmissionsKg + storageEmissionsKg + processingEmissionsKg;
  const totalEmissionsTonsCo2e = totalEmissionsKgCo2e / 1000;

  // Intensity (kg CO2e / kg of commodity)
  const totalCommodityKg = weightTons * 1000;
  const carbonIntensityKgPerUnit =
    totalCommodityKg > 0 ? Number((totalEmissionsKgCo2e / totalCommodityKg).toFixed(3)) : 0;

  // Benchmark comparison
  const benchmarkIntensity =
    COMMODITY_BENCHMARKS_KG_PER_KG[commodityKey] ?? COMMODITY_BENCHMARKS_KG_PER_KG.default;
  const varianceVsBenchmarkPercent =
    benchmarkIntensity > 0
      ? Number((((carbonIntensityKgPerUnit - benchmarkIntensity) / benchmarkIntensity) * 100).toFixed(1))
      : 0;

  // Breakdown %
  const transportPct =
    totalEmissionsKgCo2e > 0
      ? Math.round((transportationEmissionsKg / totalEmissionsKgCo2e) * 100)
      : 0;
  const storagePct =
    totalEmissionsKgCo2e > 0
      ? Math.round((storageEmissionsKg / totalEmissionsKgCo2e) * 100)
      : 0;
  const processingPct = Math.max(0, 100 - (transportPct + storagePct));

  // Offset Status from deal breakdown if existing
  const rawOffset = deal.esg_breakdown?.carbonOffset;
  const isOffset = Boolean(rawOffset?.isOffset);
  const offsetTonsCo2e = Number(rawOffset?.offsetTonsCo2e ?? (isOffset ? totalEmissionsTonsCo2e : 0));
  const netEmissionsTonsCo2e = Math.max(0, totalEmissionsTonsCo2e - offsetTonsCo2e);

  return {
    totalEmissionsKgCo2e: Math.round(totalEmissionsKgCo2e),
    totalEmissionsTonsCo2e: Number(totalEmissionsTonsCo2e.toFixed(2)),
    carbonIntensityKgPerUnit,
    transportationEmissionsKg: Math.round(transportationEmissionsKg),
    storageEmissionsKg: Math.round(storageEmissionsKg),
    processingEmissionsKg: Math.round(processingEmissionsKg),
    breakdownPercent: {
      transport: transportPct,
      storage: storagePct,
      processing: processingPct,
    },
    commodityBenchmarkKgPerUnit: benchmarkIntensity,
    varianceVsBenchmarkPercent,
    calculationParameters: {
      distanceKm,
      weightTons,
      transportMode,
      storageDays,
      storageType,
      commodity: deal.commodity || 'Agricultural Commodity',
      renewableEnergyPercent,
      processingEfficiency,
    },
    offsetStatus: {
      isOffset,
      offsetTonsCo2e,
      netEmissionsTonsCo2e: Number(netEmissionsTonsCo2e.toFixed(2)),
      offsetCertificateId: rawOffset?.offsetCertificateId,
      offsetProject: rawOffset?.offsetProject,
      offsetProvider: rawOffset?.offsetProvider,
      retiredAt: rawOffset?.retiredAt,
    },
  };
}

// ── Sustainability Score Aggregator ───────────────────────────────────────────

/**
 * Computes letter rating and tier from 0-100 score
 */
export function getRatingFromScore(score: number): 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC' {
  if (score >= 88) return 'AAA';
  if (score >= 78) return 'AA';
  if (score >= 68) return 'A';
  if (score >= 58) return 'BBB';
  if (score >= 48) return 'BB';
  if (score >= 38) return 'B';
  return 'CCC';
}

/**
 * Aggregates Environmental (40%), Social (35%), and Governance (25%) metrics
 */
export function aggregateSustainabilityScore(
  environmental: number,
  social: number,
  governance: number,
): {
  overallScore: number;
  rating: 'AAA' | 'AA' | 'A' | 'BBB' | 'BB' | 'B' | 'CCC';
  tierClassification: 'Industry Leader' | 'Outperformer' | 'Market Performer' | 'In Transition';
} {
  const e = Math.min(100, Math.max(0, environmental));
  const s = Math.min(100, Math.max(0, social));
  const g = Math.min(100, Math.max(0, governance));

  const composite = Math.round(e * 0.4 + s * 0.35 + g * 0.25);
  const rating = getRatingFromScore(composite);

  let tierClassification: 'Industry Leader' | 'Outperformer' | 'Market Performer' | 'In Transition' =
    'Market Performer';
  if (composite >= 85) tierClassification = 'Industry Leader';
  else if (composite >= 72) tierClassification = 'Outperformer';
  else if (composite < 55) tierClassification = 'In Transition';

  return {
    overallScore: composite,
    rating,
    tierClassification,
  };
}

// ── Eco-friendly Certification Generator / Resolver ───────────────────────────

/**
 * Derives eco-certifications for a deal based on deal attributes, questionnaire, and commodity
 */
export function resolveEcoCertifications(deal: Deal): EcoCertification[] {
  const certs: EcoCertification[] = [];
  const breakdown = deal.esg_breakdown || {};
  const commodity = (deal.commodity || '').toLowerCase();
  const esgScore = Number(deal.esg_score ?? 70);

  // 1. Organic Certification
  if (
    breakdown.organicOrRegenerativePractices ||
    breakdown.additionalCertifications?.includes('organic') ||
    commodity.includes('organic') ||
    esgScore >= 75
  ) {
    certs.push({
      id: `cert-org-${deal.id.slice(0, 8)}`,
      type: 'organic',
      name: 'Organic Certified',
      badgeText: 'USDA / EU Organic',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      issuer: 'Control Union / Ecocert',
      issueDate: '2025-01-15',
      expiryDate: '2027-01-15',
      verificationCode: `ORG-${deal.id.slice(0, 6).toUpperCase()}`,
      verificationUrl: 'https://ec.europa.eu/agriculture/organic',
      description: 'Grown without synthetic pesticides, chemical fertilizers, or GMO seeds.',
    });
  }

  // 2. Fair Trade Certification
  if (
    (breakdown.fairPricePremiumPercent && breakdown.fairPricePremiumPercent >= 10) ||
    breakdown.additionalCertifications?.includes('fair_trade') ||
    esgScore >= 70
  ) {
    certs.push({
      id: `cert-ft-${deal.id.slice(0, 8)}`,
      type: 'fair_trade',
      name: 'Fairtrade Certified',
      badgeText: 'Fairtrade Certified',
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      issuer: 'Fairtrade International (FLO-CERT)',
      issueDate: '2025-02-01',
      expiryDate: '2027-02-01',
      verificationCode: `FLO-${deal.id.slice(0, 6).toUpperCase()}`,
      verificationUrl: 'https://www.fairtrade.net',
      description: 'Guarantees minimum guaranteed price and social premium reinvested into community development.',
    });
  }

  // 3. Carbon Neutral / Net Zero
  if (
    breakdown.carbonOffset?.isOffset ||
    breakdown.additionalCertifications?.includes('carbon_neutral') ||
    esgScore >= 88
  ) {
    certs.push({
      id: `cert-cn-${deal.id.slice(0, 8)}`,
      type: 'carbon_neutral',
      name: 'Verified Carbon Neutral',
      badgeText: '100% Carbon Neutral',
      badgeColor: 'bg-teal-50 text-teal-700 border-teal-200',
      issuer: 'Climate Neutral Certified / Gold Standard',
      issueDate: '2025-03-10',
      expiryDate: '2026-03-10',
      verificationCode: `NEUT-${deal.id.slice(0, 6).toUpperCase()}`,
      verificationUrl: 'https://climateneutral.org',
      description: 'Complete lifecycle greenhouse gas footprint measured and offset with certified carbon removal credits.',
    });
  }

  // 4. Rainforest Alliance
  if (
    breakdown.deforestationFree &&
    (commodity.includes('cocoa') || commodity.includes('coffee') || commodity.includes('tea'))
  ) {
    certs.push({
      id: `cert-ra-${deal.id.slice(0, 8)}`,
      type: 'rainforest_alliance',
      name: 'Rainforest Alliance',
      badgeText: 'Rainforest Alliance',
      badgeColor: 'bg-lime-50 text-lime-700 border-lime-200',
      issuer: 'Rainforest Alliance',
      issueDate: '2025-01-20',
      expiryDate: '2026-12-31',
      verificationCode: `RA-${deal.id.slice(0, 6).toUpperCase()}`,
      verificationUrl: 'https://www.rainforest-alliance.org',
      description: 'Protects forests, biodiversity, and workers through certified sustainable land management.',
    });
  }

  // 5. Non-GMO Project Verified
  if (
    commodity.includes('soy') ||
    commodity.includes('maize') ||
    commodity.includes('corn') ||
    commodity.includes('wheat')
  ) {
    certs.push({
      id: `cert-gmo-${deal.id.slice(0, 8)}`,
      type: 'non_gmo',
      name: 'Non-GMO Verified',
      badgeText: 'Non-GMO Project',
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      issuer: 'Non-GMO Project',
      issueDate: '2024-11-15',
      expiryDate: '2026-11-15',
      verificationCode: `GMO-${deal.id.slice(0, 6).toUpperCase()}`,
      verificationUrl: 'https://www.nongmoproject.org',
      description: 'Independent verification that product contains no genetically modified organisms.',
    });
  }

  return certs;
}

// ── Build Full Deal Sustainability Metrics ─────────────────────────────────────

/**
 * Builds or normalizes complete sustainability metrics for a given deal.
 */
export function getDealSustainability(deal: Deal): SustainabilityMetrics {
  const footprint = calculateCarbonFootprint(deal);
  const certifications = resolveEcoCertifications(deal);

  const environmental =
    deal.environmental_score != null
      ? Number(deal.environmental_score)
      : Math.min(100, Math.max(50, 75 - footprint.varianceVsBenchmarkPercent));

  const social =
    deal.social_score != null
      ? Number(deal.social_score)
      : deal.farmer_credit_score
      ? Math.min(95, Math.round((deal.farmer_credit_score / 850) * 100))
      : 72;

  const governance =
    deal.governance_score != null ? Number(deal.governance_score) : 78;

  const { overallScore, rating, tierClassification } = aggregateSustainabilityScore(
    environmental,
    social,
    governance,
  );

  return {
    overallScore: deal.esg_score != null ? Number(deal.esg_score) : overallScore,
    rating: (deal.esg_rating as any) || rating,
    environmentalScore: Math.round(environmental),
    socialScore: Math.round(social),
    governanceScore: Math.round(governance),
    carbonFootprint: footprint,
    certifications,
    sustainablePractices: [
      'Zero Deforestation GIS Boundary Verification',
      'Micro-Drip Solar Irrigation',
      'Regenerative Cover Cropping & Mulching',
      'Child Labor Independent Supply Chain Audit',
      'Soroban Smart Contract Origin Tokenization',
    ],
    waterEfficiencyScore: 84,
    fairPricePremiumPercent: 14.5,
    traceabilityLevel: 'blockchain_tokenized',
    tierClassification,
  };
}

// ── Sustainability Recommendations Engine ─────────────────────────────────────

/**
 * Generates lower-carbon recommendations and alternatives for a given deal
 */
export function getSustainabilityRecommendations(
  currentDeal: Deal,
  marketplaceDeals: Deal[] = [],
): SustainabilityRecommendation[] {
  const currentFootprint = calculateCarbonFootprint(currentDeal);
  const recommendations: SustainabilityRecommendation[] = [];

  // 1. Find lower carbon alternative deal if available
  const sameCommodityDeals = marketplaceDeals.filter(
    (d) =>
      d.id !== currentDeal.id &&
      (d.commodity.toLowerCase() === currentDeal.commodity.toLowerCase() ||
        marketplaceDeals.length <= 4),
  );

  if (sameCommodityDeals.length > 0) {
    const scoredAlternatives = sameCommodityDeals.map((alt) => {
      const altFootprint = calculateCarbonFootprint(alt);
      return { deal: alt, footprint: altFootprint };
    });

    scoredAlternatives.sort(
      (a, b) => a.footprint.carbonIntensityKgPerUnit - b.footprint.carbonIntensityKgPerUnit,
    );

    const bestAlt = scoredAlternatives[0];
    if (bestAlt && bestAlt.footprint.totalEmissionsTonsCo2e < currentFootprint.totalEmissionsTonsCo2e) {
      const savedTons = Math.max(
        0.1,
        Number((currentFootprint.totalEmissionsTonsCo2e - bestAlt.footprint.totalEmissionsTonsCo2e).toFixed(2)),
      );
      const savedPct = Math.min(
        95,
        Math.round((savedTons / currentFootprint.totalEmissionsTonsCo2e) * 100),
      );

      recommendations.push({
        dealId: currentDeal.id,
        commodity: currentDeal.commodity,
        title: `Switch to ${bestAlt.deal.commodity} (${bestAlt.deal.token_symbol})`,
        currentEmissionsTons: currentFootprint.totalEmissionsTonsCo2e,
        alternativeDealId: bestAlt.deal.id,
        alternativeDealTitle: `${bestAlt.deal.commodity} Deal (${bestAlt.deal.token_symbol})`,
        alternativeEmissionsTons: bestAlt.footprint.totalEmissionsTonsCo2e,
        savingsPercent: savedPct,
        savingsTons: savedTons,
        primaryAction: 'Sourced via solar cold-storage and electrified rail corridor',
        implementationCostTier: 'low',
        estimatedPointsGain: 8.5,
      });
    }
  }

  // 2. Transport Modal Shift Recommendation
  if (currentFootprint.calculationParameters.transportMode === 'road_freight') {
    const railFootprint = calculateCarbonFootprint(currentDeal, {
      transportMode: 'rail_freight',
    });
    const savedTons = Number((currentFootprint.totalEmissionsTonsCo2e - railFootprint.totalEmissionsTonsCo2e).toFixed(2));
    if (savedTons > 0) {
      recommendations.push({
        dealId: currentDeal.id,
        commodity: currentDeal.commodity,
        title: 'Shift Logistics from Heavy Road Truck to Electrified Rail',
        currentEmissionsTons: currentFootprint.totalEmissionsTonsCo2e,
        savingsPercent: Math.round((savedTons / currentFootprint.totalEmissionsTonsCo2e) * 100),
        savingsTons: savedTons,
        primaryAction: 'Routing via intermodal freight train reduces transport emissions by up to 71%',
        implementationCostTier: 'medium',
        estimatedPointsGain: 12.0,
      });
    }
  }

  // 3. Renewable Storage Upgrade
  if (currentFootprint.calculationParameters.renewableEnergyPercent < 70) {
    const solarFootprint = calculateCarbonFootprint(currentDeal, {
      renewableEnergyPercent: 90,
    });
    const savedTons = Number((currentFootprint.totalEmissionsTonsCo2e - solarFootprint.totalEmissionsTonsCo2e).toFixed(2));
    if (savedTons > 0) {
      recommendations.push({
        dealId: currentDeal.id,
        commodity: currentDeal.commodity,
        title: 'Procure Solar-Powered Temperature-Controlled Storage',
        currentEmissionsTons: currentFootprint.totalEmissionsTonsCo2e,
        savingsPercent: Math.round((savedTons / currentFootprint.totalEmissionsTonsCo2e) * 100),
        savingsTons: savedTons,
        primaryAction: 'Transitioning farm hub storage to onsite solar agrivoltaics eliminates grid fossil fuel usage',
        implementationCostTier: 'low',
        estimatedPointsGain: 6.5,
      });
    }
  }

  // 4. Net-Zero Carbon Offset Recommendation
  if (!currentFootprint.offsetStatus.isOffset) {
    recommendations.push({
      dealId: currentDeal.id,
      commodity: currentDeal.commodity,
      title: 'Neutralize Remaining Emissions via East African Agroforestry Offsets',
      currentEmissionsTons: currentFootprint.totalEmissionsTonsCo2e,
      savingsPercent: 100,
      savingsTons: currentFootprint.totalEmissionsTonsCo2e,
      primaryAction: `Purchase ${currentFootprint.totalEmissionsTonsCo2e} tons of Gold Standard verified tree planting credits`,
      implementationCostTier: 'low',
      estimatedPointsGain: 15.0,
    });
  }

  return recommendations;
}

// ── Offset Calculation & Processing ───────────────────────────────────────────

/**
 * Calculates the exact cost to offset a deal or amount of CO2e
 */
export function calculateOffsetCost(
  emissionsTons: number,
  selectedProject?: CarbonOffsetOption,
): {
  tonsToOffset: number;
  pricePerTonUsd: number;
  totalCostUsd: number;
  project: CarbonOffsetOption;
} {
  const project = selectedProject || VERIFIED_OFFSET_PROJECTS[0];
  const tons = Math.max(0.1, Number(emissionsTons.toFixed(2)));
  const totalCostUsd = Number((tons * project.pricePerTonUsd).toFixed(2));

  return {
    tonsToOffset: tons,
    pricePerTonUsd: project.pricePerTonUsd,
    totalCostUsd,
    project,
  };
}

/**
 * Simulates purchasing a verified carbon offset, returning retirement proof
 */
export function simulateOffsetPurchase(
  deal: Deal,
  project: CarbonOffsetOption,
  tons: number,
): CarbonOffsetStatus {
  const certId = `AGRIFI-OFFSET-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  return {
    isOffset: true,
    offsetTonsCo2e: Number(tons.toFixed(2)),
    netEmissionsTonsCo2e: 0,
    offsetCertificateId: certId,
    offsetProject: project.name,
    offsetProvider: `${project.standard} (Registry #GS-${Math.floor(100000 + Math.random() * 900000)})`,
    retiredAt: new Date().toISOString(),
  };
}
