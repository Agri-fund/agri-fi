import { ServiceUnavailableException } from '@nestjs/common';
import * as amqp from 'amqplib';
import { EscrowDlqService } from './escrow-dlq.service';
import {
  ESCROW_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
} from '../queue/queue.dlq.constants';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

const connect = amqp.connect as jest.MockedFunction<typeof amqp.connect>;

describe('EscrowDlqService', () => {
  const message = {
    content: Buffer.from('{"tradeDealId":"deal-1"}'),
    properties: {
      messageId: 'message-1',
      headers: {
        'x-death': [{ count: 5, reason: 'rejected' }],
      },
    },
  } as amqp.GetMessage;

  let service: EscrowDlqService;
  let channel: {
    checkQueue: jest.Mock;
    get: jest.Mock;
    nack: jest.Mock;
    ack: jest.Mock;
    sendToQueue: jest.Mock;
  };
  let connection: { createChannel: jest.Mock; close: jest.Mock };

  beforeEach(() => {
    channel = {
      checkQueue: jest.fn().mockResolvedValue({ messageCount: 1 }),
      get: jest.fn().mockResolvedValueOnce(message).mockResolvedValue(null),
      nack: jest.fn(),
      ack: jest.fn(),
      sendToQueue: jest.fn().mockReturnValue(true),
    };
    connection = {
      createChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
    };
    connect.mockResolvedValue(connection as any);
    service = new EscrowDlqService({
      get: jest.fn().mockReturnValue('amqp://localhost'),
    } as any);
  });

  it('lists message metadata without removing messages', async () => {
    await expect(service.listMessages()).resolves.toEqual([
      {
        id: 'message-1',
        payloadSummary: '{"tradeDealId":"deal-1"}',
        failureReason: 'rejected',
        retryCount: 5,
      },
    ]);
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.checkQueue).toHaveBeenCalledWith(ESCROW_QUEUE_DLQ);
  });

  it('replays a selected message onto the escrow queue', async () => {
    await expect(service.replayMessage('message-1')).resolves.toEqual({
      replayed: true,
      id: 'message-1',
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      ESCROW_QUEUE_NAME,
      message.content,
      expect.objectContaining({ messageId: 'message-1', persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('fails with 503 when RabbitMQ is unavailable', async () => {
    connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.listMessages()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
