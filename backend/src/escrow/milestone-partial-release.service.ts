import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { MilestoneReleaseRecord } from './entities/milestone-release-record.entity';
import { ShipmentMilestone, MilestoneType } from '../shipments/entities/shipment-milestone.entity';
import { StellarService } from '../stellar/stellar.service';
import { MilestoneType as ShipmentMilestoneType } from '../shipments/entities/shipment-milestone.entity';

/**
 * Service to manage milestone-based partial escrow releases.
 *
 * Rules:
 * 1. Each deal has optional milestone_release_pct (0-100)
 * 2. When a milestone completes, release (milestone_release_pct % of 98% pool) to farmer
 * 3. Cumulative releases MUST be ≤ 98%
 * 4. Milestone order: farm → warehouse → port → importer
 * 5. Each milestone released at most once (idempotent)
 * 6. On final deal completion, release remaining balance (capped at 98%)
 */
@Injectable()
export class MilestonePartialReleaseService {
  private readonly ESCROW_CAP = 98; // Always hold back 2% until final completion

  constructor(
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    @InjectRepository(MilestoneReleaseRecord)
    private readonly releaseRepo: Repository<MilestoneReleaseRecord>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    private readonly stellarService: StellarService,
    private readonly logger: PinoLogger,
  ) {
    (this.logger as any).setContext(MilestonePartialReleaseService.name);
  }

  /**
   * Called when a shipment milestone is recorded.
   * Checks if partial release should be triggered for this deal.
   */
  async onMilestoneRecorded(
    dealId: string,
    milestoneType: MilestoneType,
    qr?: QueryRunner,
  ): Promise<void> {
    const repo = qr ? qr.manager : this.dealRepo;
    const deal = await repo.findOne({
      where: { id: dealId },
      relations: ['farmer'],
    });

    if (!deal) {
      throw new NotFoundException(`Deal ${dealId} not found`);
    }

    // If no milestone release configured, skip
    if (!deal.milestoneReleasePct || deal.milestoneReleasePct === 0) {
      this.logger.debug(
        { dealId, milestoneType },
        `Milestone ${milestoneType} recorded but milestone_release_pct is 0; skipping partial release`,
      );
      return;
    }

    // Check if this milestone was already released
    const existing = await this.releaseRepo.findOne({
      where: { tradeDealId: dealId, milestoneType },
    });

    if (existing) {
      this.logger.warn(
        { dealId, milestoneType },
        `Milestone ${milestoneType} already released for deal ${dealId}; skipping duplicate`,
      );
      return;
    }

    // Calculate cumulative releases so far
    const previousReleases = await this.releaseRepo.find({
      where: { tradeDealId: dealId },
    });
    const cumulativeReleasedPct = previousReleases.reduce(
      (sum, r) => sum + r.releasePct,
      0,
    );

    // Validate cumulative does not exceed cap
    const totalPct = cumulativeReleasedPct + deal.milestoneReleasePct;
    if (totalPct > this.ESCROW_CAP) {
      this.logger.warn(
        { dealId, milestoneType, totalPct, cap: this.ESCROW_CAP },
        `Cannot release milestone ${milestoneType}: would exceed ${this.ESCROW_CAP}% cumulative cap`,
      );
      return;
    }

    // Calculate amount to release from the 98% pool
    const poolAmount = Number(deal.totalValue) * (this.ESCROW_CAP / 100);
    const releasedAmount = poolAmount * (deal.milestoneReleasePct / 100);

    this.logger.info(
      { dealId, milestoneType, releasedAmount, cumulativeReleasedPct: totalPct },
      `Releasing ${deal.milestoneReleasePct}% (${releasedAmount} USD) to farmer for milestone ${milestoneType}`,
    );

    // Record this release
    const releaseRecord = this.releaseRepo.create({
      tradeDealId: dealId,
      milestoneType,
      releasePct: deal.milestoneReleasePct,
      farmerAmountUsd: releasedAmount,
    });

    await this.releaseRepo.save(releaseRecord);
  }

  /**
   * Calculates total cumulative release percentage for a deal.
   * Returns the sum of all milestone releases.
   */
  async getCumulativeReleasedPct(dealId: string): Promise<number> {
    const records = await this.releaseRepo.find({
      where: { tradeDealId: dealId },
    });
    return records.reduce((sum, r) => sum + r.releasePct, 0);
  }

  /**
   * Validates that a deal's milestone release configuration is valid.
   * - Must be 0 or positive
   * - If applied to all 4 milestones, cumulative must not exceed 98%
   */
  validateMilestoneReleasePct(pct: number): {
    valid: boolean;
    error?: string;
  } {
    if (pct < 0 || pct > 100) {
      return { valid: false, error: 'Percentage must be between 0 and 100' };
    }

    // If applied to all 4 milestones (farm, warehouse, port, importer)
    const maxCumulativeIfAll = pct * 4;
    if (maxCumulativeIfAll > this.ESCROW_CAP) {
      return {
        valid: false,
        error: `Percentage too high: ${pct}% × 4 milestones = ${maxCumulativeIfAll}% exceeds ${this.ESCROW_CAP}% cap`,
      };
    }

    return { valid: true };
  }

  /**
   * Gets all milestone releases recorded for a deal.
   */
  async getReleaseRecords(dealId: string): Promise<MilestoneReleaseRecord[]> {
    return this.releaseRepo.find({
      where: { tradeDealId: dealId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Computes final settlement amount after all partial releases.
   * Returns: remaining balance from 98% pool (to be released on completion).
   */
  async calculateFinalSettlementAmount(dealId: string): Promise<number> {
    const deal = await this.dealRepo.findOne({ where: { id: dealId } });
    if (!deal) return 0;

    const cumulativeReleasedPct = await this.getCumulativeReleasedPct(dealId);
    const remainingPct = this.ESCROW_CAP - cumulativeReleasedPct;

    const poolAmount = Number(deal.totalValue) * (this.ESCROW_CAP / 100);
    return poolAmount * (remainingPct / 100);
  }

  /**
   * Milestone order for escrow cap validation (prevents random ordering).
   */
  getMilestoneOrder(): MilestoneType[] {
    return ['farm', 'warehouse', 'port', 'importer'];
  }

  /**
   * Gets the next expected milestone (first unreleased in sequence).
   */
  async getNextExpectedMilestone(dealId: string): Promise<MilestoneType | null> {
    const released = await this.releaseRepo.find({
      where: { tradeDealId: dealId },
    });
    const releasedTypes = released.map((r) => r.milestoneType);
    const order = this.getMilestoneOrder();

    for (const type of order) {
      if (!releasedTypes.includes(type)) {
        return type;
      }
    }

    return null; // All milestones released
  }
}
