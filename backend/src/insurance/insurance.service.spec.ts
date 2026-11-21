import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { StellarService } from '../stellar/stellar.service';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { InsuranceService } from './insurance.service';

describe('InsuranceService.compareQuotes', () => {
  let service: InsuranceService;
  let quoteRepo: { create: jest.Mock; save: jest.Mock };
  let post: jest.SpyInstance;

  const user = { id: 'user-1', role: 'admin' } as User;
  const deal = {
    id: 'deal-1',
    commodity: 'Maize',
    quantity: 100,
    quantityUnit: 'tons',
    totalValue: 10000,
    durationDays: 90,
    riskScore: 40,
    farmLocation: 'Kano',
  } as unknown as TradeDeal;

  const providers = [
    {
      id: 'p1',
      name: 'Provider One',
      baseUrl: 'https://p1.example.com',
      apiKey: 'key-1',
      webhookSecret: 'secret-1',
    },
    {
      id: 'p2',
      name: 'Provider Two',
      baseUrl: 'https://p2.example.com',
      apiKey: 'key-2',
      webhookSecret: 'secret-2',
    },
  ];

  const providerQuote = (quoteId: string, premium: number) => ({
    quote_id: quoteId,
    premium,
    coverage_amount: 10000,
    currency: 'USD',
    terms: { deductible: 5 },
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });

  const dto = { coverageType: 'crop_failure' } as any;

  beforeEach(() => {
    quoteRepo = {
      create: jest.fn().mockImplementation((q) => q),
      save: jest
        .fn()
        .mockImplementation(async (q) => ({
          id: `quote-${q.providerQuoteId}`,
          ...q,
        })),
    };
    const config = {
      get: jest.fn((key: string, def?: string) =>
        key === 'INSURANCE_PROVIDERS' ? JSON.stringify(providers) : def,
      ),
    };

    service = new InsuranceService(
      {} as any,
      {} as any,
      quoteRepo as any,
      {} as any,
      {} as any,
      {} as unknown as HttpService,
      config as unknown as ConfigService,
      {} as unknown as StellarService,
    );

    jest.spyOn(service as any, 'getAuthorizedDeal').mockResolvedValue(deal);
    post = jest.spyOn(service as any, 'post');
  });

  it('returns quotes from every provider when all succeed', async () => {
    post
      .mockResolvedValueOnce(providerQuote('q-1', 100))
      .mockResolvedValueOnce(providerQuote('q-2', 200));

    const result = await service.compareQuotes(user, 'deal-1', dto);

    expect(result.quotes).toHaveLength(2);
    expect(result.unavailableProviders).toEqual([]);
  });

  it('still returns the working provider quotes when one provider fails', async () => {
    post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(providerQuote('q-2', 200));

    const result = await service.compareQuotes(user, 'deal-1', dto);

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].providerId).toBe('p2');
    expect(result.unavailableProviders).toEqual([
      { id: 'p1', name: 'Provider One' },
    ]);
  });

  it('does not abort other quotes when a provider callback itself rejects', async () => {
    post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(providerQuote('q-2', 200));
    // Simulate a failure escaping the per-provider catch block (the logger
    // throwing), which previously rejected the whole Promise.all.
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementationOnce(() => {
        throw new Error('logger failure');
      });

    const result = await service.compareQuotes(user, 'deal-1', dto);

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].providerId).toBe('p2');
    expect(result.unavailableProviders).toEqual([
      { id: 'p1', name: 'Provider One' },
    ]);
  });

  it('throws ServiceUnavailableException when every provider fails', async () => {
    post.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      service.compareQuotes(user, 'deal-1', dto),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
