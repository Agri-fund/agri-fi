import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import {
  TradeDeal,
  TradeDealStatus,
} from '../trade-deals/entities/trade-deal.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQuery,
  toPaginatedResult,
} from '../common/pagination';

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
    return this.dataSource.transaction(async (manager) => {
      // Load and lock the trade deal
      const tradeDeal = await manager.findOne(TradeDeal, {
        where: { id: dto.tradeDealId },
        lock: { mode: 'pessimistic_write' },
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

      // Check token availability (within transaction lock)
      const currentInvestments = await manager.find(Investment, {
        where: {
          tradeDealId: dto.tradeDealId,
          status: InvestmentStatus.CONFIRMED,
        },
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

      // Create pending investment within the locked transaction
      const investment = manager.create(Investment, {
        tradeDealId: dto.tradeDealId,
        investorId,
        tokenAmount: dto.tokenAmount,
        amountUsd: dto.amountUsd,
        status: InvestmentStatus.PENDING,
        complianceData: dto.complianceData ?? null,
      });

      return manager.save(investment);
    });
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

    // Update investment status
    investment.status = InvestmentStatus.CONFIRMED;
    investment.stellarTxId = stellarTxId;

    await this.investmentRepo.save(investment);

    // Update total invested on the trade deal using confirmed investments sum
    const tradeDeal = investment.tradeDeal;
    let becameFunded = false;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Investment, investmentId, {
        status: InvestmentStatus.CONFIRMED,
        stellarTxId,
      });

      const confirmedInvestments = await manager.find(Investment, {
        where: {
          tradeDealId: tradeDeal.id,
          status: InvestmentStatus.CONFIRMED,
        },
      });

      const newTotalInvested = confirmedInvestments.reduce(
        (sum, inv) => sum + Number(inv.amountUsd),
        0,
      );

      await manager.update(TradeDeal, tradeDeal.id, {
        totalInvested: newTotalInvested,
      });

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

  async markInvestmentFailed(investmentId: string): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.FAILED,
    });
  }

  async fundEscrow(
    investmentId: string,
    investorWalletAddress: string,
    signedXdr?: string,
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

    const deal = investment.tradeDeal;

    if (!deal.escrowPublicKey) {
      throw new UnprocessableEntityException({
        code: 'NO_ESCROW_ACCOUNT',
        message: 'Trade deal does not have an escrow account.',
      });
    }

    // If a signed XDR is provided (investor signed via Freighter), enqueue async job
    if (signedXdr) {
      await this.queueService.enqueueInvestmentFund({
        investmentId,
        signedXdr,
        escrowPublicKey: deal.escrowPublicKey,
        encryptedEscrowSecret: deal.escrowSecretKey ?? '',
        assetCode: deal.tokenSymbol,
        tokenAmount: investment.tokenAmount,
        investorWallet: investorWalletAddress,
        amountUsd: Number(investment.amountUsd),
      });
      // Return a placeholder — actual txId will be set when job completes
      return { stellarTxId: 'queued' };
    }

    // Synchronous path (backend-signed, used in tests / MVP fallback)
    const stellarTxId = await this.stellarService.fundEscrow(
      deal.escrowPublicKey,
      investorWalletAddress,
      investment.amountUsd.toString(),
      deal.escrowSecretKey ?? undefined,
      deal.tokenSymbol,
      investment.tokenAmount,
    );

    await this.confirmInvestment(investmentId, stellarTxId);

    return { stellarTxId };
  }

  private async sendFundedNotification(tradeDeal: TradeDeal): Promise<void> {
    try {
      const investments = await this.investmentRepo.find({
        where: {
          tradeDealId: tradeDeal.id,
          status: InvestmentStatus.CONFIRMED,
        },
        relations: ['investor'],
      });
      await this.queueService.enqueueDealFunded({
        tradeDealId: tradeDeal.id,
        commodity: tradeDeal.commodity,
        totalValue: Number(tradeDeal.totalValue),
        investors: investments.map((inv) => ({
          email: inv.investor?.email ?? '',
          tokenAmount: inv.tokenAmount,
        })),
      });
    } catch (err) {
      // non-critical — log and swallow
    }
  }

  async getInvestmentsByTradeDeal(
    tradeDealId: string,
    query: PaginationQuery = {},
  ): Promise<PaginatedResult<Investment>> {
    const { page, limit, skip } = normalizePagination(query);
    const [data, total] = await this.investmentRepo.findAndCount({
      where: { tradeDealId },
      relations: ['investor'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return toPaginatedResult(data, total, page, limit);
  }

  async getInvestmentsByInvestor(
    investorId: string,
    query: PaginationQuery = {},
  ): Promise<PaginatedResult<Investment>> {
    const { page, limit, skip } = normalizePagination(query);
    const [data, total] = await this.investmentRepo.findAndCount({
      where: { investorId },
      relations: ['tradeDeal'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return toPaginatedResult(data, total, page, limit);
  }
}
