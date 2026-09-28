import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UnprocessableEntityException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ShipmentsService } from '../../../src/shipments/shipments.service';
import { ShipmentMilestone } from '../../../src/shipments/entities/shipment-milestone.entity';
import { TradeDeal } from '../../../src/trade-deals/entities/trade-deal.entity';
import { CreateMilestoneDto } from '../../../src/shipments/dto/create-milestone.dto';

const DEAL_ID = 'deal-uuid-1234';
const TRADER_ID = 'trader-uuid-5678';

function makeManager(overrides: Record<string, any> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue({
      id: DEAL_ID,
      status: 'funded',
      traderId: TRADER_ID,
      escrowSecretKey: null,
    }),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockImplementation((_, data) => data),
    save: jest.fn().mockImplementation(async (entity) => ({ id: 'ms-uuid', ...entity })),
    ...overrides,
  };
}

function makeStellalService() {
  return {
    recordMemo: jest.fn().mockResolvedValue('stellar-tx-id-001'),
    decryptSecret: jest.fn().mockReturnValue('decrypted-secret'),
  };
}

function makeQueueService() {
  return {
    enqueueDealDelivered: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ShipmentsService — milestone evidence (#996)', () => {
  let service: ShipmentsService;
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: getRepositoryToken(ShipmentMilestone), useValue: { find: jest.fn(), findOne: jest.fn() } },
        { provide: getRepositoryToken(TradeDeal), useValue: { findOne: jest.fn().mockResolvedValue({ id: DEAL_ID }) } },
        { provide: 'StellarService', useValue: makeStellalService() },
        { provide: 'QueueService', useValue: makeQueueService() },
        {
          provide: 'nestjs-pino/PinoLogger',
          useValue: { setContext: jest.fn(), info: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        {
          provide: 'ConfigService',
          useValue: { get: jest.fn().mockReturnValue('platform-secret') },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn().mockImplementation(async (cb: Function) => cb(makeManager())),
          },
        },
      ],
    }).compile();

    service = module.get(ShipmentsService);
    dataSource = module.get(DataSource) as any;
  });

  it('stores evidence document ids when provided', async () => {
    const managerSaveSpy = jest.fn().mockImplementation(async (e) => ({ id: 'ms-uuid', ...e }));
    const managerCreateSpy = jest.fn().mockImplementation((_, data) => data);
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(makeManager({ save: managerSaveSpy, create: managerCreateSpy })),
    );

    const dto: CreateMilestoneDto = {
      trade_deal_id: DEAL_ID,
      milestone: 'farm',
      notes: 'Collected at farm',
      evidence: ['doc-uuid-1', 'doc-uuid-2'],
      location: { lat: 5.6037, lng: -0.187 },
    };

    await service.recordMilestone(TRADER_ID, dto);

    expect(managerCreateSpy).toHaveBeenCalledWith(
      ShipmentMilestone,
      expect.objectContaining({
        evidenceDocumentIds: ['doc-uuid-1', 'doc-uuid-2'],
        latitude: 5.6037,
        longitude: -0.187,
      }),
    );
  });

  it('stores null evidenceDocumentIds when no evidence provided', async () => {
    const managerCreateSpy = jest.fn().mockImplementation((_, data) => data);
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(makeManager({ create: managerCreateSpy })),
    );

    const dto: CreateMilestoneDto = {
      trade_deal_id: DEAL_ID,
      milestone: 'farm',
    };

    await service.recordMilestone(TRADER_ID, dto);

    expect(managerCreateSpy).toHaveBeenCalledWith(
      ShipmentMilestone,
      expect.objectContaining({ evidenceDocumentIds: null }),
    );
  });

  it('prefers location.lat/lng over legacy top-level fields', async () => {
    const managerCreateSpy = jest.fn().mockImplementation((_, data) => data);
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(makeManager({ create: managerCreateSpy })),
    );

    const dto: CreateMilestoneDto = {
      trade_deal_id: DEAL_ID,
      milestone: 'farm',
      latitude: 1.0,   // legacy
      longitude: 2.0,  // legacy
      location: { lat: 5.6037, lng: -0.187 }, // structured — takes priority
    };

    await service.recordMilestone(TRADER_ID, dto);

    expect(managerCreateSpy).toHaveBeenCalledWith(
      ShipmentMilestone,
      expect.objectContaining({ latitude: 5.6037, longitude: -0.187 }),
    );
  });

  it('falls back to legacy lat/lng when location object is absent', async () => {
    const managerCreateSpy = jest.fn().mockImplementation((_, data) => data);
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(makeManager({ create: managerCreateSpy })),
    );

    const dto: CreateMilestoneDto = {
      trade_deal_id: DEAL_ID,
      milestone: 'farm',
      latitude: 1.23,
      longitude: 4.56,
    };

    await service.recordMilestone(TRADER_ID, dto);

    expect(managerCreateSpy).toHaveBeenCalledWith(
      ShipmentMilestone,
      expect.objectContaining({ latitude: 1.23, longitude: 4.56 }),
    );
  });

  it('rejects milestone out of sequence', async () => {
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(
        makeManager({
          find: jest.fn().mockResolvedValue([
            { milestone: 'farm', tradeDealId: DEAL_ID },
          ]),
        }),
      ),
    );

    await expect(
      service.recordMilestone(TRADER_ID, {
        trade_deal_id: DEAL_ID,
        milestone: 'port', // should be 'warehouse' next
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects when deal is not funded', async () => {
    dataSource.transaction.mockImplementation(async (cb: Function) =>
      cb(
        makeManager({
          findOne: jest.fn().mockResolvedValue({
            id: DEAL_ID,
            status: 'open',
            traderId: TRADER_ID,
          }),
        }),
      ),
    );

    await expect(
      service.recordMilestone(TRADER_ID, {
        trade_deal_id: DEAL_ID,
        milestone: 'farm',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
