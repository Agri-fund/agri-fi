import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { createHmac } from 'crypto';
import { WebhooksService } from './webhooks.service';
import { WebhookSubscription } from './entities/webhook-subscription.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let httpService: jest.Mocked<HttpService>;
  let repo: any;

  const mockSubscription: WebhookSubscription = {
    id: 'sub-uuid-1',
    url: 'https://example.com/webhook',
    secret: 'supersecretkey123',
    events: ['deal.funding_progress'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockDeal: Partial<TradeDeal> = {
    id: 'deal-uuid-1',
    tokenSymbol: 'MAIZE',
    commodity: 'Maize',
    totalValue: 10000 as any,
    totalInvested: 2500 as any,
    status: 'open',
  };

  beforeEach(async () => {
    repo = {
      create: jest
        .fn()
        .mockImplementation((dto) => ({ ...dto, id: 'sub-uuid-1' })),
      save: jest.fn().mockImplementation((sub) => Promise.resolve(sub)),
      find: jest.fn().mockResolvedValue([mockSubscription]),
      findOne: jest.fn().mockResolvedValue(mockSubscription),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const mockHttpService = {
      post: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        {
          provide: getRepositoryToken(WebhookSubscription),
          useValue: repo,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    httpService = module.get(HttpService);
  });

  describe('HMAC-SHA256 Signing', () => {
    it('should generate valid HMAC-SHA256 signature matching WebhookSignatureGuard pattern', () => {
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'supersecretkey123';
      const expectedSignature = createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const signature = service.generateSignature(payload, secret);
      expect(signature).toBe(expectedSignature);
    });
  });

  describe('Webhook Delivery & Retries', () => {
    it('should deliver webhook with x-webhook-signature header on 200 response', async () => {
      httpService.post.mockReturnValue(of({ status: 200, data: {} } as any));

      const payloadString = JSON.stringify({ event: 'deal.funding_progress' });
      const result = await service.sendPayloadWithRetry(
        mockSubscription,
        payloadString,
      );

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(1);

      const expectedSig = service.generateSignature(
        payloadString,
        mockSubscription.secret,
      );
      expect(httpService.post).toHaveBeenCalledWith(
        mockSubscription.url,
        payloadString,
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-webhook-signature': expectedSig,
          }),
        }),
      );
    });

    it('should retry with exponential back-off on non-2xx response and succeed', async () => {
      httpService.post
        .mockReturnValueOnce(throwError(() => ({ response: { status: 500 } })))
        .mockReturnValueOnce(of({ status: 200, data: {} } as any));

      const payloadString = JSON.stringify({ event: 'deal.funding_progress' });
      const result = await service.sendPayloadWithRetry(
        mockSubscription,
        payloadString,
        3,
      );

      expect(result).toBe(true);
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it('should return false after max attempts fail', async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ response: { status: 502 } })),
      );

      const payloadString = JSON.stringify({ event: 'deal.funding_progress' });
      const result = await service.sendPayloadWithRetry(
        mockSubscription,
        payloadString,
        3,
      );

      expect(result).toBe(false);
      expect(httpService.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('dispatchFundingProgress', () => {
    it('should dispatch event when deal crosses funding threshold', async () => {
      httpService.post.mockReturnValue(of({ status: 200, data: {} } as any));

      await service.dispatchFundingProgress(mockDeal as TradeDeal, 25, 25.0);

      expect(httpService.post).toHaveBeenCalled();
    });
  });
});
