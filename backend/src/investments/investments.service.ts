import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { TradeDeal, TradeDealStatus } from '../trade-deals/entities/trade-deal.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly stellarService: StellarService,
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
  ) {}

  async createInvestment(
    investorId: string,
    dto: CreateInvestmentDto,
  ): Promise<Investment> {
    // Load the trade deal
    const tradeDeal = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });

    if (!tradeDeal) {
      throw new NotFoundException('Trade deal not found.');
    }

    // Only open deals can be invested in
    if (tradeDeal.status !== 'open') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_OPEN',
        message: 'Only open deals can be invested in.',
      });
    }

    // Check if investor has KYC verified (assuming this is stored in user entity)
    // This would need to be implemented based on the user verification system

    // Check token availability
    const currentInvestments = await this.investmentRepo.find({
      where: { tradeDealId: dto.tradeDealId, status: InvestmentStatus.CONFIRMED },
    });

    const totalTokensInvested = currentInvestments.reduce(
      (sum, inv) => sum + inv.tokenAmount,
      0,
    );

    const availableTokens = tradeDeal.tokenCount - totalTokensInvested;

    if (dto.tokenAmount > availableTokens) {
      throw new UnprocessableEntityException({
        code: 'INSUFFICIENT_TOKENS',
        message: `Only ${availableTokens} tokens available for investment.`,
      });
    }

    // Check for over-funding
    const totalInvested = currentInvestments.reduce(
      (sum, inv) => sum + Number(inv.amountUsd),
      0,
    );

    if (totalInvested + dto.amountUsd > Number(tradeDeal.totalValue)) {
      throw new UnprocessableEntityException({
        code: 'OVER_FUNDING',
        message: 'Investment would exceed the total deal value.',
      });
    }

    // Create pending investment
    const investment = this.investmentRepo.create({
      tradeDealId: dto.tradeDealId,
      investorId,
      tokenAmount: dto.tokenAmount,
      amountUsd: dto.amountUsd,
      status: InvestmentStatus.PENDING,
    });

    return this.investmentRepo.save(investment);
  }

  async confirmInvestment(
    investmentId: string,
    stellarTxId: string,
  ): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['tradeDeal'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }

    if (investment.status !== InvestmentStatus.PENDING) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Only pending investments can be confirmed.',
      });
    }

    const tradeDeal = investment.tradeDeal;
    let becameFunded = false;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Investment, investmentId, {
        status: InvestmentStatus.CONFIRMED,
        stellarTxId,
      });

      const confirmedInvestments = await manager.find(Investment, {
        where: { tradeDealId: tradeDeal.id, status: InvestmentStatus.CONFIRMED },
      });

      const newTotalInvested = confirmedInvestments.reduce(
        (sum, inv) => sum + Number(inv.amountUsd),
        0,
      );

      await manager.update(TradeDeal, tradeDeal.id, { totalInvested: newTotalInvested });

      if (newTotalInvested >= Number(tradeDeal.totalValue)) {
        const result = await manager.update(
          TradeDeal,
          { id: tradeDeal.id, status: 'open' as TradeDealStatus },
          { status: 'funded' as TradeDealStatus },
        );
        becameFunded = (result.affected ?? 0) > 0;
      }
    });

    if (becameFunded) {
      this.sendFundedNotification(tradeDeal).catch(() => {});
    }

    investment.status = InvestmentStatus.CONFIRMED;
    investment.stellarTxId = stellarTxId;
    return investment;
  }

  private async sendFundedNotification(tradeDeal: TradeDeal): Promise<void> {
    const confirmedInvestments = await this.investmentRepo.find({
      where: { tradeDealId: tradeDeal.id, status: InvestmentStatus.CONFIRMED },
      relations: ['investor'],
    });

    const investors = confirmedInvestments.map((inv) => ({
      email: inv.investor.email,
      tokenAmount: inv.tokenAmount,
    }));

    await this.queueService.enqueueDealFunded({
      tradeDealId: tradeDeal.id,
      commodity: tradeDeal.commodity,
      totalValue: Number(tradeDeal.totalValue),
      investors,
    });
  }

  async fundEscrow(
    investmentId: string,
    investorWalletAddress: string,
  ): Promise<{ stellarTxId: string }> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['tradeDeal'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }

    if (investment.status !== InvestmentStatus.PENDING) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Only pending investments can be funded.',
      });
    }

    if (!investment.tradeDeal.escrowPublicKey) {
      throw new UnprocessableEntityException({
        code: 'NO_ESCROW_ACCOUNT',
        message: 'Trade deal does not have an escrow account.',
      });
    }

    // Fund the escrow account via Stellar
    const stellarTxId = await this.stellarService.fundEscrow(
      investment.tradeDeal.escrowPublicKey,
      investorWalletAddress,
      investment.amountUsd.toString(),
    );

    // Auto-confirm the investment after successful funding
    await this.confirmInvestment(investmentId, stellarTxId);

    return { stellarTxId };
  }

  async getInvestmentsByTradeDeal(tradeDealId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { tradeDealId },
      relations: ['investor'],
      order: { createdAt: 'DESC' },
    });
  }

  async getInvestmentsByInvestor(investorId: string): Promise<Investment[]> {
    return this.investmentRepo.find({
      where: { investorId },
      relations: ['tradeDeal'],
      order: { createdAt: 'DESC' },
    });
  }
}
