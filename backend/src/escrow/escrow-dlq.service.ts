import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { createHash } from 'crypto';
import {
  ESCROW_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
} from '../queue/queue.dlq.constants';

export interface EscrowDlqMessage {
  id: string;
  payloadSummary: string;
  failureReason: string;
  retryCount: number;
}

@Injectable()
export class EscrowDlqService {
  constructor(private readonly config: ConfigService) {}

  async listMessages(): Promise<EscrowDlqMessage[]> {
    return this.withChannel(async (channel) => {
      const { messageCount } = await channel.checkQueue(ESCROW_QUEUE_DLQ);
      const messages: EscrowDlqMessage[] = [];

      for (let index = 0; index < messageCount; index++) {
        const message = await channel.get(ESCROW_QUEUE_DLQ, { noAck: false });
        if (!message) break;
        messages.push(this.toDto(message));
        channel.nack(message, false, true);
      }

      return messages;
    });
  }

  async replayMessage(id: string): Promise<{ replayed: boolean; id: string }> {
    return this.withChannel(async (channel) => {
      const { messageCount } = await channel.checkQueue(ESCROW_QUEUE_DLQ);

      for (let index = 0; index < messageCount; index++) {
        const message = await channel.get(ESCROW_QUEUE_DLQ, { noAck: false });
        if (!message) break;

        const messageId = this.getId(message);
        if (messageId === id) {
          channel.sendToQueue(ESCROW_QUEUE_NAME, message.content, {
            persistent: true,
            messageId,
            headers: message.properties.headers,
          });
          channel.ack(message);
          return { replayed: true, id };
        }

        channel.nack(message, false, true);
      }

      return { replayed: false, id };
    });
  }

  async replayAll(): Promise<{ replayed: number }> {
    return this.withChannel(async (channel) => {
      const { messageCount } = await channel.checkQueue(ESCROW_QUEUE_DLQ);
      let replayed = 0;

      for (let index = 0; index < messageCount; index++) {
        const message = await channel.get(ESCROW_QUEUE_DLQ, { noAck: false });
        if (!message) break;
        channel.sendToQueue(ESCROW_QUEUE_NAME, message.content, {
          persistent: true,
          messageId: this.getId(message),
          headers: message.properties.headers,
        });
        channel.ack(message);
        replayed++;
      }

      return { replayed };
    });
  }

  private toDto(message: amqp.GetMessage): EscrowDlqMessage {
    const payload = message.content.toString('utf8');
    const headers = message.properties.headers ?? {};
    const xDeath = headers['x-death'];
    const retryCount = Array.isArray(xDeath)
      ? xDeath.reduce(
          (total: number, death: { count?: number }) =>
            total + (death.count ?? 0),
          0,
        )
      : Number(headers['x-retry-count'] ?? 0);
    const failureReason = Array.isArray(xDeath)
      ? String(xDeath[0]?.reason ?? 'unknown')
      : String(headers['failure-reason'] ?? 'unknown');

    return {
      id: this.getId(message),
      payloadSummary: payload.slice(0, 240),
      failureReason,
      retryCount,
    };
  }

  private getId(message: amqp.GetMessage): string {
    if (message.properties.messageId) return message.properties.messageId;
    return createHash('sha256')
      .update(message.content)
      .update(JSON.stringify(message.properties.headers ?? {}))
      .digest('hex');
  }

  private async withChannel<T>(
    operation: (channel: amqp.Channel) => Promise<T>,
  ): Promise<T> {
    const url = this.config.get<string>(
      'RABBITMQ_URL',
      'amqp://guest:guest@localhost:5672',
    );
    let connection: amqp.ChannelModel | undefined;
    try {
      connection = await amqp.connect(url);
      const channel = await connection.createChannel();
      return await operation(channel);
    } catch {
      throw new ServiceUnavailableException('RabbitMQ DLQ is unavailable.');
    } finally {
      await connection?.close();
    }
  }
}
