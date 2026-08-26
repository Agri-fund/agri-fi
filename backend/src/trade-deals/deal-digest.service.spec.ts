import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DealDigestService } from './deal-digest.service';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { Document } from './entities/document.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-template.service';
import { RedisConfig } from '../config/redis.config';

/**
 * Unit tests for #892 — weekly farmer deal digest:
 * digest data generation, opt-out/skip rules, timezone scheduling
 * (UTC+0 / UTC+3 / UTC+8) and per-ISO-week dedupe.
 */
describe('DealDigestService (#892)', () => {
  let service: DealDigestService;
  let userRepo: Record<string, jest.Mock>;
  let tradeDealRepo: Record<string, jest.Mock>;
  let investmentRepo: Record<string, jest.Mock>;
  let documentRepo: Record<string, jest.Mock>;
  let notificationsService: Record<string, jest.Mock>;
  let emailTemplates: Record<string, jest.Mock>;

  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'farmer-1',
      email: 'farmer@example.com',
      fullName: 'Amina Farmer',
      role: 'farmer',
      preferredLanguage: 'en',
      timezone: 'UTC',
      emailDigestEnabled: true,
      ...overrides,
    }) as unknown as User;

  const buildDeal = (overrides: Partial<TradeDeal> = {}): TradeDeal =>
    ({
      id: 'deal-1',
      commodity: 'Cocoa',
      tokenSymbol: 'COCOA1',
      status: 'open',
      totalValue: 10_000,
      totalInvested: 5_000,
      deliveryDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      ...overrides,
    }) as unknown as TradeDeal;

  beforeEach(async () => {
    userRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    tradeDealRepo = { find: jest.fn().mockResolvedValue([]) };
    investmentRepo = { find: jest.fn().mockResolvedValue([]) };
    documentRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    emailTemplates = {
      render: jest.fn().mockReturnValue({
        subject: 'Your weekly deal digest',
        html: '<p>digest</p>',
        text: 'digest',
      }),
      getSectionHeadings: jest.fn().mockReturnValue({
        deals: 'Funding progress',
        milestones: 'Upcoming milestones this week',
        documents: 'Documents awaiting submission',
        actions: 'Action items',
        unsubscribe: 'Unsubscribe from these emails',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealDigestService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        { provide: getRepositoryToken(Document), useValue: documentRepo },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: EmailTemplateService, useValue: emailTemplates },
        { provide: RedisConfig, useValue: { createClient: () => null } },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              key === 'APP_BASE_URL' ? 'https://app.test' : def,
          },
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DealDigestService>(DealDigestService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('generateForFarmer', () => {
    it('returns null when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.generateForFarmer('ghost')).resolves.toBeNull();
    });

    it('returns null when the farmer opted out of digests', async () => {
      userRepo.findOne.mockResolvedValue(buildUser({ emailDigestEnabled: false }));
      await expect(service.generateForFarmer('farmer-1')).resolves.toBeNull();
    });

    it('returns null when there are no active deals', async () => {
      userRepo.findOne.mockResolvedValue(buildUser());
      tradeDealRepo.find.mockResolvedValue([]);
      await expect(service.generateForFarmer('farmer-1')).resolves.toBeNull();
    });

    it('builds funding, milestones, documents and action sections', async () => {
      const now = Date.now();
      userRepo.findOne.mockResolvedValue(buildUser());
      tradeDealRepo.find.mockResolvedValue([
        buildDeal({ totalInvested: 7_500 }), // 75% funded, delivery in 3 days
        buildDeal({ id: 'deal-2', commodity: 'Coffee' }), // no docs yet
      ]);
      investmentRepo.find.mockResolvedValue([
        { amountUsd: 500, createdAt: new Date(now - 2 * 86_400_000), investor: {} },
      ] as any[]);
      documentRepo.find.mockResolvedValue([{ tradeDealId: 'deal-1' }]); // deal-2 missing docs

      const rendered = await service.generateForFarmer('farmer-1');

      expect(rendered).toEqual({
        subject: 'Your weekly deal digest',
        html: '<p>digest</p>',
        text: 'digest',
      });

      const [templateName, vars, locale] = emailTemplates.render.mock.calls[0];
      expect(templateName).toBe('deal-digest');
      expect(locale).toBe('en');
      expect(vars).toMatchObject({
        farmerName: 'Amina Farmer',
        newInvestorCount: '1',
      });
      // SVG bar chart + raw section fragments are present
      expect(String(vars.chartSvg)).toContain('<svg');
      expect(String(vars.dealsHtml)).toContain('Cocoa');
      expect(String(vars.documentsHtml)).toContain('Coffee');
      expect(String(vars.unsubscribeUrl)).toMatch(
        /^https:\/\/app\.test\/users\/unsubscribe\?userId=farmer-1&token=[0-9a-f]{64}$/,
      );
    });

    it('renders in the farmer’s preferred language with localized headings', async () => {
      userRepo.findOne.mockResolvedValue(
        buildUser({ preferredLanguage: 'fr' }),
      );
      tradeDealRepo.find.mockResolvedValue([buildDeal()]);

      await service.generateForFarmer('farmer-1');

      const [, , locale] = emailTemplates.render.mock.calls[0];
      expect(locale).toBe('fr');
      expect(emailTemplates.getSectionHeadings).toHaveBeenCalledWith('fr');
    });
  });

  describe('runWeeklyDigest — timezone-aware Monday 07:00 scheduling', () => {
    const setNow = (iso: string) => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(iso));
    };

    const seedFarmer = (overrides: Partial<User> = {}) => {
      userRepo.find.mockResolvedValue([buildUser(overrides)]);
      userRepo.findOne.mockResolvedValue(buildUser(overrides));
      tradeDealRepo.find.mockResolvedValue([buildDeal()]);
    };

    it('sends when it is Monday 07:00 local time (UTC farmer)', async () => {
      // 2026-01-05 is a Monday; 07:30 UTC
      setNow('2026-01-05T07:30:00Z');
      seedFarmer({ timezone: 'UTC' });

      await service.runWeeklyDigest();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
      expect(notificationsService.sendEmail).toHaveBeenCalledWith(
        'farmer@example.com',
        'Your weekly deal digest',
        expect.any(String),
        expect.any(String),
      );
    });

    it('sends UTC+3 farmers at 04:00 UTC (their 07:00)', async () => {
      setNow('2026-01-05T04:30:00Z'); // 07:30 in Africa/Nairobi
      seedFarmer({ timezone: 'Africa/Nairobi' });

      await service.runWeeklyDigest();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('sends UTC+8 farmers at 23:00 UTC the day before (their Monday 07:00)', async () => {
      // Sunday 2026-01-04 23:00 UTC == Monday 07:00 Asia/Singapore
      setNow('2026-01-04T23:00:30Z');
      seedFarmer({ timezone: 'Asia/Singapore' });

      await service.runWeeklyDigest();

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not send outside the Monday-07:00 window', async () => {
      setNow('2026-01-06T07:30:00Z'); // Tuesday
      seedFarmer({ timezone: 'UTC' });

      await service.runWeeklyDigest();
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });

    it('does not send twice in the same ISO week (dedupe)', async () => {
      setNow('2026-01-05T07:30:00Z');
      seedFarmer({ timezone: 'UTC' });

      await service.runWeeklyDigest();
      await service.runWeeklyDigest(); // same week → deduped

      expect(notificationsService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('skips farmers who unsubscribed', async () => {
      setNow('2026-01-05T07:30:00Z');
      userRepo.find.mockResolvedValue([]); // scheduler query filters them out

      await service.runWeeklyDigest();
      expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('verifyUnsubscribeToken', () => {
    it('accepts a valid HMAC token and rejects a tampered one', () => {
      const url = service.unsubscribeUrl('farmer-1');
      const token = new URL(url).searchParams.get('token') as string;

      expect(service.verifyUnsubscribeToken('farmer-1', token)).toBe(true);
      expect(
        service.verifyUnsubscribeToken('farmer-1', `0${token.slice(1)}`),
      ).toBe(false);
      expect(
        service.verifyUnsubscribeToken('other-user', token),
      ).toBe(false);
    });
  });
});
