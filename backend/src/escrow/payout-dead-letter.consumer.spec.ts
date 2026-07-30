import { PayoutDeadLetterConsumer } from './payout-dead-letter.consumer';

// Mock heavy dependencies so ts-jest doesn't traverse broken transitive chains
jest.mock('../queue/queue-alert.service');
jest.mock('../notifications/notifications.service');

/**
 * Helper — builds a minimal RmqContext stub.
 */
function makeContext(rawMsg: Record<string, unknown> = {}) {
  const channel = { ack: jest.fn(), nack: jest.fn() };
  return {
    context: {
      getChannelRef: () => channel,
      getMessage: () => rawMsg,
    } as any,
    channel,
  };
}

describe('PayoutDeadLetterConsumer', () => {
  let consumer: PayoutDeadLetterConsumer;
  let notificationsService: { sendEmail: jest.Mock };
  let queueAlertService: { sendAlert: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(() => {
    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    queueAlertService = { sendAlert: jest.fn().mockResolvedValue(undefined) };
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'OPS_ALERT_EMAIL') return 'ops@agrifinance.com';
        return undefined;
      }),
    };

    consumer = new PayoutDeadLetterConsumer(
      notificationsService as any,
      queueAlertService as any,
      configService as any,
    );
  });

  // ── Always acks ────────────────────────────────────────────────────────────

  it('acks the DLQ message after processing', async () => {
    const { context, channel } = makeContext({
      properties: { headers: { 'x-death': [{ count: 5 }] } },
    });

    await consumer.handleDeadLetter({ tradeDealId: 'deal-abc' }, context);

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  // ── Email notification ─────────────────────────────────────────────────────

  it('sends an alert email to OPS_ALERT_EMAIL when configured', async () => {
    const { context } = makeContext({
      properties: { headers: { 'x-death': [{ count: 5 }] } },
    });

    await consumer.handleDeadLetter({ tradeDealId: 'deal-xyz' }, context);

    expect(notificationsService.sendEmail).toHaveBeenCalledWith(
      'ops@agrifinance.com',
      expect.stringContaining('deal-xyz'),
      expect.stringContaining('permanently failed'),
      expect.stringContaining('deal-xyz'),
    );
  });

  it('skips email when OPS_ALERT_EMAIL is not configured', async () => {
    configService.get.mockReturnValue(undefined);
    const { context, channel } = makeContext({});

    await consumer.handleDeadLetter({ tradeDealId: 'deal-no-email' }, context);

    expect(notificationsService.sendEmail).not.toHaveBeenCalled();
    // Message should still be acked
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  // ── Discord alert ──────────────────────────────────────────────────────────

  it('sends a Discord alert via QueueAlertService', async () => {
    const { context } = makeContext({
      properties: { headers: { 'x-death': [{ count: 5 }] } },
    });

    await consumer.handleDeadLetter({ tradeDealId: 'deal-discord' }, context);

    expect(queueAlertService.sendAlert).toHaveBeenCalledWith(
      expect.stringContaining('deal-discord'),
    );
  });

  // ── Resilience — notifications partial failure ─────────────────────────────

  it('still acks and fires Discord alert when email sending fails', async () => {
    notificationsService.sendEmail.mockRejectedValue(
      new Error('SMTP unavailable'),
    );
    const { context, channel } = makeContext({});

    await consumer.handleDeadLetter({ tradeDealId: 'deal-smtp-fail' }, context);

    expect(queueAlertService.sendAlert).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  it('still acks and fires email alert when Discord webhook fails', async () => {
    queueAlertService.sendAlert.mockRejectedValue(
      new Error('Discord webhook down'),
    );
    const { context, channel } = makeContext({});

    await consumer.handleDeadLetter(
      { tradeDealId: 'deal-discord-fail' },
      context,
    );

    expect(notificationsService.sendEmail).toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  // ── x-death header parsing ─────────────────────────────────────────────────

  it('reads total attempt count from x-death header and includes it in email', async () => {
    const { context } = makeContext({
      properties: {
        headers: { 'x-death': [{ count: 3 }, { count: 2 }] },
      },
    });

    await consumer.handleDeadLetter({ tradeDealId: 'deal-count' }, context);

    expect(notificationsService.sendEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.stringContaining('5'), // 3+2 = 5 total attempts
      expect.any(String),
    );
  });

  it('handles messages with no x-death header gracefully', async () => {
    const { context, channel } = makeContext({
      properties: { headers: {} },
    });

    await expect(
      consumer.handleDeadLetter({ tradeDealId: 'deal-no-death' }, context),
    ).resolves.not.toThrow();

    expect(channel.ack).toHaveBeenCalledTimes(1);
  });

  // ── Unknown deal ──────────────────────────────────────────────────────────

  it('handles payloads without a tradeDealId gracefully', async () => {
    const { context, channel } = makeContext({});

    await expect(consumer.handleDeadLetter({}, context)).resolves.not.toThrow();

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(notificationsService.sendEmail).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('unknown'),
      expect.any(String),
      expect.any(String),
    );
  });
});
