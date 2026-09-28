import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { SecurityThreatService } from './security-threat.service';
import { SecurityIpBlock } from '../database/entities/security-ip-block.entity';
import { QueueService } from '../queue/queue.service';
import { RedisConfig } from '../config/redis.config';

/**
 * Unit tests for #898 — credential-stuffing / rate-limit-bypass detection.
 * Threshold boundaries are exercised explicitly: exactly-at-threshold must
 * never trigger; one past the threshold must.
 */
describe('SecurityThreatService (#898)', () => {
  let service: SecurityThreatService;
  let redis: Record<string, jest.Mock>;
  let blockRepo: Record<string, jest.Mock>;
  let queueService: Record<string, jest.Mock>;

  const makeService = async (
    configOverrides: Record<string, unknown> = {},
    redisOverrides: Record<string, jest.Mock> = {},
  ): Promise<SecurityThreatService> => {
    const baseRedis: Record<string, jest.Mock> = {
      isOpen: true,
      connect: jest.fn(),
      quit: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'), // NX escalation claims succeed
      setEx: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
      sAdd: jest.fn(),
      sRem: jest.fn(),
      sMembers: jest.fn().mockResolvedValue([]),
      sCard: jest.fn().mockResolvedValue(0),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
      del: jest.fn(),
      ...redisOverrides,
    };
    redis = baseRedis;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityThreatService,
        {
          provide: RedisConfig,
          useValue: { createClient: () => baseRedis },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) =>
              key in configOverrides ? configOverrides[key] : def,
          },
        },
        { provide: getRepositoryToken(SecurityIpBlock), useValue: blockRepo },
        { provide: QueueService, useValue: queueService },
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

    const svc = module.get<SecurityThreatService>(SecurityThreatService);
    await svc.onModuleInit(); // wires the Redis client + re-seeds deny list
    return svc;
  };

  beforeEach(() => {
    blockRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((_e, data) => data ?? _e),
      save: jest.fn(async (r: any) => r),
    };
    queueService = { emit: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('checkLogin', () => {
    it('allows a clean login attempt', async () => {
      service = await makeService();
      const verdict = await service.checkLogin('user@example.com', '1.2.3.4');
      expect(verdict.action).toBe('allow');
      expect(verdict.captchaRequired).toBe(false);
    });

    it('blocks IPs inside configured threat-feed ranges immediately', async () => {
      service = await makeService({
        SECURITY_BAD_IP_RANGES: '203.0.113.0/24,198.51.100.0/16',
      });
      const verdict = await service.checkLogin(
        'user@example.com',
        '203.0.113.9',
      );
      expect(verdict.action).toBe('blocked');
      expect(verdict.reasons).toContain('bad_ip_range');
    });

    it('does not block IPs outside the configured ranges', async () => {
      service = await makeService({
        SECURITY_BAD_IP_RANGES: '203.0.113.0/24',
      });
      const verdict = await service.checkLogin('user@example.com', '8.8.8.8');
      expect(verdict.action).toBe('allow');
    });

    it('blocks IPs inside an approved /16 subnet block', async () => {
      service = await makeService(
        {},
        {
          sMembers: jest.fn().mockResolvedValue(['198.51.100.0/16']),
        },
      );
      const verdict = await service.checkLogin(
        'user@example.com',
        '198.51.100.7',
      );
      expect(verdict.action).toBe('blocked');
      expect(verdict.reasons).toContain('subnet_blocked');
    });

    it('blocks when the global per-email rate limit is active', async () => {
      service = await makeService(
        {},
        {
          exists: jest
            .fn()
            .mockImplementation((key: string) =>
              Promise.resolve(
                key === 'sec:ratelimit:victim@example.com' ? 1 : 0,
              ),
            ),
        },
      );
      const verdict = await service.checkLogin('VICTIM@example.com', '1.2.3.4');
      expect(verdict.action).toBe('blocked');
      expect(verdict.reasons).toContain('email_rate_limited');
    });

    it('demands CAPTCHA when flagged for this email', async () => {
      service = await makeService(
        {},
        {
          exists: jest
            .fn()
            .mockImplementation((key: string) =>
              Promise.resolve(key.startsWith('sec:captcha:') ? 1 : 0),
            ),
        },
      );
      const verdict = await service.checkLogin('victim@example.com', '1.2.3.4');
      expect(verdict.action).toBe('captcha');
      expect(verdict.captchaRequired).toBe(true);
    });
  });

  describe('recordFailedLogin — distinct-IP-per-email signal', () => {
    it.each([9, 10])(
      'does not escalate at %j distinct IPs (at/below threshold)',
      async (count) => {
        service = await makeService(
          {},
          {
            sCard: jest.fn().mockResolvedValue(count),
          },
        );
        await service.recordFailedLogin(
          'victim@example.com',
          `10.0.0.${count}`,
        );
        expect(redis.setEx).not.toHaveBeenCalled();
        expect(blockRepo.save).not.toHaveBeenCalled();
      },
    );

    it('escalates at more than 10 distinct IPs: rate limit + CAPTCHA + alert', async () => {
      service = await makeService(
        {},
        {
          sCard: jest.fn().mockResolvedValue(11),
        },
      );
      await service.recordFailedLogin('victim@example.com', '10.0.0.11');

      expect(redis.setEx).toHaveBeenCalledWith(
        'sec:ratelimit:victim@example.com',
        3600,
        '1',
      );
      expect(redis.setEx).toHaveBeenCalledWith(
        'sec:captcha:victim@example.com',
        1800,
        '1',
      );

      const savedTypes = blockRepo.save.mock.calls.map(
        ([row]: any[]) => row.type,
      );
      expect(savedTypes).toEqual(
        expect.arrayContaining(['email_ratelimit', 'captcha_email']),
      );
      expect(queueService.emit).toHaveBeenCalledWith(
        'admin.alert',
        expect.objectContaining({ type: 'security_threat' }),
      );
    });

    it('escalates a targeted email only once per window', async () => {
      service = await makeService(
        {},
        {
          sCard: jest.fn().mockResolvedValue(12),
          // Second NX claim fails → escalation already ran
          set: jest
            .fn()
            .mockResolvedValueOnce('OK')
            .mockResolvedValueOnce(null),
        },
      );
      await service.recordFailedLogin('victim@example.com', '10.0.0.1');
      const firstCallCount = redis.setEx.mock.calls.length;
      expect(firstCallCount).toBeGreaterThan(0);

      await service.recordFailedLogin('victim@example.com', '10.0.0.2');
      expect(redis.setEx).toHaveBeenCalledTimes(firstCallCount); // unchanged
    });
  });

  describe('recordFailedLogin — /16 subnet signal', () => {
    const ip = '203.0.113.5';
    const subnetKey = 'sec:fail:subnet:203.0.113.0/16';

    it('does not propose a block below 50 failures in 10 minutes', async () => {
      service = await makeService(
        {},
        {
          incr: jest.fn().mockResolvedValue(49),
        },
      );
      await service.recordFailedLogin('a@example.com', ip);
      expect(blockRepo.save).not.toHaveBeenCalled();
      expect(queueService.emit).not.toHaveBeenCalledWith(
        'admin.alert',
        expect.objectContaining({ failedLogins: expect.anything() }),
      );
    });

    it('proposes a pending subnet block exactly at 50 failures', async () => {
      service = await makeService(
        {},
        {
          incr: jest.fn().mockResolvedValue(50),
        },
      );
      await service.recordFailedLogin('a@example.com', ip);

      expect(blockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'subnet_pending',
          cidr: '203.0.113.0/16',
          reason: 'credential_stuffing',
        }),
      );
      expect(queueService.emit).toHaveBeenCalledWith(
        'admin.alert',
        expect.objectContaining({
          subject: 'Credential stuffing from single subnet',
        }),
      );
      void subnetKey;
    });

    it('never proposes a duplicate block for an already-known subnet', async () => {
      blockRepo.findOne.mockResolvedValue({
        id: 'existing',
        type: 'subnet_pending',
      });
      service = await makeService(
        {},
        {
          incr: jest.fn().mockResolvedValue(77),
        },
      );
      await service.recordFailedLogin('a@example.com', ip);
      expect(blockRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('recordFailedLogin — geo anomaly signal', () => {
    it('requires CAPTCHA beyond 3 distinct countries within the hour', async () => {
      service = await makeService(
        {},
        {
          sCard: jest.fn().mockResolvedValue(4),
        },
      );
      await service.recordFailedLogin('traveler@example.com', '1.2.3.4', 'BR');

      expect(redis.setEx).toHaveBeenCalledWith(
        'sec:captcha:traveler@example.com',
        1800,
        '1',
      );
      expect(blockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'captcha_email',
          reason: 'unusual_geo_distribution',
        }),
      );
    });

    it('ignores up to 3 distinct countries', async () => {
      service = await makeService(
        {},
        {
          sCard: jest.fn().mockResolvedValue(3),
        },
      );
      await service.recordFailedLogin('traveler@example.com', '1.2.3.4', 'KE');
      expect(redis.setEx).not.toHaveBeenCalled();
    });
  });

  describe('verifyCaptcha', () => {
    it('passes automatically when hCaptcha is not configured', async () => {
      service = await makeService();
      await expect(service.verifyCaptcha('tok')).resolves.toBe(true);
    });

    it('verifies tokens against the hCaptcha siteverify API', async () => {
      service = await makeService({ HCAPTCHA_SECRET_KEY: '0xSecret' });

      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ json: async () => ({ success: true }) } as any);
      await expect(service.verifyCaptcha('good-token')).resolves.toBe(true);

      fetchMock.mockResolvedValue({
        json: async () => ({ success: false }),
      } as any);
      await expect(service.verifyCaptcha('bad-token')).resolves.toBe(false);

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.hcaptcha.com/siteverify');
    });
  });

  describe('admin lifecycle', () => {
    beforeEach(async () => {
      service = await makeService();
    });

    it('approves a pending subnet block and enforces it in Redis', async () => {
      blockRepo.findOne.mockResolvedValue({
        id: 'b1',
        type: 'subnet_pending',
        cidr: '203.0.113.0/16',
      });

      const saved = await service.approveBlock('b1', 'admin-1');

      expect(saved.type).toBe('subnet_active');
      expect(saved.approvedBy).toBe('admin-1');
      expect(redis.sAdd).toHaveBeenCalledWith(
        'sec:deny:subnets',
        '203.0.113.0/16',
      );
    });

    it('rejects approving non-pending blocks', async () => {
      blockRepo.findOne.mockResolvedValue({ id: 'b2', type: 'captcha_email' });
      await expect(service.approveBlock('b2', 'admin-1')).rejects.toThrow(
        /pending/i,
      );
    });

    it('lifts a captcha block and clears its Redis key', async () => {
      blockRepo.findOne.mockResolvedValue({
        id: 'b3',
        type: 'captcha_email',
        cidr: 'victim@example.com',
      });

      const saved = await service.liftBlock('b3');
      expect(saved.active).toBe(false);
      expect(redis.del).toHaveBeenCalledWith('sec:captcha:victim@example.com');
    });

    it('lifts an active subnet block and removes it from the deny set', async () => {
      blockRepo.findOne.mockResolvedValue({
        id: 'b4',
        type: 'subnet_active',
        cidr: '203.0.113.0/16',
      });

      await service.liftBlock('b4');
      expect(redis.sRem).toHaveBeenCalledWith(
        'sec:deny:subnets',
        '203.0.113.0/16',
      );
    });
  });
});
