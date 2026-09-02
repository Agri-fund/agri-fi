import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { SorobanService } from '../soroban/soroban.service';
import { StellarService } from '../stellar/stellar.service';
import { NotificationsService } from '../notifications/notifications.service';

export type SettlementStatus =
  'pending' | 'settling' | 'settled' | 'settlement_failed';

const HARVEST_DOC_TYPES = ['harvest_completion', 'warehouse_receipt'] as const;

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    private readonly sorobanService: SorobanService,
    private readonly stellarService: StellarService,
    private readonly notificationsService: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Called when an admin approves a document. Triggers on-chain settlement
   * when the document is a verified harvest completion certificate.
   */
  async onDocumentApproved(document: Document): Promise<TradeDeal | null> {
    if (!document.signatureVerified) {
      this.logger.debug(
        { documentId: document.id },
        'Skipping settlement: signature not verified',
      );
      return null;
    }

    if (
      !HARVEST_DOC_TYPES.includes(
        document.docType as (typeof HARVEST_DOC_TYPES)[number],
      )
    ) {
      return null;
    }

    const deal = await this.dealRepo.findOne({
      where: { id: document.tradeDealId },
    });
    if (!deal) return null;

    // Idempotent: skip if already settled
    if (deal.settlementStatus === 'settled') {
      this.logger.info(
        { dealId: deal.id },
        'Settlement already completed — skipping',
      );
      return deal;
    }

    return this.settleCampaign(deal, document);
  }

  async settleCampaign(
    deal: TradeDeal,
    document?: Document,
  ): Promise<TradeDeal> {
    if (deal.settlementStatus === 'settled') {
      return deal;
    }

    const settlementContractId = this.config.get<string>(
      'FARM_CAMPAIGN_SETTLEMENT_CONTRACT',
      '',
    );
    if (!settlementContractId) {
      this.logger.warn(
        { dealId: deal.id },
        'Settlement contract not configured',
      );
      await this.markSettlementFailed(
        deal,
        'Settlement contract not configured',
      );
      return deal;
    }

    deal.settlementStatus = 'settling';
    await this.dealRepo.save(deal);

    const harvestAmount = this.extractHarvestAmount(document, deal);
    const qualityGrade = this.extractQualityGrade(document);

    try {
      const txHash = await this.sorobanService.settleCampaign(
        settlementContractId,
        deal.id,
        harvestAmount,
        qualityGrade,
      );

      deal.settlementStatus = 'settled';
      deal.settlementTxHash = txHash;
      deal.settlementHarvestAmount = harvestAmount;
      deal.settlementQualityGrade = qualityGrade;
      deal.settledAt = new Date();
      deal.status = 'completed';
      await this.dealRepo.save(deal);

      this.logger.info(
        { dealId: deal.id, txHash },
        'Campaign settled on-chain',
      );
      return deal;
    } catch (err: any) {
      this.logger.error(
        { dealId: deal.id, err: err.message },
        'Settlement failed',
      );
      await this.markSettlementFailed(deal, err.message);
      throw err;
    }
  }

  getSettlementExplorerUrl(txHash: string): string {
    return this.stellarService.getVerificationUrl(txHash);
  }

  private async markSettlementFailed(
    deal: TradeDeal,
    reason: string,
  ): Promise<void> {
    deal.settlementStatus = 'settlement_failed';
    await this.dealRepo.save(deal);

    await this.notificationsService.sendEmail(
      this.config.get<string>('ADMIN_ALERT_EMAIL', 'admin@agri-fi.com'),
      `Settlement Failed: Deal ${deal.id}`,
      `Deal settlement failed for ${deal.commodity}. Reason: ${reason}`,
      `<p>Deal settlement failed for ${deal.commodity}.</p><p>Reason: ${reason}</p>`,
    );
  }

  private extractHarvestAmount(
    document: Document | undefined,
    deal: TradeDeal,
  ): number {
    const meta = document?.metadata as Record<string, unknown> | undefined;
    if (meta?.harvestAmount != null) return Number(meta.harvestAmount);
    return Number(deal.quantity);
  }

  private extractQualityGrade(document: Document | undefined): number {
    const meta = document?.metadata as Record<string, unknown> | undefined;
    if (meta?.qualityGrade != null) return Number(meta.qualityGrade);
    return 100;
  }
}
