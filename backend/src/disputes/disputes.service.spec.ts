jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));
jest.mock('../escrow/escrow.service', () => ({
  EscrowService: class EscrowService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { Dispute, DisputeStatus } from './entities/dispute.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { DocumentsService } from '../documents/documents.service';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';

describe('DisputesService (#1387)', () => {
  let service: DisputesService;
  let disputeRepo: Record<string, jest.Mock>;
  let tradeDealRepo: Record<string, jest.Mock>;
  let investmentRepo: Record<string, jest.Mock>;
  let milestoneRepo: Record<string, jest.Mock>;
  let userRepo: Record<string, jest.Mock>;
  let documentsService: { handleUpload: jest.Mock };
  let escrowService: {
    releaseDisputedEscrowToFarmer: jest.Mock;
    refundDisputedEscrowToInvestors: jest.Mock;
  };
  let auditService: { logEvent: jest.Mock };
  let notificationsService: { createNotification: jest.Mock };
  let queueService: { emit: jest.Mock };
  let txManager: { create: jest.Mock; save: jest.Mock; update: jest.Mock };

  const dealId = '11111111-1111-4111-8111-111111111111';
  const investorId = '22222222-2222-4222-8222-222222222222';
  const adminId = '33333333-3333-4333-8333-333333333333';
  const disputeId = '44444444-4444-4444-8444-444444444444';

  const overdueDeliveryDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  beforeEach(async () => {
    disputeRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };
    tradeDealRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: dealId,
        status: 'funded',
        farmerId: 'farmer-1',
        traderId: 'trader-1',
        tokenSymbol: 'COCOA-001',
        deliveryDate: overdueDeliveryDate,
      }),
    };
    investmentRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'inv-1',
        tradeDealId: dealId,
        investorId,
      }),
    };
    milestoneRepo = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    userRepo = {
      find: jest.fn().mockResolvedValue([{ id: adminId }]),
    };

    documentsService = {
      handleUpload: jest.fn().mockResolvedValue({
        id: 'doc-1',
        storageUrl: 'https://ipfs.io/ipfs/QmEvidence123',
      }),
    };
    escrowService = {
      releaseDisputedEscrowToFarmer: jest.fn().mockResolvedValue(undefined),
      refundDisputedEscrowToInvestors: jest.fn().mockResolvedValue(undefined),
    };
    auditService = {
      logEvent: jest.fn().mockResolvedValue(null),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue(null),
    };
    queueService = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    txManager = {
      create: jest.fn((_, data) => ({
        id: disputeId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
      save: jest.fn((_, entity) => Promise.resolve(entity)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: getRepositoryToken(Dispute), useValue: disputeRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Investment), useValue: investmentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DocumentsService, useValue: documentsService },
        { provide: EscrowService, useValue: escrowService },
        { provide: AuditService, useValue: auditService },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: QueueService, useValue: queueService },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb) => cb(txManager)),
          },
        },
      ],
    }).compile();

    service = module.get<DisputesService>(DisputesService);
  });

  it('creates a dispute, sets deal status to DISPUTED, and logs audit event', async () => {
    const res = await service.createDispute(investorId, {
      deal_id: dealId,
      reason: 'Importer milestone missing after 14 days',
      evidence_urls: ['https://ipfs.io/ipfs/QmInitial'],
    });

    expect(res.status).toBe(DisputeStatus.OPEN);
    expect(res.deal_id).toBe(dealId);
    expect(txManager.update).toHaveBeenCalledWith(
      TradeDeal,
      dealId,
      expect.objectContaining({ status: 'DISPUTED' }),
    );
    expect(auditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.created' }),
    );
  });

  it('rejects dispute if 14 days have not elapsed since expected delivery date', async () => {
    tradeDealRepo.findOne.mockResolvedValueOnce({
      id: dealId,
      status: 'funded',
      deliveryDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    });

    await expect(
      service.createDispute(investorId, {
        deal_id: dealId,
        reason: 'Too early',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects dispute if importer milestone is already recorded', async () => {
    milestoneRepo.findOne.mockResolvedValueOnce({
      id: 'ms-1',
      milestone: 'importer',
    });

    await expect(
      service.createDispute(investorId, {
        deal_id: dealId,
        reason: 'Already delivered',
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects dispute from non-investor', async () => {
    investmentRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.createDispute(investorId, {
        deal_id: dealId,
        reason: 'Not my deal',
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('uploads evidence via DocumentsService and appends URL', async () => {
    disputeRepo.findOne.mockResolvedValueOnce({
      id: disputeId,
      dealId,
      raisedBy: investorId,
      status: DisputeStatus.OPEN,
      evidenceUrls: [],
      deal: { farmerId: 'farmer-1', traderId: 'trader-1' },
    });

    const mockFile = {
      originalname: 'receipt.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4'),
    } as Express.Multer.File;

    const updated = await service.uploadEvidence(
      disputeId,
      investorId,
      'investor',
      mockFile,
    );

    expect(documentsService.handleUpload).toHaveBeenCalledWith({
      file: mockFile,
      docType: 'dispute_evidence',
      tradeDealId: dealId,
      userId: investorId,
    });
    expect(updated.evidence_urls).toContain(
      'https://ipfs.io/ipfs/QmEvidence123',
    );
    expect(auditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.evidence_uploaded' }),
    );
  });

  it('resolves dispute in favor of farmer and releases escrow', async () => {
    disputeRepo.findOne.mockResolvedValueOnce({
      id: disputeId,
      dealId,
      raisedBy: investorId,
      status: DisputeStatus.UNDER_REVIEW,
      evidenceUrls: [],
    });

    const resolved = await service.resolveDispute(disputeId, adminId, {
      resolution: 'release_farmer',
      notes: 'Proof of delivery verified',
    });

    expect(escrowService.releaseDisputedEscrowToFarmer).toHaveBeenCalledWith(
      dealId,
    );
    expect(resolved.status).toBe(DisputeStatus.RESOLVED_FARMER);
    expect(auditService.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.resolved' }),
    );
  });

  it('resolves dispute in favor of investors and refunds escrow', async () => {
    disputeRepo.findOne.mockResolvedValueOnce({
      id: disputeId,
      dealId,
      raisedBy: investorId,
      status: DisputeStatus.UNDER_REVIEW,
      evidenceUrls: [],
    });

    const resolved = await service.resolveDispute(disputeId, adminId, {
      resolution: 'refund_investors',
      notes: 'Undelivered shipment confirmed',
    });

    expect(escrowService.refundDisputedEscrowToInvestors).toHaveBeenCalledWith(
      dealId,
    );
    expect(resolved.status).toBe(DisputeStatus.RESOLVED_INVESTOR);
  });

  it('nightly cron escalates unresolved disputes older than 14 days and sends alert', async () => {
    const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const oldDispute = {
      id: disputeId,
      dealId,
      raisedBy: investorId,
      status: DisputeStatus.OPEN,
      createdAt: oldDate,
    };
    disputeRepo.find.mockResolvedValueOnce([oldDispute]);

    const result = await service.checkFourteenDayDeadlines();

    expect(result).toEqual({ escalatedCount: 1, alertedCount: 1 });
    expect(oldDispute.status).toBe(DisputeStatus.ESCALATED);
    expect(queueService.emit).toHaveBeenCalledWith(
      'admin.alert',
      expect.objectContaining({
        type: 'dispute_14_day_unresolved',
        disputeId,
      }),
    );
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: adminId, type: 'alert' }),
    );
  });
});
