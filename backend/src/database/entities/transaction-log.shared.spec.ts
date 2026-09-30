import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TransactionLog,
  TxStatus,
} from './transaction-log.entity';
import { FailedPaymentsService } from '../../escrow/failed-payments.service';
import { QueueService } from '../../queue/queue.service';
import {
  CursorPaginatedResult,
  encodeCursor,
} from '../../common/pagination';

/**
 * Regression: escrow and stellar consumers must share one TransactionLog class
 * (#950). Write through the shared entity (stellar-style saveLog), then read
 * back through FailedPaymentsService and a stellar-style cursor query.
 */
describe('Shared TransactionLog entity (#950)', () => {
  const store: TransactionLog[] = [];

  const sharedRepo: Pick<
    Repository<TransactionLog>,
    'create' | 'save' | 'findAndCount' | 'findOne' | 'createQueryBuilder'
  > = {
    create: jest.fn((entry: Partial<TransactionLog>) => {
      return {
        id: entry.id ?? `tx-${store.length + 1}`,
        userId: entry.userId ?? null,
        dealId: entry.dealId ?? null,
        txHash: entry.txHash ?? null,
        xdrBody: entry.xdrBody ?? null,
        status: entry.status ?? TxStatus.PENDING,
        errorCode: entry.errorCode ?? null,
        createdAt: entry.createdAt ?? new Date(),
        user: null,
        deal: null,
      } as TransactionLog;
    }),
    save: jest.fn(async (entry: TransactionLog) => {
      store.push(entry);
      return entry;
    }),
    findAndCount: jest.fn(async (opts: { where?: { status?: string } }) => {
      const status = opts?.where?.status;
      const rows = store.filter((r) =>
        status ? r.status === status : true,
      );
      return [rows, rows.length] as [TransactionLog[], number];
    }),
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      return store.find((r) => r.id === where.id) ?? null;
    }),
    createQueryBuilder: jest.fn(() => {
      const state: { userId?: string } = {};
      const qb = {
        andWhere: jest.fn((clause: string, params?: { userId?: string }) => {
          if (params?.userId) state.userId = params.userId;
          return qb;
        }),
        orderBy: jest.fn(() => qb),
        addOrderBy: jest.fn(() => qb),
        take: jest.fn(() => qb),
        getMany: jest.fn(async () => {
          return store.filter((r) =>
            state.userId ? r.userId === state.userId : true,
          );
        }),
      };
      return qb;
    }),
  };

  let failedPayments: FailedPaymentsService;

  beforeEach(async () => {
    store.length = 0;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FailedPaymentsService,
        {
          provide: getRepositoryToken(TransactionLog),
          useValue: sharedRepo,
        },
        {
          provide: QueueService,
          useValue: { enqueueDealDelivered: jest.fn() },
        },
      ],
    }).compile();

    failedPayments = module.get(FailedPaymentsService);
  });

  it('writes via shared entity and reads back through escrow + stellar paths', async () => {
    // Stellar-style write (saveLog)
    const created = sharedRepo.create({
      userId: 'user-1',
      dealId: 'deal-1',
      txHash: 'hash-abc',
      status: TxStatus.FAILED,
      errorCode: 'TIMEOUT',
      createdAt: new Date('2024-06-01T00:00:00Z'),
    });
    await sharedRepo.save(created);

    // Escrow FailedPaymentsService read
    const failed = await failedPayments.getFailedPayments(1, 20);
    expect(failed.meta.total).toBe(1);
    expect(failed.data[0]).toMatchObject({
      id: created.id,
      dealId: 'deal-1',
      userId: 'user-1',
      txHash: 'hash-abc',
      errorCode: 'TIMEOUT',
    });

    // Stellar-style cursor pagination read (same shared repo / entity)
    const qb = sharedRepo.createQueryBuilder('log');
    qb.andWhere('log.userId = :userId', { userId: 'user-1' });
    qb.orderBy('log.createdAt', 'DESC').addOrderBy('log.id', 'DESC').take(21);
    const items = await qb.getMany();

    const result: CursorPaginatedResult<TransactionLog> = {
      data: items,
      meta: {
        limit: 20,
        nextCursor: items.length
          ? encodeCursor(items[items.length - 1].createdAt)
          : null,
        hasMore: false,
      },
    };

    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe(TxStatus.FAILED);
    expect(result.data[0].txHash).toBe('hash-abc');
  });

  it('exports a single TransactionLog class (no module-local duplicates)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const shared = require('./transaction-log.entity');
    expect(shared.TransactionLog).toBe(TransactionLog);
    expect(shared.TxStatus).toBe(TxStatus);
  });
});
