import { Test, TestingModule } from '@nestjs/testing';
import { PublicApiController } from './public-api.controller';
import { TradeDealsService } from '../trade-deals/trade-deals.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ApiKeyThrottlerGuard } from '../common/throttler/api-key-throttler.guard';

describe('PublicApiController (Issue #1014)', () => {
  let controller: PublicApiController;
  let tradeDealsService: any;
  let webhooksService: any;

  beforeEach(async () => {
    tradeDealsService = {
      searchDeals: jest.fn().mockResolvedValue({
        data: [{ id: 'deal-1', title: 'Coffee Harvest' }],
        total: 1,
      }),
      getDealById: jest.fn().mockResolvedValue({
        id: 'deal-1',
        title: 'Coffee Harvest',
        commodity: 'Coffee',
      }),
    };

    webhooksService = {
      createSubscription: jest.fn().mockResolvedValue({
        id: 'sub-1',
        url: 'https://example.com/webhook',
        events: ['deal.funded'],
        isActive: true,
      }),
      findAllSubscriptions: jest.fn().mockResolvedValue([
        {
          id: 'sub-1',
          url: 'https://example.com/webhook',
          events: ['deal.funded'],
          isActive: true,
        },
      ]),
      deleteSubscription: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicApiController],
      providers: [
        { provide: TradeDealsService, useValue: tradeDealsService },
        { provide: WebhooksService, useValue: webhooksService },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ApiKeyThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PublicApiController>(PublicApiController);
  });

  it('lists deals with pagination metadata', async () => {
    const result = await controller.listDeals({ limit: 10, offset: 0 });
    expect(result.object).toBe('list');
    expect(result.data).toHaveLength(1);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.hasMore).toBe(false);
  });

  it('retrieves single deal detail by ID', async () => {
    const deal = await controller.getDealDetail('deal-1');
    expect(deal.id).toBe('deal-1');
    expect(deal.commodity).toBe('Coffee');
  });

  it('creates a partner webhook subscription', async () => {
    const sub = await controller.subscribeWebhook({
      url: 'https://example.com/webhook',
      events: ['deal.funded'],
      secret: 'whsec_very_secret_token_123',
    });
    expect(sub.id).toBe('sub-1');
    expect(sub.url).toBe('https://example.com/webhook');
  });

  it('lists active webhook subscriptions', async () => {
    const subs = await controller.listWebhooks();
    expect(subs.object).toBe('list');
    expect(subs.data).toHaveLength(1);
  });

  it('deletes a webhook subscription', async () => {
    await controller.deleteWebhook('sub-1');
    expect(webhooksService.deleteSubscription).toHaveBeenCalledWith('sub-1');
  });
});
