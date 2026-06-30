import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import { TradeDealsService } from './trade-deals.service';

@Injectable()
export class TradeDealsCronService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly tradeDealsService: TradeDealsService,
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
      .andWhere('deal.delivery_date < :now', { now })
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
        await this.tradeDealsService.expireDeal(deal.id);
        this.logger.info({ dealId: deal.id }, 'Successfully expired deal');
      } catch (error) {
        this.logger.error(
          { dealId: deal.id, error: error.message },
          'Failed to expire deal',
        );
      }
    }
  }
}
