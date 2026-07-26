import { EscrowConsumer } from './escrow.consumer';
import { IdempotencyService } from '../queue/idempotency.service';

/**
 * Drain all in-flight jobs tracked by EscrowConsumer.
 */
async function drainJobs(consumer: EscrowConsumer): Promise<void> {
  await consumer.onApplicationShutdown('TEST');
}

describe('EscrowConsumer', () => {
  let consumer: EscrowConsumer;
  let escrowService: { processDealDelivered: jest.Mock };
  let idempotency: {
    acquireLease: jest.Mock;
    markDone: jest.Mock;
    releaseLease: jest.Mock;
  };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let context: { getChannelRef: jest.Mock; getMessage: jest.Mock };
  const message = { fields: { deliveryTag: 1 } };
  const payload = { tradeDealId: 'deal-abc' };

  beforeEach(() => {
    escrowService = {
      processDealDelivered: jest.fn().mockResolvedValue(undefined),
    };
    idempotency = {
      acquireLease: jest.fn().mockResolvedValue({ acquired: true }),
      markDone: jest.fn().mockResolvedValue(undefined),
      releaseLease: jest.fn().mockResolvedValue(undefined),
    };
    channel = { ack: jest.fn(), nack: jest.fn() };
    context = {
      getChannelRef: jest.fn().mockReturnValue(channel),
      getMessage: jest.fn().mockReturnValue(message),
    };
    consumer = new EscrowConsumer(
      escrowService as any,
      idempotency as unknown as IdempotencyService,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────────────────────
  it('processes deal.delivered successfully and acks the message', async () => {
    consumer.handleDealDelivered(payload, context as any);
    await drainJobs(consumer);

    expect(escrowService.processDealDelivered).toHaveBeenCalledWith(payload);
    expect(idempotency.markDone).toHaveBeenCalledWith(
      'idempotency:deal.delivered:deal-abc',
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Idempotency (#687)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('idempotency', () => {
    it('acks without processing when message is already "done"', async () => {
      idempotency.acquireLease.mockResolvedValue({
        acquired: false,
        status: 'done',
      });

      consumer.handleDealDelivered(payload, context as any);
      await drainJobs(consumer);

      expect(escrowService.processDealDelivered).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('acks without processing when another consumer holds the lease', async () => {
      idempotency.acquireLease.mockResolvedValue({
        acquired: false,
        status: 'processing',
      });

      consumer.handleDealDelivered(payload, context as any);
      await drainJobs(consumer);

      expect(escrowService.processDealDelivered).not.toHaveBeenCalled();
      expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('releases lease on non-transient failure', async () => {
      escrowService.processDealDelivered.mockRejectedValue(
        new Error('unrecoverable error'),
      );

      consumer.handleDealDelivered(payload, context as any);
      await drainJobs(consumer);

      expect(idempotency.releaseLease).toHaveBeenCalledWith(
        'idempotency:deal.delivered:deal-abc',
      );
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });

    it('releases lease after all retries exhausted on transient failure', async () => {
      escrowService.processDealDelivered.mockRejectedValue(
        new Error('stellar connection timeout'),
      );

      consumer.handleDealDelivered(payload, context as any);
      await drainJobs(consumer);

      expect(idempotency.releaseLease).toHaveBeenCalledWith(
        'idempotency:deal.delivered:deal-abc',
      );
      expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Graceful shutdown (#696)
  // ─────────────────────────────────────────────────────────────────────────────
  describe('graceful shutdown', () => {
    it('nacks and requeues messages received after shutdown starts', async () => {
      const shutdownPromise = consumer.onApplicationShutdown('SIGTERM');

      consumer.handleDealDelivered(payload, context as any);
      await shutdownPromise;

      expect(channel.nack).toHaveBeenCalledWith(message, false, true);
      expect(escrowService.processDealDelivered).not.toHaveBeenCalled();
    });

    it('waits for in-flight jobs before shutdown resolves', async () => {
      let resolveJob!: () => void;
      const barrier = new Promise<void>((res) => {
        resolveJob = res;
      });
      escrowService.processDealDelivered.mockReturnValue(barrier);

      consumer.handleDealDelivered(payload, context as any);

      let shutdownResolved = false;
      const shutdownPromise = consumer
        .onApplicationShutdown('SIGTERM')
        .then(() => {
          shutdownResolved = true;
        });

      await Promise.resolve(); // tick
      expect(shutdownResolved).toBe(false);

      resolveJob();
      await shutdownPromise;

      expect(shutdownResolved).toBe(true);
    });
  });
});
