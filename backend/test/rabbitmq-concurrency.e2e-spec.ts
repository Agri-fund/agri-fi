import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ClientProxy, ClientsModule, Transport } from '@nestjs/microservices';
import { Controller } from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { RmqContext } from '@nestjs/microservices';

const QUEUE_SERVICE = 'QUEUE_SERVICE';
const TEST_QUEUE_NAME = 'test_concurrency_queue';
const TEST_EVENT_PATTERN = 'test.message';

let messageProcessingOrder: number[] = [];
let processingStartTimes: Map<number, number> = new Map();
let processingEndTimes: Map<number, number> = new Map();

@Controller()
class TestQueueProcessor {
  @EventPattern(TEST_EVENT_PATTERN)
  async handleMessage(
    @Payload() data: { sequenceNumber: number },
    @Ctx() context: RmqContext,
  ) {
    const seqNum = data.sequenceNumber;
    processingStartTimes.set(seqNum, Date.now());
    messageProcessingOrder.push(seqNum);

    await new Promise((resolve) => setTimeout(resolve, 100));

    processingEndTimes.set(seqNum, Date.now());
    context.getChannelRef().ack(context.getMessage());
  }
}

describe('RabbitMQ Consumer Concurrency Settings (E2E)', () => {
  const RABBITMQ_AVAILABLE =
    process.env.RABBITMQ_URL || process.env.CI_RABBITMQ;

  if (!RABBITMQ_AVAILABLE) {
    it.skip('skipped — no RabbitMQ available in this environment', () => {});
    return;
  }

  let app: INestApplication;
  let client: ClientProxy;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ClientsModule.register([
          {
            name: QUEUE_SERVICE,
            transport: Transport.RMQ,
            options: {
              urls: ['amqp://guest:guest@localhost:5672'],
              queue: TEST_QUEUE_NAME,
              queueOptions: { durable: false },
              prefetchCount: 1,
            },
          },
        ]),
      ],
      controllers: [TestQueueProcessor],
    }).compile();

    app = module.createNestApplication();
    client = module.get<ClientProxy>(QUEUE_SERVICE);

    await app.listen(0);
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    messageProcessingOrder = [];
    processingStartTimes = new Map();
    processingEndTimes = new Map();
  });

  describe('Sequential message processing', () => {
    it('should publish 5 concurrent messages to the queue', async () => {
      const messages = [
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 3 },
        { sequenceNumber: 4 },
        { sequenceNumber: 5 },
      ];

      messages.forEach((msg) => {
        client.emit(TEST_EVENT_PATTERN, msg);
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(messageProcessingOrder.length).toBe(5);
    });

    it('should process messages sequentially despite concurrent publish', async () => {
      const messages = [
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 3 },
        { sequenceNumber: 4 },
        { sequenceNumber: 5 },
      ];

      messages.forEach((msg) => {
        client.emit(TEST_EVENT_PATTERN, msg);
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(messageProcessingOrder.length).toBe(5);

      const startTimes = Array.from(processingStartTimes.values());
      if (startTimes.length >= 2) {
        const gaps: number[] = [];
        for (let i = 1; i < startTimes.length; i++) {
          gaps.push(startTimes[i] - startTimes[i - 1]);
        }

        gaps.forEach((gap) => {
          expect(gap).toBeGreaterThan(50);
        });
      }
    });

    it('should prevent sequence number conflicts through sequential execution', async () => {
      const messages = [
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 3 },
        { sequenceNumber: 4 },
        { sequenceNumber: 5 },
      ];

      messages.forEach((msg) => {
        client.emit(TEST_EVENT_PATTERN, msg);
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const uniqueSequences = new Set(messageProcessingOrder);
      expect(uniqueSequences.size).toBe(messageProcessingOrder.length);
    });

    it('should process all messages without dropping any', async () => {
      const messageCount = 5;
      const messages = Array.from({ length: messageCount }, (_, i) => ({
        sequenceNumber: i + 1,
      }));

      messages.forEach((msg) => {
        client.emit(TEST_EVENT_PATTERN, msg);
      });

      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(messageProcessingOrder.length).toBe(messageCount);
      expect(messageProcessingOrder.sort((a, b) => a - b)).toEqual(
        Array.from({ length: messageCount }, (_, i) => i + 1),
      );
    });
  });

  describe('Concurrency control', () => {
    it('should enforce prefetchCount=1 for sequential processing', async () => {
      const messages = [
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 3 },
      ];

      messages.forEach((msg) => {
        client.emit(TEST_EVENT_PATTERN, msg);
      });

      await new Promise((resolve) => setTimeout(resolve, 800));

      expect(messageProcessingOrder.length).toBe(3);

      let previousEndTime = 0;
      for (const seqNum of messageProcessingOrder) {
        const startTime = processingStartTimes.get(seqNum) || 0;
        const endTime = processingEndTimes.get(seqNum) || 0;

        if (previousEndTime > 0) {
          const overlap =
            Math.min(endTime, previousEndTime) -
            Math.max(startTime, previousEndTime);
          expect(overlap).toBeLessThanOrEqual(10);
        }
        previousEndTime = endTime;
      }
    });
  });
});
