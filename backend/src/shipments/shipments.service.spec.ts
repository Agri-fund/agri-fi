import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import {
  ShipmentMilestone,
  MilestoneType,
} from './entities/shipment-milestone.entity';
import { StellarService } from '../stellar/stellar.service';
import { ConfigService } from '@nestjs/config';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { QueueService } from '../queue/queue.service';
import { DataSource } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

let queueService: { enqueueDealDelivered: jest.Mock };
let dataSource: { transaction: jest.Mock };

const mockDeal = {
  id: 'deal-1',
  status: 'funded',
  traderId: 'trader-1',
  escrowSecretKey: 'escrow-secret',
};

const mockMilestone = (): ShipmentMilestone => ({
  id: 'milestone-1',
  tradeDealId: 'deal-1',
  milestone: 'farm' as MilestoneType,
  recordedBy: 'trader-1',
  notes: 'Goods received at farm',
  stellarTxId: 'stellar-tx-123',
  memoText: 'AGRIC:MILESTONE:deal1:farm:1700000000',
  recordedAt: new Date(),
});

describe('ShipmentsService', () => {
  let service: ShipmentsService;
  let milestoneRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    manager: { query: jest.Mock };
  };
  let stellarService: { recordMemo: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    milestoneRepo = {
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      manager: { query: jest.fn() },
    };
    stellarService = { recordMemo: jest.fn() };
    config = { get: jest.fn() };

    queueService = { enqueueDealDelivered: jest.fn() };

    dataSource = {
      transaction: jest.fn(async (cb) =>
        cb({
          findOne: jest.fn(),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: { findOne: jest.fn(), update: jest.fn() },
        },
        { provide: StellarService, useValue: stellarService },
        { provide: QueueService, useValue: queueService },
        { provide: ConfigService, useValue: config },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<ShipmentsService>(ShipmentsService);
  });

  describe('recordMilestone', () => {
    it('records first milestone (farm) for funded deal', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'farm' as MilestoneType,
        notes: 'Goods received at farm',
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue([]);
      milestoneRepo.create.mockReturnValue(mockMilestone());
      milestoneRepo.save.mockResolvedValue(mockMilestone());
      stellarService.recordMemo.mockResolvedValue('stellar-tx-123');

      const result = await service.recordMilestone('trader-1', dto);

      expect(milestoneRepo.create).toHaveBeenCalledWith(ShipmentMilestone, {
        tradeDealId: 'deal-1',
        milestone: 'farm',
        recordedBy: 'trader-1',
        notes: 'Goods received at farm',
        stellarTxId: 'stellar-tx-123',
        memoText: expect.stringMatching(/^AGRIC:MILESTONE:deal1:farm:\d+$/),
      });

      expect(result.milestone).toBe('farm');
    });

    it('enforces milestone sequence enforcement', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'port' as MilestoneType, // Trying to skip to port
        notes: 'Goods at port',
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue([
        { ...mockMilestone(), milestone: 'farm' },
      ]);

      await expect(service.recordMilestone('trader-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects out-of-order milestone with expected next milestone', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'port' as MilestoneType,
        notes: 'Goods at port',
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue([
        { ...mockMilestone(), milestone: 'farm' },
      ]);

      try {
        await service.recordMilestone('trader-1', dto);
      } catch (error) {
        expect(error.response.expected).toBe('warehouse'); // Next expected milestone
      }
    });

    it('transitions to delivered status on importer milestone', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'importer' as MilestoneType,
        notes: 'Goods delivered to importer',
      };

      // Mock existing milestones: farm, warehouse, port
      const existingMilestones = [
        { ...mockMilestone(), milestone: 'farm' },
        { ...mockMilestone(), milestone: 'warehouse' },
        { ...mockMilestone(), milestone: 'port' },
      ];

      const importerMilestone = { ...mockMilestone(), milestone: 'importer' };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue(existingMilestones);
      milestoneRepo.create.mockReturnValue(importerMilestone);
      milestoneRepo.save.mockResolvedValue(importerMilestone);
      stellarService.recordMemo.mockResolvedValue('stellar-tx-final');

      const result = await service.recordMilestone('trader-1', dto);

      expect(result.milestone).toBe('importer');
      expect(stellarService.recordMemo).toHaveBeenCalledWith(
        expect.stringContaining('AGRIC:MILESTONE:'),
        'escrow-secret',
        'hash',
      );
    });

    it('throws error when deal not found', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'non-existent',
        milestone: 'farm' as MilestoneType,
        notes: 'Goods received at farm',
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(null),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );

      await expect(service.recordMilestone('trader-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws error when deal not funded', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'farm' as MilestoneType,
        notes: 'Goods received at farm',
      };

      const unfundedDeal = { ...mockDeal, status: 'open' };
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(unfundedDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );

      await expect(service.recordMilestone('trader-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('throws error when user not assigned trader', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'farm' as MilestoneType,
        notes: 'Goods received at farm',
      };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );

      await expect(
        service.recordMilestone('other-trader', dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws error when all milestones already recorded', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'farm' as MilestoneType,
        notes: 'Duplicate milestone',
      };

      // All 4 milestones already recorded
      const allMilestones = [
        { ...mockMilestone(), milestone: 'farm' },
        { ...mockMilestone(), milestone: 'warehouse' },
        { ...mockMilestone(), milestone: 'port' },
        { ...mockMilestone(), milestone: 'importer' },
      ];

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue(allMilestones);

      await expect(service.recordMilestone('trader-1', dto)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('uses platform secret when escrow secret not available', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'farm' as MilestoneType,
        notes: 'Goods received at farm',
      };

      const dealWithoutSecret = { ...mockDeal, escrowSecretKey: null };
      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(dealWithoutSecret),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue([]);
      milestoneRepo.create.mockReturnValue(mockMilestone());
      milestoneRepo.save.mockResolvedValue(mockMilestone());
      stellarService.recordMemo.mockResolvedValue('stellar-tx-123');
      config.get.mockReturnValue('platform-secret');

      await service.recordMilestone('trader-1', dto);

      expect(stellarService.recordMemo).toHaveBeenCalledWith(
        expect.any(String),
        'platform-secret',
        'hash',
      );
    });

    it('anchors milestone on Stellar with correct memo format', async () => {
      const dto: CreateMilestoneDto = {
        trade_deal_id: 'deal-1',
        milestone: 'warehouse' as MilestoneType,
        notes: 'Goods moved to warehouse',
      };

      const existingMilestones = [{ ...mockMilestone(), milestone: 'farm' }];
      const warehouseMilestone = { ...mockMilestone(), milestone: 'warehouse' };

      (dataSource.transaction as jest.Mock).mockImplementation(async (cb) =>
        cb({
          findOne: jest.fn().mockResolvedValue(mockDeal),
          find: milestoneRepo.find,
          create: milestoneRepo.create,
          save: milestoneRepo.save,
          update: jest.fn(),
        }),
      );
      milestoneRepo.find.mockResolvedValue(existingMilestones);
      milestoneRepo.create.mockReturnValue(warehouseMilestone);
      milestoneRepo.save.mockResolvedValue(warehouseMilestone);
      stellarService.recordMemo.mockResolvedValue('stellar-tx-456');

      await service.recordMilestone('trader-1', dto);

      expect(stellarService.recordMemo).toHaveBeenCalledWith(
        expect.stringMatching(/^AGRIC:MILESTONE:deal1:warehouse:\d+$/),
        'escrow-secret',
        'hash',
      );
    });
  });
});
