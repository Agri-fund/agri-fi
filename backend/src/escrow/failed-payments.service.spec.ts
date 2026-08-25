import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FailedPaymentsService } from './failed-payments.service';
import { TransactionLog } from './entities/transaction-log.entity';
import { QueueService } from '../queue/queue.service';

const mockTxLogRepo = () => ({
  findAndCount: jest.fn(),
  findOne: jest.fn(),
});

const mockQueueService = () => ({
  enqueueDealDelivered: jest.fn(),
});

describe('FailedPaymentsService', () => {
  let service: FailedPaymentsService;
  let txLogRepo: jest.Mocked<Repository<TransactionLog>>;
  let queueService: jest.Mocked<QueueService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FailedPaymentsService,
        { provide: getRepositoryToken(TransactionLog), useFactory: mockTxLogRepo },
        { provide: QueueService, useFactory: mockQueueService },
      ],
    }).compile();

    service = module.get<FailedPaymentsService>(FailedPaymentsService);
    txLogRepo = module.get(getRepositoryToken(TransactionLog));
    queueService = module.get(QueueService);
  });

  describe('getFailedPayments', () => {
    it('returns paginated failed transactions', async () => {
      const mockRows: Partial<TransactionLog>[] = [
        {
          id: 'tx-1',
          dealId: 'deal-1',
          userId: 'user-1',
          txHash: 'abc123',
          errorCode: 'TIMEOUT',
          createdAt: new Date('2024-01-01'),
          status: 'failed',
          deal: { id: 'deal-1', commodity: 'Cocoa' } as any,
        },
      ];

      txLogRepo.findAndCount.mockResolvedValue([mockRows as TransactionLog[], 1]);

      const result = await service.getFailedPayments(1, 20);

      expect(txLogRepo.findAndCount).toHaveBeenCalledWith({
        where: { status: 'failed' },
        relations: ['deal'],
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('tx-1');
      expect(result.data[0].dealCommodity).toBe('Cocoa');
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('caps limit at 100', async () => {
      txLogRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getFailedPayments(1, 500);
      expect(txLogRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('returns empty list when no failed transactions exist', async () => {
      txLogRepo.findAndCount.mockResolvedValue([[], 0]);
      const result = await service.getFailedPayments();
      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('getFailedPaymentById', () => {
    it('returns a failed transaction log', async () => {
      const mockLog: Partial<TransactionLog> = {
        id: 'tx-1',
        status: 'failed',
        dealId: 'deal-1',
      };
      txLogRepo.findOne.mockResolvedValue(mockLog as TransactionLog);

      const result = await service.getFailedPaymentById('tx-1');
      expect(result.id).toBe('tx-1');
    });

    it('throws NotFoundException when transaction does not exist', async () => {
      txLogRepo.findOne.mockResolvedValue(null);
      await expect(service.getFailedPaymentById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException for non-failed transactions', async () => {
      const mockLog: Partial<TransactionLog> = {
        id: 'tx-1',
        status: 'success',
      };
      txLogRepo.findOne.mockResolvedValue(mockLog as TransactionLog);
      await expect(service.getFailedPaymentById('tx-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('retryFailedPayment', () => {
    it('enqueues a deal.delivered event for the associated deal', async () => {
      const mockLog: Partial<TransactionLog> = {
        id: 'tx-1',
        status: 'failed',
        dealId: 'deal-abc',
        deal: null,
        user: null,
      };
      txLogRepo.findOne.mockResolvedValue(mockLog as TransactionLog);
      queueService.enqueueDealDelivered.mockResolvedValue(undefined);

      const result = await service.retryFailedPayment('tx-1');

      expect(queueService.enqueueDealDelivered).toHaveBeenCalledWith('deal-abc');
      expect(result).toEqual({ queued: true, dealId: 'deal-abc' });
    });

    it('throws BadRequestException when transaction has no associated deal', async () => {
      const mockLog: Partial<TransactionLog> = {
        id: 'tx-1',
        status: 'failed',
        dealId: null,
        deal: null,
        user: null,
      };
      txLogRepo.findOne.mockResolvedValue(mockLog as TransactionLog);

      await expect(service.retryFailedPayment('tx-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(queueService.enqueueDealDelivered).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when transaction does not exist', async () => {
      txLogRepo.findOne.mockResolvedValue(null);
      await expect(service.retryFailedPayment('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
