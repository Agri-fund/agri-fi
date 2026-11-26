export interface CarbonFootprint {
  transportation: number;
  storage: number;
  processing: number;
  total: number;
  unit: 'kg' | 'tons';
}

export interface EcoCertification {
  id: string;
  name: string;
  issuer: string;
  issuedDate: string;
  expiryDate?: string;
  verificationUrl?: string;
}

export interface SustainabilityMetrics {
  carbonFootprint: CarbonFootprint;
  certifications: EcoCertification[];
  sustainabilityScore: number; // 0-100
  esgCompliant: boolean;
}

export interface DealWithSustainability {
  dealId: string;
  sustainabilityMetrics?: SustainabilityMetrics;
}
