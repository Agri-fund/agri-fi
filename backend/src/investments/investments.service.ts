import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import {
  TradeDeal,
  TradeDealStatus,
} from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import {
  normalizePagination,
  PaginatedResult,
  PaginationQuery,
  toPaginatedResult,
} from '../common/pagination';

export interface CreateInvestmentResult {
  investment: Investment;
  unsignedXdr: string;
}

const STELLAR_TX_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TRAVEL_RULE_THRESHOLD_USD = 1000;

type TravelRuleParty = {
  name?: unknown;
  address?: unknown;
  accountNumber?: unknown;
};

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stellarService: StellarService,
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
  ) {}

  async createInvestment(
    investorId: string,
    dto: CreateInvestmentDto,
  ): Promise<CreateInvestmentResult> {
    this.assertTravelRuleCompliance(dto.amountUsd, dto.complianceData);

    // Load investor to get their wallet address for the XDR
    const investor = await this.userRepo.findOne({ where: { id: investorId } });
    if (!investor) {
      throw new NotFoundException('Investor not found.');
    }
    if (!investor.walletAddress) {
      throw new UnprocessableEntityException({
        code: 'NO_WALLET_ADDRESS',
        message:
          'Investor must link a Stellar wallet address before investing.',
      });
    }

    const investment = await this.dataSource.transaction(async (manager) => {
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

      if (!tradeDeal.escrowPublicKey) {
        throw new UnprocessableEntityException({
          code: 'NO_ESCROW_ACCOUNT',
          message: 'Trade deal does not have an escrow account yet.',
        });
      }

      if (!tradeDeal.issuerPublicKey) {
        throw new UnprocessableEntityException({
          code: 'NO_ISSUER_KEY',
          message: 'Trade deal does not have a token issuer configured.',
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
      const newInvestment = manager.create(Investment, {
        tradeDealId: dto.tradeDealId,
        investorId,
        tokenAmount: dto.tokenAmount,
        amountUsd: dto.amountUsd,
        status: InvestmentStatus.PENDING,
        complianceData: dto.complianceData ?? null,
      });

      return manager.save(newInvestment);
    });

    // Build the unsigned Stellar XDR outside the DB transaction
    // (network I/O should not hold a DB lock)
    const tradeDeal = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });

    const unsignedXdr = await this.stellarService.createInvestmentTransaction(
      investor.walletAddress,
      tradeDeal!.escrowPublicKey!,
      dto.amountUsd,
      tradeDeal!.tokenSymbol,
      dto.tokenAmount,
      tradeDeal!.issuerPublicKey!,
      dto.complianceData,
    );

    return { investment, unsignedXdr };
  }

  private assertTravelRuleCompliance(
    amountUsd: number,
    complianceData?: Record<string, unknown>,
  ): void {
    if (amountUsd <= TRAVEL_RULE_THRESHOLD_USD) return;

    const hasRequiredFields = (party: unknown): party is TravelRuleParty => {
      if (!party || typeof party !== 'object') return false;
      const { name, address, accountNumber } = party as TravelRuleParty;
      return [name, address, accountNumber].every(
        (field) => typeof field === 'string' && field.trim().length > 0,
      );
    };

    if (
      !hasRequiredFields(complianceData?.originator) ||
      !hasRequiredFields(complianceData?.beneficiary)
    ) {
      throw new BadRequestException({
        code: 'TRAVEL_RULE_DATA_REQUIRED',
        message:
          'Investments above $1,000 require originator and beneficiary name, address, and account number.',
      });
    }
  }

  async confirmInvestment(
    investorId: string,
    investmentId: string,
    stellarTxId: string,
  ): Promise<Investment> {
    if (!STELLAR_TX_HASH_PATTERN.test(stellarTxId)) {
      throw new BadRequestException({
        code: 'INVALID_STELLAR_TX_ID',
        message:
          'stellarTxId must be a 64-character hexadecimal Stellar transaction hash.',
      });
    }

    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
      relations: ['tradeDeal'],
    });

    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }

    if (investment.investorId !== investorId) {
      throw new ForbiddenException({
        code: 'NOT_INVESTMENT_OWNER',
        message: 'Only the investment owner can confirm this investment.',
      });
    }

    if (investment.status !== InvestmentStatus.PENDING) {
      throw new UnprocessableEntityException({
        code: 'INVALID_STATUS',
        message: 'Only pending investments can be confirmed.',
      });
    }

    // Update total invested on the trade deal using confirmed investments sum
    const tradeDeal = investment.tradeDeal;
    let becameFunded = false;

    await this.dataSource.transaction(async (manager) => {
      // Update investment status inside the transaction
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
        // Generate application trace ID for authorized update
        const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
        const result = await manager.update(
          TradeDeal,
          { id: tradeDeal.id, status: 'open' as TradeDealStatus },
          { status: 'funded' as TradeDealStatus, appTraceId },
        );
        becameFunded = (result.affected ?? 0) > 0;
      }
    });

    if (becameFunded) {
      this.sendFundedNotification(tradeDeal).catch(() => {});
    }

    // Return the updated investment by fetching it from the database
    const updatedInvestment = await this.investmentRepo.findOne({
      where: { id: investmentId },
    });
    return updatedInvestment!;
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
  ): Promise<{
    status: 'queued' | 'confirmed';
    investmentId: string;
    stellarTxId?: string;
  }> {
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
      // Return queued status — actual txId will be set when job completes
      return { status: 'queued', investmentId };
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

    await this.confirmInvestment(
      investment.investorId,
      investmentId,
      stellarTxId,
    );

    return { status: 'confirmed', investmentId, stellarTxId };
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
      relations: ['investor', 'tradeDeal'],
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
      relations: ['investor', 'tradeDeal'],
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return toPaginatedResult(data, total, page, limit);
  }
}
