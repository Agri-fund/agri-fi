import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import { TradeDealsService } from './trade-deals.service';
import { RiskScoringService } from './risk-scoring.service';

@Injectable()
export class TradeDealsCronService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly tradeDealsService: TradeDealsService,
    private readonly riskScoringService: RiskScoringService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(TradeDealsCronService.name);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expireOverdueDeals(): Promise<void> {
    this.logger.info('Running cron job: expire overdue trade deals');

    const now = new Date();

    const overdueDeals = await this.tradeDealRepo
      .createQueryBuilder('deal')
      .where('deal.status = :status', { status: 'open' })
      .andWhere('COALESCE(deal.funding_deadline, deal.delivery_date) < :now', {
        now,
      })
      .andWhere(
        'deal.total_invested < COALESCE(deal.minimum_funding_target, deal.total_value)',
      )
      .getMany();

    if (overdueDeals.length === 0) {
      this.logger.info('No overdue deals found');
      return;
    }

    this.logger.info(
      { count: overdueDeals.length },
      `Found ${overdueDeals.length} overdue deal(s) to expire`,
    );

    for (const deal of overdueDeals) {
      try {
        await this.tradeDealsService.closeUnderfundedDeal(deal.id);
        this.logger.info({ dealId: deal.id }, 'Successfully closed underfunded deal');
      } catch (error) {
        this.logger.error(
          { dealId: deal.id, error: error.message },
          'Failed to expire deal',
        );
      }
    }
  }

  // #828 — Recalculate risk scores nightly for all active deals
  @Cron('0 2 * * *')
  async recalculateRiskScores(): Promise<void> {
    this.logger.info('Running nightly cron: recalculate risk scores');
    try {
      await this.riskScoringService.recalculateAll();
      this.logger.info('Nightly risk score recalculation complete');
    } catch (error: any) {
      this.logger.error(
        { error: error.message },
        'Nightly risk score recalculation failed',
      );
    }
  }
}
