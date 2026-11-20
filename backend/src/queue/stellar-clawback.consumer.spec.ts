import { StellarClawbackConsumer } from './stellar-clawback.consumer';
import { InvestmentStatus } from '../investments/entities/investment.entity';
import { encryptPayload } from './queue.crypto';

const TEST_KEY = 'a'.repeat(64);

jest.mock('../stellar/stellar.service', () => ({
  StellarService: jest.fn(),
}));

describe('StellarClawbackConsumer (#1318)', () => {
  let stellarService: any;
  let investmentRepo: any;
  let queueService: any;
  let logger: any;
  let idempotency: any;
  let consumer: StellarClawbackConsumer;
  let channel: any;
  let context: any;
  let message: any;

  const payload = {
    investmentId: 'inv-1',
    tradeDealId: 'deal-1',
    investorId: 'user-1',
    amountUsd: 500,
    reason: 'deal_expired',
  };

  const investment = {
    id: 'inv-1',
    tokenAmount: 5,
    status: InvestmentStatus.PENDING,
    investor: { walletAddress: 'GINVESTOR' },
    tradeDeal: {
      tokenSymbol: 'TRADE',
      issuerPublicKey: 'GISSUER',
      issuerSecretKey: 'encrypted-secret',
    },
  };

  const encrypted = () => encryptPayload(payload, 'stellar.clawback');

  beforeAll(() => {
    process.env.QUEUE_ENCRYPTION_KEY = TEST_KEY;
  });

  beforeEach(() => {
    stellarService = {
      decryptSecret: jest.fn().mockResolvedValue('issuer-secret'),
      clawbackTokens: jest.fn().mockResolvedValue(undefined),
    };
    investmentRepo = {
      findOne: jest.fn().mockResolvedValue({ ...investment }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    queueService = { emit: jest.fn().mockResolvedValue(undefined) };
    logger = {
      setContext: jest.fn(),
      assign: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    idempotency = {
      acquireLease: jest.fn().mockResolvedValue({ acquired: true }),
      markDone: jest.fn().mockResolvedValue(undefined),
      releaseLease: jest.fn().mockResolvedValue(undefined),
    };
    channel = { ack: jest.fn(), nack: jest.fn() };
    message = { fields: {}, properties: {} };
    context = {
      getChannelRef: jest.fn().mockReturnValue(channel),
      getMessage: jest.fn().mockReturnValue(message),
    };

    consumer = new StellarClawbackConsumer(
      stellarService,
      investmentRepo,
      queueService,
      logger,
      idempotency,
    );
  });

  it('executes the on-chain clawback before marking the investment REFUNDED', async () => {
    consumer.handleStellarClawback(encrypted(), context as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stellarService.clawbackTokens).toHaveBeenCalledWith(
      'TRADE',
      'GISSUER',
      'issuer-secret',
      [{ walletAddress: 'GINVESTOR', tokenAmount: 5 }],
    );
    const clawbackOrder = (stellarService.clawbackTokens as jest.Mock).mock
      .invocationCallOrder[0];
    const updateOrder = (investmentRepo.update as jest.Mock).mock
      .invocationCallOrder[0];
    expect(clawbackOrder).toBeLessThan(updateOrder);
    expect(investmentRepo.update).toHaveBeenCalledWith('inv-1', {
      status: InvestmentStatus.REFUNDED,
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('does not mark REFUNDED and requeues when the on-chain clawback fails', async () => {
    stellarService.clawbackTokens.mockRejectedValue(new Error('horizon down'));

    consumer.handleStellarClawback(encrypted(), context as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(investmentRepo.update).not.toHaveBeenCalled();
    expect(idempotency.releaseLease).toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });

  it('returns the investment to PENDING and alerts admins when retries are exhausted', async () => {
    stellarService.clawbackTokens.mockRejectedValue(new Error('horizon down'));
    message.properties.headers = { 'x-death': [{ count: 5 }] };

    consumer.handleStellarClawback(encrypted(), context as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(investmentRepo.update).toHaveBeenCalledWith('inv-1', {
      status: InvestmentStatus.PENDING,
    });
    expect(queueService.emit).toHaveBeenCalledWith(
      'admin.alert',
      expect.objectContaining({ type: 'stellar_clawback_failed' }),
    );
    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
  });

  it('acks duplicates without running a second clawback', async () => {
    idempotency.acquireLease.mockResolvedValue({
      acquired: false,
      status: 'done',
    });

    consumer.handleStellarClawback(encrypted(), context as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stellarService.clawbackTokens).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('skips investments that are not pending or refunded', async () => {
    investmentRepo.findOne.mockResolvedValue({
      ...investment,
      status: InvestmentStatus.COMPLETED,
    });

    consumer.handleStellarClawback(encrypted(), context as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(stellarService.clawbackTokens).not.toHaveBeenCalled();
    expect(investmentRepo.update).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });
});
