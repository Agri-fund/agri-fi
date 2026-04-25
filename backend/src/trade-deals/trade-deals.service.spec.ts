import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { TradeDealsService } from './trade-deals.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Document } from './entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';

const mockFarmer = (): User => ({
  id: 'farmer-uuid',
  email: 'farmer@example.com',
  passwordHash: 'hash',
  role: 'farmer',
  country: 'NG',
  kycStatus: 'verified',
  walletAddress: 'GFARMER123',
  createdAt: new Date(),
});

const mockDeal = (): TradeDeal => ({
  id: 'deal-uuid',
  commodity: 'Cocoa',
  quantity: 1000,
  quantityUnit: 'kg',
  totalValue: 5000,
  tokenCount: 50,
  tokenSymbol: 'COCOAdeal',
  status: 'draft',
  farmerId: 'farmer-uuid',
  traderId: 'trader-uuid',
  farmer: mockFarmer(),
  trader: null as any,
  escrowPublicKey: null,
  escrowSecretKey: null,
  issuerPublicKey: null,
  totalInvested: 0,
  deliveryDate: new Date('2026-12-01'),
  stellarAssetTxId: null,
  documents: [],
  investments: [],
  createdAt: new Date(),
});

describe('TradeDealsService', () => {
  let service: TradeDealsService;
  let tradeDealRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let documentRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let milestoneRepo: { find: jest.Mock };
  let userRepo: { findOne: jest.Mock };
  let stellarService: {
    createEscrowAccount: jest.Mock;
    encryptSecret: jest.Mock;
    issueTradeToken: jest.Mock;
  };
  let logger: {
    setContext: jest.Mock;
    info: jest.Mock;
    error: jest.Mock;
  };

  beforeEach(async () => {
    tradeDealRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
    };
    documentRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    milestoneRepo = { find: jest.fn() };
    userRepo = { findOne: jest.fn() };
    stellarService = {
      createEscrowAccount: jest.fn(),
      encryptSecret: jest.fn(),
      issueTradeToken: jest.fn(),
    };
    logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeDealsService,
        { provide: getRepositoryToken(TradeDeal), useValue: tradeDealRepo },
        { provide: getRepositoryToken(Document), useValue: documentRepo },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: milestoneRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: StellarService, useValue: stellarService },
        { provide: PinoLogger, useValue: logger },
      ],
    }).compile();

    service = module.get<TradeDealsService>(TradeDealsService);
  });

  // ─── createDeal ───────────────────────────────────────────────────────────

  describe('createDeal', () => {
    const dto = {
      commodity: 'Cocoa',
      quantity: 1000,
      quantity_unit: 'kg' as const,
      total_value: 5000,
      farmer_id: 'farmer-uuid',
      delivery_date: '2026-12-01',
    };

    it('creates a draft trade deal with correct token count', async () => {
      const farmer = mockFarmer();
      userRepo.findOne.mockResolvedValue(farmer);
      const deal = { ...mockDeal(), id: 'new-uuid' };
      tradeDealRepo.create.mockReturnValue(deal);
      tradeDealRepo.save
        .mockResolvedValueOnce(deal)
        .mockResolvedValueOnce({ ...deal, tokenSymbol: 'COCOAnew-' });

      const result = await service.createDeal('trader-uuid', dto);

      expect(result.status).toBe('draft');
      expect(result.tokenCount).toBe(50); // floor(5000 / 100)
    });

    it('calculates token count as floor(total_value / 100)', async () => {
      userRepo.findOne.mockResolvedValue(mockFarmer());
      const deal = { ...mockDeal(), totalValue: 750, tokenCount: 7 };
      tradeDealRepo.create.mockReturnValue(deal);
      tradeDealRepo.save.mockResolvedValue(deal);

      const result = await service.createDeal('trader-uuid', {
        ...dto,
        total_value: 750,
      });

      expect(result.tokenCount).toBe(7); // floor(750 / 100)
    });

    it('throws NotFoundException when farmer not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.createDeal('trader-uuid', dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when farmer_id belongs to non-farmer role', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockFarmer(), role: 'trader' });

      await expect(service.createDeal('trader-uuid', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when total_value is less than 100', async () => {
      userRepo.findOne.mockResolvedValue(mockFarmer());

      await expect(
        service.createDeal('trader-uuid', { ...dto, total_value: 50 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── publishDeal ──────────────────────────────────────────────────────────

  describe('publishDeal', () => {
    const mockEscrowKeys = {
      publicKey: 'GESCROW123ABC',
      secretKey: 'SESCROW123ABC',
    };
    const mockTokenResult = {
      txId: 'stellar-tx-123',
      issuerPublicKey: 'GISSUER123ABC',
      issuerSecret: 'SISSUER123ABC',
    };

    beforeEach(() => {
      stellarService.createEscrowAccount.mockResolvedValue(mockEscrowKeys);
      stellarService.encryptSecret.mockReturnValue('encrypted-secret');
      stellarService.issueTradeToken.mockResolvedValue(mockTokenResult);
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });
    });

    it('successfully publishes a deal with Stellar integration', async () => {
      const deal = {
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      };
      tradeDealRepo.findOne.mockResolvedValue(deal);

      const result = await service.publishDeal('deal-uuid', 'trader-uuid');

      expect(stellarService.createEscrowAccount).toHaveBeenCalledWith(
        'deal-uuid',
      );
      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        mockEscrowKeys.secretKey,
      );
      expect(stellarService.issueTradeToken).toHaveBeenCalledWith(
        deal.tokenSymbol,
        mockEscrowKeys.publicKey,
        mockEscrowKeys.secretKey,
        deal.tokenCount,
      );
      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-uuid', {
        status: 'open',
        escrowPublicKey: mockEscrowKeys.publicKey,
        escrowSecretKey: 'encrypted-secret',
        issuerPublicKey: mockTokenResult.issuerPublicKey,
        stellarAssetTxId: mockTokenResult.txId,
      });
      expect(result.status).toBe('open');
      expect(result.escrowPublicKey).toBe(mockEscrowKeys.publicKey);
      expect(result.stellarAssetTxId).toBe(mockTokenResult.txId);
    });

    it('stores encrypted escrow secret, never plaintext', async () => {
      const deal = {
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      };
      tradeDealRepo.findOne.mockResolvedValue(deal);

      const result = await service.publishDeal('deal-uuid', 'trader-uuid');

      expect(stellarService.encryptSecret).toHaveBeenCalledWith(
        mockEscrowKeys.secretKey,
      );
      expect(result.escrowSecretKey).toBe('encrypted-secret');
      expect(result.escrowSecretKey).not.toBe(mockEscrowKeys.secretKey);
    });

    it('throws UnprocessableEntityException when Stellar escrow creation fails', async () => {
      const deal = {
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      };
      tradeDealRepo.findOne.mockResolvedValue(deal);
      stellarService.createEscrowAccount.mockRejectedValue(
        new Error('Stellar network error'),
      );

      await expect(
        service.publishDeal('deal-uuid', 'trader-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(tradeDealRepo.update).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when Stellar token issuance fails', async () => {
      const deal = {
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      };
      tradeDealRepo.findOne.mockResolvedValue(deal);
      stellarService.issueTradeToken.mockRejectedValue(
        new Error('Token issuance failed'),
      );

      await expect(
        service.publishDeal('deal-uuid', 'trader-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(tradeDealRepo.update).not.toHaveBeenCalled();
    });

    it('deal remains in draft status when Stellar operations fail', async () => {
      const deal = {
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      };
      tradeDealRepo.findOne.mockResolvedValue(deal);
      stellarService.createEscrowAccount.mockRejectedValue(
        new Error('Network error'),
      );

      await expect(
        service.publishDeal('deal-uuid', 'trader-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);

      // Verify deal status was not updated to 'open'
      expect(tradeDealRepo.update).not.toHaveBeenCalledWith(
        'deal-uuid',
        expect.objectContaining({
          status: 'open',
        }),
      );
    });

    it('throws UnprocessableEntityException when deal has no documents', async () => {
      tradeDealRepo.findOne.mockResolvedValue({ ...mockDeal(), documents: [] });

      await expect(
        service.publishDeal('deal-uuid', 'trader-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(stellarService.createEscrowAccount).not.toHaveBeenCalled();
    });

    it('throws UnprocessableEntityException when deal is not in draft status', async () => {
      tradeDealRepo.findOne.mockResolvedValue({
        ...mockDeal(),
        status: 'open',
        documents: [{ id: 'doc-1' }],
      });

      await expect(
        service.publishDeal('deal-uuid', 'trader-uuid'),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(stellarService.createEscrowAccount).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when deal does not exist', async () => {
      tradeDealRepo.findOne.mockResolvedValue(null);

      await expect(
        service.publishDeal('nonexistent', 'trader-uuid'),
      ).rejects.toThrow(NotFoundException);

      expect(stellarService.createEscrowAccount).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not the assigned trader', async () => {
      tradeDealRepo.findOne.mockResolvedValue({
        ...mockDeal(),
        documents: [{ id: 'doc-1' }],
      });

      await expect(
        service.publishDeal('deal-uuid', 'other-trader-uuid'),
      ).rejects.toThrow(ForbiddenException);

      expect(stellarService.createEscrowAccount).not.toHaveBeenCalled();
    });
  });

  // ─── updateDealStatus ─────────────────────────────────────────────────────

  describe('updateDealStatus', () => {
    it('transitions deal status to open', async () => {
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await service.updateDealStatus('deal-uuid', 'open', 'stellar-tx-123');

      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-uuid', {
        status: 'open',
        stellarAssetTxId: 'stellar-tx-123',
      });
    });

    it('updates status without stellarAssetTxId when not provided', async () => {
      tradeDealRepo.update.mockResolvedValue({ affected: 1 });

      await service.updateDealStatus('deal-uuid', 'failed');

      expect(tradeDealRepo.update).toHaveBeenCalledWith('deal-uuid', {
        status: 'failed',
      });
    });
  });

  // ─── addDocument ──────────────────────────────────────────────────────────

  describe('addDocument', () => {
    const baseDto = {
      tradeDealId: 'deal-uuid',
      uploaderId: 'trader-uuid',
      docType: 'bill_of_lading',
      ipfsHash: 'QmXyz123abc',
      storageUrl: 'https://ipfs.io/ipfs/QmXyz123abc',
    };

    it('saves a document with IPFS hash and returns it', async () => {
      tradeDealRepo.findOne.mockResolvedValue(mockDeal());
      const savedDoc = { id: 'doc-uuid', ...baseDto, stellarTxId: null };
      documentRepo.create.mockReturnValue(savedDoc);
      documentRepo.save.mockResolvedValue(savedDoc);

      const result = await service.addDocument(baseDto);

      expect(result.ipfsHash).toBe('QmXyz123abc');
      expect(documentRepo.save).toHaveBeenCalled();
    });

    it('stores the Stellar tx ID when provided', async () => {
      tradeDealRepo.findOne.mockResolvedValue(mockDeal());
      const dto = { ...baseDto, stellarTxId: 'stellar-tx-abc' };
      const savedDoc = { id: 'doc-uuid', ...dto };
      documentRepo.create.mockReturnValue(savedDoc);
      documentRepo.save.mockResolvedValue(savedDoc);

      const result = await service.addDocument(dto);

      expect(result.stellarTxId).toBe('stellar-tx-abc');
    });

    it('throws BadRequestException for invalid document type', async () => {
      await expect(
        service.addDocument({ ...baseDto, docType: 'invalid_type' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file size exceeds 10 MB', async () => {
      await expect(
        service.addDocument({
          ...baseDto,
          fileSizeBytes: 11 * 1024 * 1024, // 11 MB
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts file size exactly at the 10 MB limit', async () => {
      tradeDealRepo.findOne.mockResolvedValue(mockDeal());
      const dto = { ...baseDto, fileSizeBytes: 10 * 1024 * 1024 };
      const savedDoc = { id: 'doc-uuid', ...baseDto, stellarTxId: null };
      documentRepo.create.mockReturnValue(savedDoc);
      documentRepo.save.mockResolvedValue(savedDoc);

      await expect(service.addDocument(dto)).resolves.toBeDefined();
    });

    it('throws NotFoundException when trade deal does not exist', async () => {
      tradeDealRepo.findOne.mockResolvedValue(null);

      await expect(service.addDocument(baseDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('accepts all valid document types', async () => {
      const validTypes = [
        'purchase_agreement',
        'bill_of_lading',
        'export_certificate',
        'warehouse_receipt',
      ];

      for (const docType of validTypes) {
        tradeDealRepo.findOne.mockResolvedValue(mockDeal());
        const savedDoc = {
          id: 'doc-uuid',
          ...baseDto,
          docType,
          stellarTxId: null,
        };
        documentRepo.create.mockReturnValue(savedDoc);
        documentRepo.save.mockResolvedValue(savedDoc);

        await expect(
          service.addDocument({ ...baseDto, docType }),
        ).resolves.toBeDefined();
      }
    });
  });
});
