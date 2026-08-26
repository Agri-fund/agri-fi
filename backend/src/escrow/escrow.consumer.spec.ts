import { EscrowConsumer } from './escrow.consumer';
import { EscrowService } from './escrow.service';

describe('EscrowConsumer', () => {
  let consumer: EscrowConsumer;
  let escrowService: { processDealDelivered: jest.Mock };
  let channel: { ack: jest.Mock; nack: jest.Mock };
  let message: any;
  let context: {
    getChannelRef: jest.Mock;
    getMessage: jest.Mock;
  };

  beforeEach(() => {
    escrowService = {
      processDealDelivered: jest.fn(),
    };
    consumer = new EscrowConsumer(escrowService as unknown as EscrowService);
    (consumer as any).logger = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    channel = {
      ack: jest.fn(),
      nack: jest.fn(),
    };
    message = {
      content: Buffer.from('not-json'),
      properties: {
        correlationId: 'corr-123',
      },
      fields: {
        deliveryTag: 1,
      },
    };
    context = {
      getChannelRef: jest.fn().mockReturnValue(channel),
      getMessage: jest.fn().mockReturnValue(message),
    };
  });

  it('nacks malformed payloads without requeueing and keeps the consumer alive', async () => {
    await consumer.handleDealDelivered('not-json', context as any);

    expect(escrowService.processDealDelivered).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
    expect((consumer as any).logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'corr-123',
        reason: expect.any(String),
        rawMessage: 'not-json',
      }),
      'Malformed escrow message routed to DLQ',
    );
  });
});
