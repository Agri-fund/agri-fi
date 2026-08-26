import { SettlementService } from './settlement.service';
import { SorobanService } from '../soroban/soroban.service';
import { StellarService } from '../stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ConfigService } from '@nestjs/config';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';

describe('SettlementService', () => {
  let service: SettlementService;
  let dealRepo: { findOne: jest.Mock; save: jest.Mock };
  let documentRepo: { findOne: jest.Mock };
  let sorobanService: { settleCampaign: jest.Mock };
  let stellarService: { getVerificationUrl: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };
  let config: { get: jest.Mock };

  const baseDeal: TradeDeal = {
    id: 'deal-1',
    commodity: 'Maize',
    quantity: 10000,
    settlementStatus: 'pending',
  } as TradeDeal;

  const harvestDoc: Document = {
    id: 'doc-1',
    tradeDealId: 'deal-1',
    docType: 'harvest_completion',
    signatureVerified: true,
    metadata: { harvestAmount: 12000, qualityGrade: 90 },
  } as Document;

  beforeEach(() => {
    dealRepo = { findOne: jest.fn(), save: jest.fn().mockImplementation((d) => d) };
    documentRepo = { findOne: jest.fn() };
    sorobanService = { settleCampaign: jest.fn().mockResolvedValue('tx-hash-abc') };
    stellarService = { getVerificationUrl: jest.fn().mockReturnValue('https://stellar.expert/tx/abc') };
    notificationsService = { sendEmail: jest.fn() };
    config = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'FARM_CAMPAIGN_SETTLEMENT_CONTRACT') return 'CSETTLEMENT123';
        return def;
      }),
    };

    service = new SettlementService(
      dealRepo as any,
      documentRepo as any,
      sorobanService as unknown as SorobanService,
      stellarService as unknown as StellarService,
      notificationsService as unknown as NotificationsService,
      config as unknown as ConfigService,
    );
  });

  it('triggers settlement when harvest document is approved', async () => {
    dealRepo.findOne.mockResolvedValue({ ...baseDeal });

    const result = await service.onDocumentApproved(harvestDoc);

    expect(sorobanService.settleCampaign).toHaveBeenCalledWith(
      'CSETTLEMENT123',
      'deal-1',
      12000,
      90,
    );
    expect(result?.settlementStatus).toBe('settled');
    expect(result?.settlementTxHash).toBe('tx-hash-abc');
  });

  it('is idempotent — duplicate triggers do not re-settle', async () => {
    dealRepo.findOne.mockResolvedValue({ ...baseDeal, settlementStatus: 'settled' });

    const result = await service.onDocumentApproved(harvestDoc);

    expect(sorobanService.settleCampaign).not.toHaveBeenCalled();
    expect(result?.settlementStatus).toBe('settled');
  });

  it('skips settlement when signature is not verified', async () => {
    const result = await service.onDocumentApproved({
      ...harvestDoc,
      signatureVerified: false,
    });

    expect(result).toBeNull();
    expect(sorobanService.settleCampaign).not.toHaveBeenCalled();
  });

  it('marks deal as settlement_failed on contract error', async () => {
    dealRepo.findOne.mockResolvedValue({ ...baseDeal });
    sorobanService.settleCampaign.mockRejectedValue(new Error('Contract rejected'));

    await expect(service.onDocumentApproved(harvestDoc)).rejects.toThrow('Contract rejected');
    expect(dealRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ settlementStatus: 'settlement_failed' }),
    );
    expect(notificationsService.sendEmail).toHaveBeenCalled();
  });
});
