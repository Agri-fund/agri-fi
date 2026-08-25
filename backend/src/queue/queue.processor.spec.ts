import { QueueProcessor } from './queue.processor';
import { IdempotencyService } from './idempotency.service';

/**
 * Helper to wait for all in-flight jobs tracked by QueueProcessor.
 * We trigger this by calling onApplicationShutdown() which awaits
 * Promise.allSettled(activeJobs).
 */
async function drainJobs(processor: QueueProcessor): Promise<void> {
  await processor.onApplicationShutdown('TEST');
}

describe('QueueProcessor', () => {
  let processor: QueueProcessor;
  let stellarService: {
    decryptSecret: jest.Mock;
    issueTradeToken: jest.Mock;
    encryptSecret: jest.Mock;
    submitTransaction: jest.Mock;
    transferTradeTokens: jest.Mock;
  };
  let tradeDealRepo: { update: jest.Mock };
  let investmentRepo: { update: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };
  let emailTemplates: { render: jest.Mock };
  let logger: {
    setContext: jest.Mock;
    assign: jest.Mock;
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let context: {
    getChannelRef: jest.Mock;
    getMessage: jest.Mock;
  };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let idempotency: {
    acquireLease: jest.Mock;
    markDone: jest.Mock;
    releaseLease: jest.Mock;
  };
  const message = { fields: { deliveryTag: 1 } };

  beforeEach(() => {
    stellarService = {
      decryptSecret: jest.fn(),
      issueTradeToken: jest.fn(),
      encryptSecret: jest.fn(),
      submitTransaction: jest.fn(),
      transferTradeTokens: jest.fn(),
    };
    tradeDealRepo = { update: jest.fn() };
    investmentRepo = { update: jest.fn() };
    userRepo = { findOne: jest.fn() };
    notificationsService = { sendEmail: jest.fn() };
    emailTemplates = {
      render: jest.fn().mockReturnValue({
        subject: 'Test Subject',
        text: 'Test body',
        html: '<p>Test body</p>',
      }),
    };
    logger = {
      setContext: jest.fn(),
      assign: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    channel = { ack: jest.fn(), nack: jest.fn() };
    context = {
      getChannelRef: jest.fn().mockReturnValue(channel),
      getMessage: jest.fn().mockReturnValue(message),
    };
    // Default idempotency: lease always acquired, operations no-op
    idempotency = {
      acquireLease: jest.fn().mockResolvedValue({ acquired: true }),
      markDone: jest.fn().mockResolvedValue(undefined),
      releaseLease: jest.fn().mockResolvedValue(undefined),
    };

    processor = new QueueProcessor(
      stellarService as any,
      {} as any, // sorobanService
      {} as any, // tradeDealsService
      tradeDealRepo as any,
      investmentRepo as any,
      {} as any, // config
      userRepo as any,
      notificationsService as any,
      emailTemplates as any,
      logger as any,
      idempotency as unknown as IdempotencyService,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // deal.publish
  // ─────────────────────────────────────────────────────────────────────────────
  describe('handleDealPublish', () => {
    it('encrypts issuer secret before persisting the published deal', async () => {
      stellarService.decryptSecret.mockResolvedValue('plain-escrow-secret');
      stellarService.issueTradeToken.mockResolvedValue({
        txId: 'tx-123',
        issuerPublicKey: 'GISSUER123',
        issuerSecret: 'plain-issuer-secret',
      });
      stellarService.encryptSecret.mockResolvedValue('encrypted-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOAdeal',
          escrowPublicKey: 'GESCROW123',
          encryptedEscrowSecret: 'encrypted-escrow-secret',
          tokenCount: 50,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      expect(stellarService.decryptSecret).toHaveBeenCalledWith(
        'encrypted-escrow-secret',
      );
      expect(stellarService.issueTradeToken).toHaveBeenCalledWith(
        'COCOAdeal',
        'GESCROW123',
        'plain-escrow-secret',
        50,
      );
      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        'plain-issuer-secret',
      );
      expect(tradeDealRepo.update).toHaveBeenCalledWith(
        'deal-uuid',
        expect.objectContaining({
          status: 'open',
          stellarAssetTxId: 'tx-123',
          issuerPublicKey: 'GISSUER123',
          issuerSecretKey: 'encrypted-issuer-secret',
        }),
      );
      expect(tradeDealRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issuerSecretKey: 'plain-issuer-secret' }),
      );
      expect(channel.ack).toHaveBeenCalledWith(message);
      expect(idempotency.markDone).toHaveBeenCalled();
    });

    it('does not persist the issuer secret if encryption returns plaintext', async () => {
      stellarService.decryptSecret.mockResolvedValue('plain-escrow-secret');
      stellarService.issueTradeToken.mockResolvedValue({
        txId: 'tx-123',
        issuerPublicKey: 'GISSUER123',
        issuerSecret: 'plain-issuer-secret',
      });
      stellarService.encryptSecret.mockResolvedValue('plain-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOAdeal',
          escrowPublicKey: 'GESCROW123',
          encryptedEscrowSecret: 'encrypted-escrow-secret',
          tokenCount: 50,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        'plain-issuer-secret',
      );
      expect(tradeDealRepo.update).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ issuerSecretKey: 'plain-issuer-secret' }),
      );
      expect(tradeDealRepo.update).toHaveBeenCalledWith(
        'deal-uuid',
        expect.objectContaining({ status: 'failed' }),
      );
      expect(idempotency.releaseLease).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Idempotency (#687)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('idempotency', () => {
    it('acks without processing when lease is already "done"', async () => {
      idempotency.acquireLease.mockResolvedValue({
        acquired: false,
        status: 'done',
      });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOA',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc-secret',
          tokenCount: 10,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      // Business logic must NOT run
      expect(stellarService.issueTradeToken).not.toHaveBeenCalled();
      // Message must still be acked so it is not requeued
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('acks without processing when another consumer holds the lease ("processing")', async () => {
      idempotency.acquireLease.mockResolvedValue({
        acquired: false,
        status: 'processing',
      });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'deal-uuid',
          tokenSymbol: 'COCOA',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc-secret',
          tokenCount: 10,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      expect(stellarService.issueTradeToken).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('calls markDone after successful processing', async () => {
      stellarService.decryptSecret.mockResolvedValue('secret');
      stellarService.issueTradeToken.mockResolvedValue({
        txId: 'tx-1',
        issuerPublicKey: 'GPUB',
        issuerSecret: 'issuer-secret',
      });
      stellarService.encryptSecret.mockResolvedValue('enc-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'deal-1',
          tokenSymbol: 'TOK1',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc',
          tokenCount: 5,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      expect(idempotency.markDone).toHaveBeenCalledWith(
        'idempotency:deal.publish:deal-1',
      );
    });

    it('releases lease on processing failure so retry can re-acquire', async () => {
      stellarService.decryptSecret.mockResolvedValue('secret');
      stellarService.issueTradeToken.mockRejectedValue(
        new Error('Stellar timeout'),
      );
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'fail-deal',
          tokenSymbol: 'TOK2',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc',
          tokenCount: 5,
        }) as any,
        context as any,
      );
      await drainJobs(processor);

      expect(idempotency.releaseLease).toHaveBeenCalledWith(
        'idempotency:deal.publish:fail-deal',
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Graceful shutdown (#696)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('graceful shutdown', () => {
    it('nacks and requeues messages received after shutdown is signalled', async () => {
      // Trigger shutdown first
      const shutdownPromise = processor.onApplicationShutdown('SIGTERM');

      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'late-deal',
          tokenSymbol: 'TOK3',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc',
          tokenCount: 1,
        }) as any,
        context as any,
      );
      await shutdownPromise;

      // Message must be nacked with requeue=true, NOT processed
      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(stellarService.issueTradeToken).not.toHaveBeenCalled();
    });

    it('waits for in-flight jobs before resolving shutdown', async () => {
      let resolveJob!: () => void;
      const jobBarrier = new Promise<void>((res) => {
        resolveJob = res;
      });

      // Make issueTradeToken block until we release the barrier
      stellarService.decryptSecret.mockResolvedValue('secret');
      stellarService.issueTradeToken.mockReturnValue(jobBarrier.then(() => ({
        txId: 'tx-slow',
        issuerPublicKey: 'GPUB',
        issuerSecret: 'issuer-secret',
      })));
      stellarService.encryptSecret.mockResolvedValue('enc-issuer-secret');
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      // Start a job
      processor.handleDealPublish(
        JSON.stringify({
          dealId: 'slow-deal',
          tokenSymbol: 'SLOW',
          escrowPublicKey: 'GESCROW',
          encryptedEscrowSecret: 'enc',
          tokenCount: 1,
        }) as any,
        context as any,
      );

      let shutdownResolved = false;
      const shutdownPromise = processor
        .onApplicationShutdown('SIGTERM')
        .then(() => {
          shutdownResolved = true;
        });

      // Shutdown should NOT have resolved yet because the job is still running
      await Promise.resolve(); // tick
      expect(shutdownResolved).toBe(false);

      // Release the barrier — job finishes
      resolveJob();
      await shutdownPromise;

      expect(shutdownResolved).toBe(true);
      expect(channel.ack).toHaveBeenCalledWith(message);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // IdempotencyService.buildKey
  // ─────────────────────────────────────────────────────────────────────────────
  describe('IdempotencyService.buildKey', () => {
    it('produces the expected namespaced key', () => {
      expect(IdempotencyService.buildKey('deal.publish', 'abc-123')).toBe(
        'idempotency:deal.publish:abc-123',
      );
      expect(IdempotencyService.buildKey('deal.delivered', 'xyz-789')).toBe(
        'idempotency:deal.delivered:xyz-789',
      );
    });
  });
});
