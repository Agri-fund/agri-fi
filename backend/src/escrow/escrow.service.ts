import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, QueryRunner } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService, InvestorShare } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { Keypair } from '@stellar/stellar-sdk';

interface DealDeliveredPayload {
  tradeDealId: string;
}

@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(PaymentDistribution)
    private readonly paymentDistributionRepo: Repository<PaymentDistribution>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EscrowService.name);
  }

  /**
   * Processes the `deal.delivered` event by:
   *
   * 1. Loading and validating the deal + investments (read phase — no transaction).
   * 2. Performing the irreversible Stellar escrow release **outside** the DB
   *    transaction so a Stellar failure rolls back nothing (there is nothing to
   *    roll back yet) and does not leave the database in an inconsistent state.
   * 3. Wrapping **all** subsequent DB writes (PaymentDistribution inserts,
   *    deal status update) in a single QueryRunner transaction (#744) so that a
   *    partial write failure rolls back completely — no orphan payment records,
   *    no deal stuck in the wrong status.
   *
   * Why QueryRunner instead of DataSource.transaction():
   * ─────────────────────────────────────────────────────
   * QueryRunner gives us explicit SAVEPOINT / ROLLBACK control and makes the
   * transaction lifecycle observable in logs, satisfying the acceptance criteria
   * "Failed payout transactions result in database rollbacks" and
   * "No orphan transactions remain in the database."
   */
  async processDealDelivered(payload: DealDeliveredPayload): Promise<void> {
    const { tradeDealId } = payload;

    this.logger.info(`Processing deal.delivered for deal ${tradeDealId}`);

    // ── Phase 1: Read-only validation (no transaction needed) ─────────────────
    const deal = await this.tradeDealRepo.findOne({
      where: { id: tradeDealId },
      relations: ['farmer', 'trader'],
    });

    if (!deal) {
      throw new NotFoundException(`Trade deal ${tradeDealId} not found`);
    }

    if (deal.status !== 'delivered') {
      this.logger.warn(
        `Deal ${tradeDealId} is not in delivered status (current: ${deal.status}). Skipping escrow release.`,
      );
      return;
    }

    const investments = await this.investmentRepo.find({
      where: { tradeDealId, status: InvestmentStatus.CONFIRMED },
      relations: ['investor'],
    });

    if (investments.length === 0) {
      this.logger.warn(
        `No confirmed investments found for deal ${tradeDealId}`,
      );
      return;
    }

    // Validate wallet addresses before touching Stellar or the DB
    if (!deal.farmer?.walletAddress) {
      throw new Error(
        `Farmer wallet address not found for deal ${tradeDealId}`,
      );
    }

    const investorsWithoutWallet = investments.filter(
      (inv) => !inv.investor?.walletAddress,
    );
    if (investorsWithoutWallet.length > 0) {
      throw new Error(
        `Some investors don't have wallet addresses for deal ${tradeDealId}`,
      );
    }

    // Prepare investor shares for Stellar service
    const totalTokens = investments.reduce(
      (sum, inv) => sum + inv.tokenAmount,
      0,
    );
    const investorShares: InvestorShare[] = investments.map((inv) => ({
      walletAddress: inv.investor.walletAddress!,
      tokenAmount: inv.tokenAmount,
      totalTokens,
    }));

    // Resolve platform wallet
    const platformWallet = await this.resolvePlatformWallet();

    if (!deal.escrowSecretKey) {
      throw new Error(`Escrow secret key missing for deal ${tradeDealId}`);
    }

    // ── Phase 2: Stellar escrow release (irreversible, outside any DB tx) ─────
    // The Stellar ledger is append-only; there is no rollback. We execute this
    // before opening the DB transaction so a Stellar failure leaves the database
    // unchanged. If the DB writes below fail after Stellar succeeds we log the
    // Stellar TX IDs and alert ops so the distributions can be reconstructed.
    const escrowSecret = this.stellarService.decryptSecret(
      deal.escrowSecretKey,
    );

    let stellarTxIds: string[];
    try {
      stellarTxIds = await this.stellarService.releaseEscrow(
        escrowSecret,
        deal.farmer.walletAddress,
        investorShares,
        platformWallet,
        deal.totalValue,
      );
    } catch (stellarError) {
      this.logger.error(
        { tradeDealId, error: stellarError.message },
        'Stellar escrow release failed — no DB writes were made',
      );
      await this.handleEscrowFailure(tradeDealId, stellarError);
      throw stellarError;
    }

    const stellarTxId = stellarTxIds[0];

    // ── Phase 3: DB transaction — all writes commit or roll back together ──────
    // Uses an explicit QueryRunner so the transaction lifecycle (BEGIN / COMMIT /
    // ROLLBACK) is fully visible and controllable (#744).
    const qr: QueryRunner = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();

    try {
      const totalValue = Number(deal.totalValue);
      const [platformAmount, investorPool] = this.splitTotalValue(totalValue);
      const investorAmounts = this.allocateProportionalAmounts(
        investorPool,
        investments.map((inv) => inv.tokenAmount),
      );

      // Build PaymentDistribution records for all investors
      const paymentDistributions: PaymentDistribution[] = [];

      for (const [index, investment] of investments.entries()) {
        paymentDistributions.push(
          qr.manager.create(PaymentDistribution, {
            tradeDealId,
            recipientType: 'investor',
            recipientId: investment.investorId,
            walletAddress: investment.investor.walletAddress!,
            amountUsd: investorAmounts[index],
            stellarTxId,
            status: 'confirmed',
          }),
        );
      }

      // Platform fee distribution record
      paymentDistributions.push(
        qr.manager.create(PaymentDistribution, {
          tradeDealId,
          recipientType: 'platform',
          recipientId: null,
          walletAddress: platformWallet,
          amountUsd: platformAmount,
          stellarTxId,
          status: 'confirmed',
        }),
      );

      // Persist all distributions atomically
      await qr.manager.save(PaymentDistribution, paymentDistributions);

      // Mark deal as completed
      const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
      await qr.manager.update(TradeDeal, tradeDealId, {
        status: 'completed',
        appTraceId,
      });

      // All DB writes succeeded — commit
      await qr.commitTransaction();

      this.logger.info(
        `Deal ${tradeDealId} committed to completed. Stellar TX: ${stellarTxId}`,
      );
    } catch (dbError) {
      // Roll back all DB writes atomically. The Stellar release already
      // happened, so we log the Stellar TX ID for manual reconciliation.
      await qr.rollbackTransaction();

      this.logger.error(
        {
          tradeDealId,
          stellarTxId,
          error: dbError.message,
        },
        'DB transaction rolled back after successful Stellar release — ' +
          'manual reconciliation required using the Stellar TX ID above',
      );

      await this.handleEscrowFailure(tradeDealId, dbError);
      throw dbError;
    } finally {
      // Always release the QueryRunner back to the pool — prevents connection leaks.
      await qr.release();
    }

    // ── Phase 4: Side-effects (outside transaction to avoid rollback on non-critical failures) ──
    setTimeout(() => {
      this.sendCompletionNotifications(tradeDealId, deal, investments);
      this.queueService.enqueueDealCleanup(tradeDealId).catch((err: Error) => {
        this.logger.error(`Failed to enqueue deal cleanup: ${err.message}`);
      });
    }, 0);
  }

  /** Resolves the platform wallet address from config. */
  private async resolvePlatformWallet(): Promise<string> {
    const explicit = this.config.get<string>('STELLAR_PLATFORM_WALLET');
    if (explicit) return explicit;

    const secret = this.config.get<string>('STELLAR_PLATFORM_SECRET');
    if (!secret) {
      throw new Error(
        'Neither STELLAR_PLATFORM_WALLET nor STELLAR_PLATFORM_SECRET are configured.',
      );
    }
    try {
      return Keypair.fromSecret(secret).publicKey();
    } catch {
      throw new Error(
        'Invalid STELLAR_PLATFORM_SECRET provided for deriving platform wallet.',
      );
    }
  }

  private async handleEscrowFailure(
    tradeDealId: string,
    error: any,
  ): Promise<void> {
    this.logger.error(
      `Escrow release failed for deal ${tradeDealId}: ${error.message}`,
      error.stack,
    );

    try {
      // Mark any existing payment distribution records as failed
      await this.paymentDistributionRepo.update(
        { tradeDealId },
        { status: 'failed' },
      );

      // Send admin alert
      await this.queueService.emit('admin.alert', {
        type: 'escrow_failure',
        dealId: tradeDealId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      this.logger.info(
        `Admin alert sent for failed escrow release: ${tradeDealId}`,
      );
    } catch (alertError) {
      this.logger.error(
        `Failed to send admin alert for deal ${tradeDealId}`,
        alertError,
      );
    }
  }

  private async sendCompletionNotifications(
    tradeDealId: string,
    deal: TradeDeal,
    investments: Investment[],
  ): Promise<void> {
    try {
      const totalValue = Number(deal.totalValue);
      const [platformAmount] = this.splitTotalValue(totalValue);
      const investorPool = totalValue - platformAmount;
      const investorReturnAmounts = this.allocateProportionalAmounts(
        investorPool,
        investments.map((inv) => inv.tokenAmount),
      );

      await this.queueService.emit('email.notification', {
        type: 'deal_completed',
        recipient: 'farmer',
        userId: deal.farmerId,
        dealId: tradeDealId,
        dealDetails: {
          commodity: deal.commodity,
          totalValue,
          farmerAmount: investorPool,
        },
      });

      await this.queueService.emit('email.notification', {
        type: 'deal_completed',
        recipient: 'trader',
        userId: deal.traderId,
        dealId: tradeDealId,
        dealDetails: {
          commodity: deal.commodity,
          totalValue,
        },
      });

      for (const [index, investment] of investments.entries()) {
        await this.queueService.emit('email.notification', {
          type: 'deal_completed',
          recipient: 'investor',
          userId: investment.investorId,
          dealId: tradeDealId,
          dealDetails: {
            commodity: deal.commodity,
            totalValue,
            investmentAmount: investment.amountUsd,
            returnAmount: investorReturnAmounts[index],
            tokenAmount: investment.tokenAmount,
          },
        });
      }

      this.logger.info(`Completion notifications sent for deal ${tradeDealId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send completion notifications for deal ${tradeDealId}`,
        error,
      );
    }
  }

  private splitTotalValue(totalValue: number): [number, number] {
    const totalCents = this.toCents(totalValue);
    const platformCents = Math.round(totalCents * 0.02);
    const investorPoolCents = totalCents - platformCents;
    return [this.fromCents(platformCents), this.fromCents(investorPoolCents)];
  }

  private allocateProportionalAmounts(
    totalValue: number,
    weights: number[],
  ): number[] {
    if (weights.length === 0) {
      return [];
    }

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    if (totalWeight <= 0) {
      throw new Error('Cannot allocate amounts without positive weights.');
    }

    const totalCents = this.toCents(totalValue);
    let allocatedCents = 0;

    return weights.map((weight, index) => {
      if (index === weights.length - 1) {
        return this.fromCents(totalCents - allocatedCents);
      }

      const shareCents = Math.floor((totalCents * weight) / totalWeight);
      allocatedCents += shareCents;
      return this.fromCents(shareCents);
    });
  }

  private toCents(value: number): number {
    return Math.round((value + Number.EPSILON) * 100);
  }

  private fromCents(cents: number): number {
    return cents / 100;
  }
}
