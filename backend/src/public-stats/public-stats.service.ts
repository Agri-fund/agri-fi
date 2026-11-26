import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import {
  MonthlyCapitalDeployedDto,
  PublicStatsResponseDto,
  TopCommodityStatDto,
} from './public-stats.dto';

export const PUBLIC_STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DEPLOYED_INVESTMENT_STATUSES: InvestmentStatus[] = [
  InvestmentStatus.CONFIRMED,
  InvestmentStatus.ACTIVE,
  InvestmentStatus.RELEASING,
  InvestmentStatus.COMPLETED,
];

const ACTIVE_DEAL_STATUSES = ['open', 'funded', 'delivered'];
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

@Injectable()
export class PublicStatsService {
  private cachedStats: PublicStatsResponseDto | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
  ) {}

  invalidateCache(): void {
    this.cachedStats = null;
    this.cachedAt = 0;
  }

  async getPublicStats(now = Date.now()): Promise<PublicStatsResponseDto> {
    if (this.cachedStats && now - this.cachedAt < PUBLIC_STATS_CACHE_TTL_MS) {
      return this.cachedStats;
    }

    const [
      totalDealsCompleted,
      activeDeals,
      totalCapitalDeployedUsd,
      avgYieldPct,
      onTimeDeliveryRate,
      top5Commodities,
      monthlyCapitalDeployed,
    ] = await Promise.all([
      this.tradeDealRepo.count({ where: { status: 'completed' } }),
      this.tradeDealRepo
        .createQueryBuilder('deal')
        .where('deal.status IN (:...statuses)', {
          statuses: ACTIVE_DEAL_STATUSES,
        })
        .getCount(),
      this.computeTotalCapitalDeployed(),
      this.computeAverageYield(),
      this.computeOnTimeDeliveryRate(),
      this.computeTop5Commodities(),
      this.computeMonthlyCapitalDeployed(new Date(now)),
    ]);

    const result: PublicStatsResponseDto = {
      total_deals_completed: totalDealsCompleted,
      active_deals: activeDeals,
      total_capital_deployed_usd: totalCapitalDeployedUsd,
      avg_yield_pct: avgYieldPct,
      on_time_delivery_rate: onTimeDeliveryRate,
      top_5_commodities: top5Commodities,
      monthly_capital_deployed: monthlyCapitalDeployed,
      cache_ttl_seconds: Math.round(PUBLIC_STATS_CACHE_TTL_MS / 1000),
      updated_at: new Date(now).toISOString(),
    };

    this.cachedStats = result;
    this.cachedAt = now;
    return result;
  }

  private async computeTotalCapitalDeployed(): Promise<number> {
    const raw = await this.investmentRepo
      .createQueryBuilder('inv')
      .select('COALESCE(SUM(inv.amountUsd), 0)', 'total')
      .where('inv.status IN (:...statuses)', {
        statuses: DEPLOYED_INVESTMENT_STATUSES,
      })
      .getRawOne<{ total?: string | number }>();

    return this.round2(Number(raw?.total ?? 0));
  }

  private async computeAverageYield(): Promise<number> {
    const raw = await this.tradeDealRepo
      .createQueryBuilder('deal')
      .select('COALESCE(AVG(deal.expectedRoi), 0)', 'avg')
      .where('deal.status IN (:...statuses)', {
        statuses: [...ACTIVE_DEAL_STATUSES, 'completed'],
      })
      .andWhere('deal.expectedRoi IS NOT NULL')
      .getRawOne<{ avg?: string | number }>();

    return this.round2(Number(raw?.avg ?? 0));
  }

  private async computeOnTimeDeliveryRate(): Promise<number> {
    const deliveredDeals = await this.tradeDealRepo
      .createQueryBuilder('deal')
      .select(['deal.id', 'deal.deliveryDate'])
      .where('deal.status IN (:...statuses)', {
        statuses: ['delivered', 'completed'],
      })
      .getMany();

    if (deliveredDeals.length === 0) {
      return 0;
    }

    const dealIds = deliveredDeals.map((d) => d.id);
    const importerMilestones = await this.milestoneRepo
      .createQueryBuilder('m')
      .select(['m.tradeDealId', 'm.recordedAt'])
      .where('m.tradeDealId IN (:...dealIds)', { dealIds })
      .andWhere('m.milestone = :milestone', { milestone: 'importer' })
      .getMany();

    const milestoneMap = new Map<string, Date>();
    for (const m of importerMilestones) {
      const existing = milestoneMap.get(m.tradeDealId);
      const recorded = new Date(m.recordedAt);
      if (!existing || recorded < existing) {
        milestoneMap.set(m.tradeDealId, recorded);
      }
    }

    let onTimeCount = 0;
    for (const deal of deliveredDeals) {
      const recordedAt = milestoneMap.get(deal.id);
      const deadline = new Date(deal.deliveryDate);
      // Allow up to end of deliveryDate UTC day
      deadline.setUTCHours(23, 59, 59, 999);
      if (!recordedAt || recordedAt.getTime() <= deadline.getTime()) {
        onTimeCount += 1;
      }
    }

    return this.round2((onTimeCount / deliveredDeals.length) * 100);
  }

  private async computeTop5Commodities(): Promise<TopCommodityStatDto[]> {
    const rows = await this.tradeDealRepo
      .createQueryBuilder('deal')
      .select('deal.commodity', 'commodity')
      .addSelect('COUNT(*)', 'dealCount')
      .addSelect('COALESCE(SUM(deal.totalInvested), 0)', 'totalVolumeUsd')
      .where('deal.status NOT IN (:...excluded)', {
        excluded: ['draft', 'canceled', 'failed'],
      })
      .groupBy('deal.commodity')
      .orderBy('COALESCE(SUM(deal.totalInvested), 0)', 'DESC')
      .limit(5)
      .getRawMany<{
        commodity: string;
        dealCount: string | number;
        totalVolumeUsd: string | number;
      }>();

    return rows.map((row) => ({
      commodity: row.commodity,
      deal_count: Number(row.dealCount ?? 0),
      total_volume_usd: this.round2(Number(row.totalVolumeUsd ?? 0)),
    }));
  }

  private async computeMonthlyCapitalDeployed(
    referenceDate: Date,
  ): Promise<MonthlyCapitalDeployedDto[]> {
    const months = this.buildLast12Months(referenceDate);
    const windowStart = new Date(
      Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth() - 11,
        1,
        0,
        0,
        0,
        0,
      ),
    );

    const rows = await this.investmentRepo
      .createQueryBuilder('inv')
      .select("TO_CHAR(DATE_TRUNC('month', inv.createdAt), 'YYYY-MM')", 'month')
      .addSelect('COALESCE(SUM(inv.amountUsd), 0)', 'capitalDeployedUsd')
      .addSelect('COUNT(DISTINCT inv.tradeDealId)', 'dealCount')
      .where('inv.status IN (:...statuses)', {
        statuses: DEPLOYED_INVESTMENT_STATUSES,
      })
      .andWhere('inv.createdAt >= :windowStart', { windowStart })
      .groupBy("DATE_TRUNC('month', inv.createdAt)")
      .orderBy("DATE_TRUNC('month', inv.createdAt)", 'ASC')
      .getRawMany<{
        month: string;
        capitalDeployedUsd: string | number;
        dealCount: string | number;
      }>();

    const byMonth = new Map(
      rows.map((row) => [
        row.month,
        {
          capital_deployed_usd: this.round2(
            Number(row.capitalDeployedUsd ?? 0),
          ),
          deal_count: Number(row.dealCount ?? 0),
        },
      ]),
    );

    return months.map(({ month, label }) => {
      const entry = byMonth.get(month);
      return {
        month,
        label,
        capital_deployed_usd: entry?.capital_deployed_usd ?? 0,
        deal_count: entry?.deal_count ?? 0,
      };
    });
  }

  private buildLast12Months(
    referenceDate: Date,
  ): Array<{ month: string; label: string }> {
    const months: Array<{ month: string; label: string }> = [];
    for (let offset = 11; offset >= 0; offset--) {
      const d = new Date(
        Date.UTC(
          referenceDate.getUTCFullYear(),
          referenceDate.getUTCMonth() - offset,
          1,
        ),
      );
      const year = d.getUTCFullYear();
      const monthIdx = d.getUTCMonth();
      const monthStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
      const label = `${MONTH_NAMES[monthIdx]} ${year}`;
      months.push({ month: monthStr, label });
    }
    return months;
  }

  private round2(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
