import { SustainabilityMetrics, CarbonFootprint } from '@/types/sustainability';

export class SustainabilityService {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async saveCarbonFootprint(
    dealId: string,
    footprint: CarbonFootprint
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/deals/${dealId}/carbon-footprint`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(footprint),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to save carbon footprint');
    }
  }

  async getSustainabilityMetrics(
    dealId: string
  ): Promise<SustainabilityMetrics> {
    const response = await fetch(
      `${this.baseUrl}/deals/${dealId}/sustainability`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch sustainability metrics');
    }

    return response.json();
  }

  async getESGCompliantDeals(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/deals/esg-compliant`);

    if (!response.ok) {
      throw new Error('Failed to fetch ESG compliant deals');
    }

    return response.json();
  }
}

export const sustainabilityService = new SustainabilityService();
