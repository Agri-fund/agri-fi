import {
  Injectable,
  Optional,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { FeeCalculatorService, FeeBreakdown } from './fee-calculator.service';
import { validateLotSize } from './lot-size.utils';
import { encodeFeeData, generateInvestmentMemo } from './fee-transaction.utils';
import { EmailSequenceService } from '../email-sequence/email-sequence.service';
import { InvestmentEventStore } from './investment-event-store.service';
import { OfacSanctionsCheckService } from '../auth/utils/ofac-sanctions-check';

export interface CreateInvestmentResult {
  investment: Investment;
  unsignedXdr: string;
  feeBreakdown: FeeBreakdown;
}

const STELLAR_TX_HASH_PATTERN = /^[a-f0-9]{64}$/i;
const TRAVEL_RULE_THRESHOLD_USD = 1000;
// #788 — default cooling-off window during which a PENDING investment can be
// self-cancelled by the investor, before funds are committed to escrow.
// Configurable via INVESTMENT_COOLING_OFF_HOURS for jurisdictions with a
// different regulatory minimum.
const DEFAULT_COOLING_OFF_HOURS = 48;

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
    private readonly feeCalculatorService: FeeCalculatorService,
    private readonly ofacCheckService: OfacSanctionsCheckService,
    @Optional() private readonly emailSequenceService: EmailSequenceService,
    @Optional() private readonly eventStore?: InvestmentEventStore,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  private coolingOffHours(): number {
    const configured = this.configService?.get<string>(
      'INVESTMENT_COOLING_OFF_HOURS',
    );
    const parsed = configured !== undefined ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_COOLING_OFF_HOURS;
  }

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

    // Block investments from wallets that cannot hold USDC (#670).
    const hasTrustline = await this.stellarService.checkUsdcTrustline(
      investor.walletAddress,
    );
    if (!hasTrustline) {
      throw new UnprocessableEntityException({
        code: 'NO_USDC_TRUSTLINE',
        message:
          'Investor wallet has not established a USDC trustline. Please add a USDC trustline to your Stellar wallet before investing.',
      });
    }

    // OFAC sanctions screening on every investment (#845)
    const isSanctioned = await this.ofacCheckService.isAddressSanctioned(
      investor.walletAddress,
    );
    if (isSanctioned) {
      throw new ForbiddenException({
        code: 'SANCTIONED_ADDRESS',
        message:
          'Investment rejected: wallet address is on the OFAC sanctions list.',
      });
    }

    // Calculate fees upfront
    const investorTier =
      this.feeCalculatorService.getInvestorTierFromUser(investor);
    const tradeDealTemp = await this.tradeDealRepo.findOne({
      where: { id: dto.tradeDealId },
    });

    if (!tradeDealTemp) {
      throw new NotFoundException('Trade deal not found.');
    }

    const feeBreakdown = await this.feeCalculatorService.calculateFeeBreakdown({
      dealType: tradeDealTemp.commodity,
      investorTier,
      grossAmount: dto.amountUsd,
    });

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

      // Enforce deal lot sizing (#835)
      const lotResult = validateLotSize(
        dto.amountUsd,
        Number(tradeDeal.minLotSize ?? 1),
        Number(tradeDeal.lotStep ?? 1),
      );
      if (!lotResult.valid) {
        throw new UnprocessableEntityException({
          code: lotResult.code,
          message: lotResult.message,
        });
      }

      // Check for over-funding (use gross amount)
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
      generateInvestmentMemo(
        tradeDeal!.tokenSymbol,
        dto.tokenAmount,
        encodeFeeData(feeBreakdown),
      ),
    );

    await this.eventStore?.append(
      investment.id,
      'InvestmentCreated',
      {
        amountUsd: dto.amountUsd,
        tokenAmount: dto.tokenAmount,
        tradeDealId: dto.tradeDealId,
      },
      investorId,
    );

    return { investment, unsignedXdr, feeBreakdown };
  }

  // Halt the investor's drip email sequence now they have created their first
  // investment. Fire-and-forget — failure must not affect the investment flow.
  private haltDripSequence(investorId: string): void {
    if (!this.emailSequenceService) return;
    this.emailSequenceService.haltForUser(investorId).catch((err) => {
      console.error('[InvestmentsService] Failed to halt drip sequence', err);
    });
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

    // Trigger referral reward for first investment
    this.referralService?.triggerReward(investorId)?.catch(() => {});

    await this.eventStore?.append(
      investmentId,
      'InvestmentActivated',
      { stellarTxId },
      investorId,
    );

    // Return the updated investment by fetching it from the database
    const updatedInvestment = await this.investmentRepo.findOne({
      where: { id: investmentId },
    });
    return updatedInvestment!;
  }

  async markInvestmentFailed(
    investmentId: string,
    actorId?: string,
  ): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.FAILED,
    });
    await this.eventStore?.append(
      investmentId,
      'InvestmentFailedEscrow',
      {},
      actorId,
    );
  }

  async startRelease(investmentId: string, actorId?: string): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.RELEASING,
    });
    await this.eventStore?.append(
      investmentId,
      'InvestmentReleaseStarted',
      {},
      actorId,
    );
  }

  async completeInvestment(
    investmentId: string,
    actorId?: string,
  ): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.COMPLETED,
    });
    await this.eventStore?.append(
      investmentId,
      'InvestmentCompleted',
      {},
      actorId,
    );
  }

  async cancelInvestment(
    investmentId: string,
    actorId?: string,
    reason?: string,
  ): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.CANCELLED,
    });
    await this.eventStore?.append(
      investmentId,
      'InvestmentCancelledByUser',
      { reason },
      actorId,
    );
  }

  /**
   * Investor self-service soft-cancel within the cooling-off window (#788).
   *
   * Only allowed while the investment is still PENDING — that's the window
   * before `fundEscrow`/`confirmInvestment` has moved any real funds
   * on-chain (see those methods' own PENDING-only guards), so there is
   * nothing to reverse on the escrow side for the common case: no signed
   * XDR has been submitted yet, so no on-chain transfer to unwind.
   *
   * The one real race this closes: `fundEscrow`'s async path (signed XDR
   * queued for submission) leaves the investment PENDING until the queued
   * job confirms it — so a naive check-then-update could still cancel an
   * investment whose on-chain payment is already in flight. The atomic
   * conditional update below (`WHERE id = ? AND status = 'pending'`) means
   * cancel can only ever "win" if nothing else has already moved the status
   * off PENDING; if the funding job wins the race instead, this method
   * reports the investment as no longer cancellable rather than silently
   * cancelling a position that just got funded. See the matching guard
   * added to the queue processor (queue.processor.ts's investment.fund
   * handler) that skips submitting the on-chain transfer if the investment
   * was cancelled before the job ran.
   */
  async requestCoolingOffCancel(
    investorId: string,
    investmentId: string,
    reason?: string,
  ): Promise<Investment> {
    const investment = await this.investmentRepo.findOne({
      where: { id: investmentId },
    });
    if (!investment) {
      throw new NotFoundException('Investment not found.');
    }
    if (investment.investorId !== investorId) {
      throw new ForbiddenException('You do not own this investment.');
    }
    if (investment.status !== InvestmentStatus.PENDING) {
      throw new UnprocessableEntityException({
        code: 'NOT_CANCELLABLE',
        message:
          'Only pending investments can be cancelled. This investment has ' +
          `already moved to "${investment.status}".`,
      });
    }

    const deadline = new Date(investment.createdAt);
    deadline.setHours(deadline.getHours() + this.coolingOffHours());
    if (new Date() > deadline) {
      throw new UnprocessableEntityException({
        code: 'COOLING_OFF_EXPIRED',
        message: `The ${this.coolingOffHours()}-hour cooling-off window for this investment has passed.`,
      });
    }

    const result = await this.investmentRepo.update(
      { id: investmentId, status: InvestmentStatus.PENDING },
      { status: InvestmentStatus.CANCELLED },
    );
    if (!result.affected) {
      // Lost the race with fundEscrow's queued confirmation between the
      // check above and this update — the investment is no longer PENDING.
      throw new UnprocessableEntityException({
        code: 'NOT_CANCELLABLE',
        message:
          'This investment started funding just now and can no longer be cancelled.',
      });
    }

    await this.eventStore?.append(
      investmentId,
      'InvestmentCancelledByUser',
      { reason, withinCoolingOff: true },
      investorId,
    );

    return (await this.investmentRepo.findOne({
      where: { id: investmentId },
    }))!;
  }

  async refundInvestment(
    investmentId: string,
    actorId?: string,
    reason?: string,
  ): Promise<void> {
    await this.investmentRepo.update(investmentId, {
      status: InvestmentStatus.REFUNDED,
    });
    await this.eventStore?.append(
      investmentId,
      'InvestmentRefunded',
      { reason },
      actorId,
    );
  }

  async reconcileStateFromEvents(investmentId: string): Promise<Investment> {
    if (!this.eventStore)
      throw new Error('InvestmentEventStore is not injected');
    const projection =
      await this.eventStore.rebuildStateFromEvents(investmentId);
    await this.investmentRepo.update(investmentId, {
      status: projection.status,
    });
    return (await this.investmentRepo.findOne({
      where: { id: investmentId },
    }))!;
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
      await this.queueService.enqueueInvestmentFundTransactional(
        this.dataSource.createQueryRunner(),
        {
          investmentId,
          signedXdr,
          escrowPublicKey: deal.escrowPublicKey,
          encryptedEscrowSecret: deal.escrowSecretKey ?? '',
          assetCode: deal.tokenSymbol,
          tokenAmount: investment.tokenAmount,
          investorWallet: investorWalletAddress,
          amountUsd: Number(investment.amountUsd),
        },
      );
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
      await this.queueService.enqueueDealFundedTransactional(
        this.dataSource.createQueryRunner(),
        {
          tradeDealId: tradeDeal.id,
          commodity: tradeDeal.commodity,
          totalValue: Number(tradeDeal.totalValue),
          investors: investments.map((inv) => ({
            email: inv.investor?.email ?? '',
            tokenAmount: inv.tokenAmount,
          })),
        },
      );
    } catch {
      // non-critical — log and swallow
    }
  }

  async getInvestmentById(id: string): Promise<Investment | null> {
    return this.investmentRepo.findOne({
      where: { id },
      relations: ['tradeDeal'],
    });
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
