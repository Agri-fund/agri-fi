import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { TradeDealArchive } from './entities/trade-deal-archive.entity';
import { InvestmentArchive } from './entities/investment-archive.entity';
import { ShipmentMilestoneArchive } from './entities/shipment-milestone-archive.entity';

export interface ArchivalResult {
  dealsArchived: number;
  investmentsArchived: number;
  milestonesArchived: number;
}

export interface ValidationResult {
  valid: boolean;
  primaryCount: number;
  archiveCount: number;
  primaryHash: string;
  archiveHash: string;
}

const CLOSED_STATUSES = ['completed', 'failed', 'canceled', 'expired'];

@Injectable()
export class ArchivalService {
  private readonly logger = new Logger(ArchivalService.name);

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(TradeDealArchive)
    private readonly tradeDealArchiveRepo: Repository<TradeDealArchive>,
    @InjectRepository(InvestmentArchive)
    private readonly investmentArchiveRepo: Repository<InvestmentArchive>,
    @InjectRepository(ShipmentMilestoneArchive)
    private readonly milestoneArchiveRepo: Repository<ShipmentMilestoneArchive>,
    private readonly dataSource: DataSource,
    @Optional()
    @InjectMetric('archival_records_archived_total')
    private readonly archivedCounter?: Counter<string>,
    @Optional()
    @InjectMetric('archival_runs_total')
    private readonly runsCounter?: Counter<string>,
  ) {}

  /**
   * Calculates the cutoff date (e.g. 2 years ago).
   */
  getCutoffDate(yearsAgo: number = 2): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() - yearsAgo);
    return d;
  }

  /**
   * Copies closed deal records older than cutoff to archive tables and soft-deletes them from primary tables.
   */
  async copyToArchive(yearsCutoff: number = 2): Promise<ArchivalResult> {
    const cutoffDate = this.getCutoffDate(yearsCutoff);
    this.logger.log(
      `Starting archival for deals closed before ${cutoffDate.toISOString()}`,
    );

    let dealsArchived = 0;
    let investmentsArchived = 0;
    let milestonesArchived = 0;

    await this.dataSource.transaction(async (manager) => {
      // Find candidate trade deals
      const eligibleDeals = await manager.find(TradeDeal, {
        where: {
          status: In(CLOSED_STATUSES as any),
          createdAt: LessThan(cutoffDate),
        },
        withDeleted: true,
      });

      // Filter out deals that are already soft-deleted or archived
      const dealsToArchive = eligibleDeals.filter((d) => !d.deletedAt);
      if (dealsToArchive.length === 0) {
        this.logger.log('No eligible deals found for archival.');
        return;
      }

      const dealIds = dealsToArchive.map((d) => d.id);

      // Find associated investments and milestones
      const investments = await manager.find(Investment, {
        where: { tradeDealId: In(dealIds) },
        withDeleted: true,
      });

      const milestones = await manager.find(ShipmentMilestone, {
        where: { tradeDealId: In(dealIds) },
        withDeleted: true,
      });

      const now = new Date();

      // Copy deals to archive
      const dealArchives = dealsToArchive.map((deal) =>
        manager.create(TradeDealArchive, {
          id: deal.id,
          commodity: deal.commodity,
          quantity: deal.quantity,
          quantityUnit: deal.quantityUnit,
          totalValue: deal.totalValue,
          tokenCount: deal.tokenCount,
          tokenSymbol: deal.tokenSymbol,
          status: deal.status,
          farmerId: deal.farmerId,
          traderId: deal.traderId,
          escrowPublicKey: deal.escrowPublicKey,
          escrowSecretKey: deal.escrowSecretKey,
          issuerPublicKey: deal.issuerPublicKey,
          issuerSecretKey: deal.issuerSecretKey,
          totalInvested: deal.totalInvested,
          deliveryDate: deal.deliveryDate,
          stellarAssetTxId: deal.stellarAssetTxId,
          sorobanCampaignContractId: deal.sorobanCampaignContractId,
          sorobanFactoryTxHash: deal.sorobanFactoryTxHash,
          appTraceId: deal.appTraceId,
          createdAt: deal.createdAt,
          deletedAt: now,
        }),
      );
      await manager.save(TradeDealArchive, dealArchives);
      dealsArchived = dealArchives.length;

      // Copy investments to archive
      if (investments.length > 0) {
        const invArchives = investments.map((inv) =>
          manager.create(InvestmentArchive, {
            id: inv.id,
            tradeDealId: inv.tradeDealId,
            investorId: inv.investorId,
            tokenAmount: inv.tokenAmount,
            amountUsd: inv.amountUsd,
            stellarTxId: inv.stellarTxId,
            complianceData: inv.complianceData,
            status: inv.status,
            createdAt: inv.createdAt,
            deletedAt: now,
          }),
        );
        await manager.save(InvestmentArchive, invArchives);
        investmentsArchived = invArchives.length;
      }

      // Copy shipment milestones to archive
      if (milestones.length > 0) {
        const milestoneArchives = milestones.map((m) =>
          manager.create(ShipmentMilestoneArchive, {
            id: m.id,
            tradeDealId: m.tradeDealId,
            milestone: m.milestone,
            recordedBy: m.recordedBy,
            notes: m.notes,
            stellarTxId: m.stellarTxId,
            memoText: m.memoText,
            latitude: m.latitude,
            longitude: m.longitude,
            recordedAt: m.recordedAt,
            deletedAt: now,
          }),
        );
        await manager.save(ShipmentMilestoneArchive, milestoneArchives);
        milestonesArchived = milestoneArchives.length;
      }

      // Soft-delete records from primary tables
      await manager.update(TradeDeal, { id: In(dealIds) }, { deletedAt: now });
      if (investments.length > 0) {
        await manager.update(
          Investment,
          { id: In(investments.map((i) => i.id)) },
          { deletedAt: now },
        );
      }
      if (milestones.length > 0) {
        await manager.update(
          ShipmentMilestone,
          { id: In(milestones.map((m) => m.id)) },
          { deletedAt: now },
        );
      }
    });

    this.logger.log(
      `Archival complete: ${dealsArchived} deals, ${investmentsArchived} investments, ${milestonesArchived} milestones archived.`,
    );

    if (this.archivedCounter) {
      this.archivedCounter.inc({ table: 'trade_deals' }, dealsArchived);
      this.archivedCounter.inc({ table: 'investments' }, investmentsArchived);
      this.archivedCounter.inc(
        { table: 'shipment_milestones' },
        milestonesArchived,
      );
    }
    if (this.runsCounter) {
      this.runsCounter.inc({ status: 'success' });
    }

    return { dealsArchived, investmentsArchived, milestonesArchived };
  }

  /**
   * Checksum validation comparing row counts and hash of archived records vs primary records.
   */
  async validateArchive(yearsCutoff: number = 2): Promise<ValidationResult> {
    const cutoffDate = this.getCutoffDate(yearsCutoff);

    // Fetch primary soft-deleted deals older than cutoff
    const primaryDeals = await this.tradeDealRepo.find({
      where: { createdAt: LessThan(cutoffDate) },
      withDeleted: true,
      order: { id: 'ASC' },
    });
    const softDeletedDeals = primaryDeals.filter((d) => d.deletedAt !== null);

    const archiveDeals = await this.tradeDealArchiveRepo.find({
      order: { id: 'ASC' },
    });

    const primaryIds = softDeletedDeals.map((d) => d.id).sort();
    const archiveIds = archiveDeals.map((d) => d.id).sort();

    const primaryHash = createHash('sha256')
      .update(primaryIds.join(','))
      .digest('hex');
    const archiveHash = createHash('sha256')
      .update(archiveIds.join(','))
      .digest('hex');

    const countMatches = primaryIds.length === archiveIds.length;
    const hashMatches = primaryHash === archiveHash;
    const valid = countMatches && hashMatches;

    this.logger.log(
      `Archive validation: valid=${valid}, primaryCount=${primaryIds.length}, archiveCount=${archiveIds.length}`,
    );

    return {
      valid,
      primaryCount: primaryIds.length,
      archiveCount: archiveIds.length,
      primaryHash,
      archiveHash,
    };
  }

  /**
   * Hard deletes soft-deleted records from primary tables after 30 days of validation.
   */
  async hardDeleteValidatedArchives(
    daysSoftDeletedCutoff: number = 30,
  ): Promise<number> {
    const validation = await this.validateArchive();
    if (!validation.valid) {
      this.logger.error('Archive validation failed. Hard delete aborted.');
      throw new Error('Archive checksum validation failed before hard delete.');
    }

    const deleteCutoff = new Date();
    deleteCutoff.setDate(deleteCutoff.getDate() - daysSoftDeletedCutoff);

    // Find primary records soft-deleted before deleteCutoff
    const dealsToHardDelete = await this.tradeDealRepo.find({
      where: { deletedAt: LessThan(deleteCutoff) },
      withDeleted: true,
    });

    if (dealsToHardDelete.length === 0) {
      this.logger.log('No soft-deleted records eligible for hard delete.');
      return 0;
    }

    const dealIds = dealsToHardDelete.map((d) => d.id);

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM "shipment_milestones" WHERE trade_deal_id = ANY($1)`,
        [dealIds],
      );
      await manager.query(
        `DELETE FROM "investments" WHERE trade_deal_id = ANY($1)`,
        [dealIds],
      );
      await manager.query(`DELETE FROM "trade_deals" WHERE id = ANY($1)`, [
        dealIds,
      ]);
    });

    this.logger.log(
      `Hard deleted ${dealIds.length} trade deals and associated records from primary tables.`,
    );
    return dealIds.length;
  }
}
