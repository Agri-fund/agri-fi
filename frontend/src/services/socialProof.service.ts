import { InvestorTestimonial, SocialProofData } from '@/types/socialProof';

export class SocialProofService {
  private baseUrl: string;

  constructor(baseUrl: string = '/api') {
    this.baseUrl = baseUrl;
  }

  async submitTestimonial(
    testimonial: Omit<InvestorTestimonial, 'id' | 'createdAt' | 'verified'>
  ): Promise<InvestorTestimonial> {
    const response = await fetch(`${this.baseUrl}/testimonials`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testimonial),
    });

    if (!response.ok) {
      throw new Error('Failed to submit testimonial');
    }

    return response.json();
  }

  async getSocialProofData(dealId?: string): Promise<SocialProofData> {
    const url = dealId
      ? `${this.baseUrl}/social-proof?dealId=${dealId}`
      : `${this.baseUrl}/social-proof`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error('Failed to fetch social proof data');
    }

    return response.json();
  }

  async rateDeal(
    dealId: string,
    rating: number,
    comment?: string
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/deals/${dealId}/rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating, comment }),
    });

    if (!response.ok) {
      throw new Error('Failed to rate deal');
    }
  }
}

export const socialProofService = new SocialProofService();
