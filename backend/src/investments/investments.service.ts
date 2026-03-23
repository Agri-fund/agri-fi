import {
  Injectable,
  ForbiddenException,
  UnprocessableEntityException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Investment } from '../users/entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';

const TOKEN_PRICE_USD = 100;

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly dealRepo: Repository<TradeDeal>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateInvestmentDto, investor: User): Promise<Investment> {
    if (investor.role !== 'investor') {
      throw new ForbiddenException('Only investors can fund trade deals.');
    }

    return this.dataSource.transaction(async (manager) => {
      // Lock the deal row to prevent concurrent over-allocation
      const deal = await manager
        .getRepository(TradeDeal)
        .createQueryBuilder('deal')
        .setLock('pessimistic_write')
        .where('deal.id = :id', { id: dto.trade_deal_id })
        .getOne();

      if (!deal) {
        throw new NotFoundException('Trade deal not found.');
      }

      if (deal.status !== 'open') {
        throw new UnprocessableEntityException('Trade deal is not open for investment.');
      }

      // Sum confirmed token allocations
      const { confirmedTokens } = await manager
        .getRepository(Investment)
        .createQueryBuilder('inv')
        .select('COALESCE(SUM(inv.tokenAmount), 0)', 'confirmedTokens')
        .where('inv.tradeDealId = :id', { id: dto.trade_deal_id })
        .andWhere("inv.status = 'confirmed'")
        .getRawOne<{ confirmedTokens: string }>();

      const available = deal.tokenCount - Number(confirmedTokens);

      if (dto.token_amount > available) {
        throw new BadRequestException(
          `Only ${available} token(s) available for this deal.`,
        );
      }

      const investment = manager.getRepository(Investment).create({
        tradeDealId: dto.trade_deal_id,
        investorId: investor.id,
        tokenAmount: dto.token_amount,
        amountUsd: dto.token_amount * TOKEN_PRICE_USD,
        status: 'pending',
      });

      return manager.getRepository(Investment).save(investment);
    });
  }
}
