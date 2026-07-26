import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let redisClient: {
    connect: jest.Mock;
    quit: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    on: jest.Mock;
  };
  let config: { get: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(async () => {
    redisClient = {
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn().mockResolvedValue(1),
      on: jest.fn(),
    };

    // Patch createClient to return our fake client
    jest.resetModules();
    jest.mock('redis', () => ({
      createClient: jest.fn(() => redisClient),
    }));

    // Re-require after mock (note: for ts-jest this pattern works within the same describe)
    const { IdempotencyService: IS } = await import('./idempotency.service');

    config = { get: jest.fn() };
    config.get.mockImplementation((key: string, defaultVal?: string) => {
      if (key === 'REDIS_URL') return 'redis://localhost:6379';
      return defaultVal ?? '';
    });

    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new IS(config as any, logger as any);
    await service.onModuleInit();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  describe('buildKey', () => {
    it('builds a namespaced key', () => {
      expect(IdempotencyService.buildKey('deal.publish', 'uuid-1')).toBe(
        'idempotency:deal.publish:uuid-1',
      );
    });
  });

  describe('acquireLease', () => {
    it('acquires the lease when key does not exist', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.set.mockResolvedValue('OK');

      const result = await service.acquireLease('some-key');

      expect(result.acquired).toBe(true);
      expect(redisClient.set).toHaveBeenCalledWith('some-key', 'processing', {
        NX: true,
        EX: 300,
      });
    });

    it('returns not-acquired with status "done" when key is already done', async () => {
      redisClient.get.mockResolvedValue('done');

      const result = await service.acquireLease('some-key');

      expect(result.acquired).toBe(false);
      expect(result.status).toBe('done');
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('returns not-acquired with status "processing" when another consumer holds the lease', async () => {
      redisClient.get.mockResolvedValue('processing');

      const result = await service.acquireLease('some-key');

      expect(result.acquired).toBe(false);
      expect(result.status).toBe('processing');
      expect(redisClient.set).not.toHaveBeenCalled();
    });

    it('handles race condition — SET NX returns null', async () => {
      redisClient.get
        .mockResolvedValueOnce(null)      // first GET: key absent
        .mockResolvedValueOnce('processing'); // second GET: another consumer won
      redisClient.set.mockResolvedValue(null); // SET NX failed

      const result = await service.acquireLease('some-key');

      expect(result.acquired).toBe(false);
      expect(result.status).toBe('processing');
    });

    it('uses custom TTL when provided', async () => {
      redisClient.get.mockResolvedValue(null);
      redisClient.set.mockResolvedValue('OK');

      await service.acquireLease('ttl-key', 60);

      expect(redisClient.set).toHaveBeenCalledWith('ttl-key', 'processing', {
        NX: true,
        EX: 60,
      });
    });
  });

  describe('markDone', () => {
    it('sets key to "done" with persistence TTL', async () => {
      redisClient.set.mockResolvedValue('OK');

      await service.markDone('some-key');

      expect(redisClient.set).toHaveBeenCalledWith('some-key', 'done', {
        EX: 86_400,
      });
    });

    it('accepts a custom persistence TTL', async () => {
      redisClient.set.mockResolvedValue('OK');

      await service.markDone('some-key', 3600);

      expect(redisClient.set).toHaveBeenCalledWith('some-key', 'done', {
        EX: 3600,
      });
    });
  });

  describe('releaseLease', () => {
    it('deletes the key when still in processing state', async () => {
      redisClient.get.mockResolvedValue('processing');

      await service.releaseLease('some-key');

      expect(redisClient.del).toHaveBeenCalledWith('some-key');
    });

    it('does NOT delete the key when it is already done', async () => {
      redisClient.get.mockResolvedValue('done');

      await service.releaseLease('some-key');

      expect(redisClient.del).not.toHaveBeenCalled();
    });

    it('does NOT delete the key when it no longer exists', async () => {
      redisClient.get.mockResolvedValue(null);

      await service.releaseLease('some-key');

      expect(redisClient.del).not.toHaveBeenCalled();
    });
  });

  describe('no-op mode (REDIS_URL not configured)', () => {
    it('always returns acquired=true when Redis is unavailable', async () => {
      const noOpConfig = {
        get: jest.fn().mockReturnValue(''), // REDIS_URL returns empty
      };
      const { IdempotencyService: IS } = await import('./idempotency.service');
      const noOpService = new IS(noOpConfig as any, logger as any);
      await noOpService.onModuleInit();

      const result = await noOpService.acquireLease('key');
      expect(result.acquired).toBe(true);

      // markDone and releaseLease should be silent no-ops
      await expect(noOpService.markDone('key')).resolves.toBeUndefined();
      await expect(noOpService.releaseLease('key')).resolves.toBeUndefined();
    });
  });
});
