import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { getRepositoryToken } from '@nestjs/typeorm';
import { of } from 'rxjs';
import { DealFundingAlertService } from './deal-funding-alert.service';
import { TradeDeal } from './entities/trade-deal.entity';

const mockRepo = () => ({
  find: jest.fn(),
});

const mockHttpService = () => ({
  post: jest.fn().mockReturnValue(of({ data: {} })),
});

const mockConfigService = (overrides: Record<string, string> = {}) => ({
  get: jest.fn(
    (key: string, defaultVal?: string) => overrides[key] ?? defaultVal,
  ),
});

function buildDeal(overrides: Partial<TradeDeal> = {}): TradeDeal {
  return {
    id: 'deal-uuid-1',
    commodity: 'Cocoa',
    tokenSymbol: 'COC001',
    totalValue: 10_000,
    totalInvested: 0,
    status: 'open',
    ...overrides,
  } as unknown as TradeDeal;
}

describe('DealFundingAlertService', () => {
  let service: DealFundingAlertService;
  let repo: ReturnType<typeof mockRepo>;
  let httpService: ReturnType<typeof mockHttpService>;

  beforeEach(async () => {
    repo = mockRepo();
    httpService = mockHttpService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealFundingAlertService,
        { provide: getRepositoryToken(TradeDeal), useValue: repo },
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: mockConfigService({
            SLACK_WEBHOOK_URL: 'https://hooks.slack.com/test',
          }),
        },
      ],
    }).compile();

    service = module.get<DealFundingAlertService>(DealFundingAlertService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('evaluateDeal', () => {
    it('does not fire an alert when progress is below 50%', async () => {
      const deal = buildDeal({ totalInvested: 4_999 });
      await service.evaluateDeal(deal);
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('fires a 50% alert when funded exactly at 50%', async () => {
      const deal = buildDeal({ totalInvested: 5_000 });
      await service.evaluateDeal(deal);
      expect(httpService.post).toHaveBeenCalledTimes(1);
      const [, payload] = httpService.post.mock.calls[0];
      expect(payload.content).toContain('50% funded');
    });

    it('fires both 50% and 100% alerts when fully funded', async () => {
      const deal = buildDeal({ totalInvested: 10_000 });
      await service.evaluateDeal(deal);
      // Two milestones: 50 and 100
      expect(httpService.post).toHaveBeenCalledTimes(2);
    });

    it('does not re-fire the same milestone alert for the same deal', async () => {
      const deal = buildDeal({ totalInvested: 5_000 });
      await service.evaluateDeal(deal);
      await service.evaluateDeal(deal); // second call — should not re-fire
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('skips webhook post when no webhook URL is configured', async () => {
      const noWebhookModule = await Test.createTestingModule({
        providers: [
          DealFundingAlertService,
          { provide: getRepositoryToken(TradeDeal), useValue: mockRepo() },
          { provide: HttpService, useValue: httpService },
          {
            provide: ConfigService,
            useValue: mockConfigService({}), // no URL
          },
        ],
      }).compile();

      const svcNoUrl = noWebhookModule.get<DealFundingAlertService>(
        DealFundingAlertService,
      );
      await svcNoUrl.evaluateDeal(buildDeal({ totalInvested: 5_000 }));
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('does not throw when totalValue is 0', async () => {
      const deal = buildDeal({ totalValue: 0, totalInvested: 0 });
      await expect(service.evaluateDeal(deal)).resolves.not.toThrow();
    });
  });

  describe('checkFundingMilestones (cron)', () => {
    it('evaluates all open and funded deals', async () => {
      const deals = [
        buildDeal({ status: 'open', totalInvested: 5_000 }),
        buildDeal({
          id: 'deal-uuid-2',
          tokenSymbol: 'COF002',
          status: 'funded',
          totalInvested: 10_000,
        }),
      ];
      repo.find.mockResolvedValue(deals);

      await service.checkFundingMilestones();
      // deal 1 → 50% alert; deal 2 → 50% + 100% alerts = 3 total
      expect(httpService.post).toHaveBeenCalledTimes(3);
    });
  });
});
