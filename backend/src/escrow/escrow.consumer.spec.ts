import { EscrowConsumer } from './escrow.consumer';
import { ESCROW_MAX_DELIVERY_ATTEMPTS } from '../queue/queue.dlq.constants';

// Mock transitive heavy dependencies so ts-jest doesn't traverse them
jest.mock('./escrow.service');
jest.mock('../stellar/stellar.service');

/**
 * Builds a fake RmqContext wrapping the provided raw message object.
 */
function makeContext(rawMsg: Record<string, unknown>) {
  const channel = { ack: jest.fn(), nack: jest.fn() };
  return {
    context: {
      getChannelRef: () => channel,
      getMessage: () => rawMsg,
    } as any,
    channel,
  };
}

/**
 * Builds a raw AMQP message with x-death headers simulating `count` prior
 * broker-level delivery failures.
 */
function msgWithDeaths(count: number) {
  return {
    properties: {
      headers: {
        'x-death': count > 0 ? [{ count }] : [],
      },
    },
  };
}

describe('EscrowConsumer', () => {
  let consumer: EscrowConsumer;
  let escrowService: { processDealDelivered: jest.Mock };

  const payload = { tradeDealId: 'deal-001' };

  beforeEach(() => {
    escrowService = { processDealDelivered: jest.fn() };
    consumer = new EscrowConsumer(escrowService as any);
  });

  // ── Success path ───────────────────────────────────────────────────────────

  it('acks the message when processDealDelivered succeeds', async () => {
    escrowService.processDealDelivered.mockResolvedValue(undefined);
    const { context, channel } = makeContext(msgWithDeaths(0));

    await consumer.handleDealDelivered(payload, context);

    expect(escrowService.processDealDelivered).toHaveBeenCalledWith(payload);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  // ── Retry path (attempts < max) ────────────────────────────────────────────

  it('nacks with requeue=true when attempt is below the max', async () => {
    escrowService.processDealDelivered.mockRejectedValue(
      new Error('transient stellar timeout'),
    );
    // attempt = 1+1 = 2 (first x-death entry with count=1, +1 for current delivery)
    // actually getDeliveryAttempt returns deaths.reduce(sum + count) + 1 = 1+1 = 2
    const { context, channel } = makeContext(msgWithDeaths(1));

    await consumer.handleDealDelivered(payload, context);

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('nacks with requeue=true on attempt 4 (one before max)', async () => {
    escrowService.processDealDelivered.mockRejectedValue(new Error('db error'));
    // x-death count=3 → attempt = 3+1 = 4; max=5, not exhausted
    const { context, channel } = makeContext(msgWithDeaths(3));

    await consumer.handleDealDelivered(payload, context);

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  // ── DLQ routing (attempt >= max) ──────────────────────────────────────────

  it(`nacks WITHOUT requeue when attempt reaches ${ESCROW_MAX_DELIVERY_ATTEMPTS} (routes to DLQ)`, async () => {
    escrowService.processDealDelivered.mockRejectedValue(
      new Error('permanent failure'),
    );
    // x-death count = ESCROW_MAX_DELIVERY_ATTEMPTS - 1 so that
    // getDeliveryAttempt returns exactly ESCROW_MAX_DELIVERY_ATTEMPTS
    const { context, channel } = makeContext(
      msgWithDeaths(ESCROW_MAX_DELIVERY_ATTEMPTS - 1),
    );

    await consumer.handleDealDelivered(payload, context);

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('never calls processDealDelivered again once DLQ threshold is met', async () => {
    escrowService.processDealDelivered.mockRejectedValue(
      new Error('some error'),
    );
    // Simulate a message that already has exactly 5 cumulative deaths
    const { context, channel } = makeContext(
      msgWithDeaths(ESCROW_MAX_DELIVERY_ATTEMPTS - 1),
    );

    await consumer.handleDealDelivered(payload, context);

    // processDealDelivered is still called once (the attempt itself), but the
    // nack that follows has requeue=false so no further redelivery occurs.
    expect(escrowService.processDealDelivered).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('treats a first-delivery message (no x-death) as attempt 1 and requeues', async () => {
    escrowService.processDealDelivered.mockRejectedValue(new Error('oops'));
    // No x-death headers → getDeliveryAttempt returns 1
    const rawMsg = { properties: { headers: {} } };
    const { context, channel } = makeContext(rawMsg);

    await consumer.handleDealDelivered(payload, context);

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it('handles non-transient errors the same way as transient ones', async () => {
    escrowService.processDealDelivered.mockRejectedValue(
      new Error('ValidationError: invalid state'),
    );
    const { context, channel } = makeContext(msgWithDeaths(0));

    await consumer.handleDealDelivered(payload, context);

    // Non-transient, but still below max → requeue for broker retry
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });
});
