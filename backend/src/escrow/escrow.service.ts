import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
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

  async processDealDelivered(payload: DealDeliveredPayload): Promise<void> {
    const { tradeDealId } = payload;

    this.logger.info(`Processing deal.delivered for deal ${tradeDealId}`);

    try {
      await this.dataSource.transaction(async (manager) => {
        // Load deal with relations
        const deal = await manager.findOne(TradeDeal, {
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

        // Load confirmed investments with investor details
        const investments = await manager.find(Investment, {
          where: { tradeDealId, status: InvestmentStatus.CONFIRMED },
          relations: ['investor'],
        });

        if (investments.length === 0) {
          this.logger.warn(
            `No confirmed investments found for deal ${tradeDealId}`,
          );
          return;
        }

        // Validate wallet addresses
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

        // Get platform wallet address
        let platformWallet = this.config.get<string>('STELLAR_PLATFORM_WALLET');

        if (!platformWallet) {
          const platformSecret = this.config.get<string>(
            'STELLAR_PLATFORM_SECRET',
          );
          if (!platformSecret) {
            throw new Error(
              'Neither STELLAR_PLATFORM_WALLET nor STELLAR_PLATFORM_SECRET are configured.',
            );
          }
          try {
            platformWallet = Keypair.fromSecret(platformSecret).publicKey();
          } catch (e) {
            throw new Error(
              'Invalid STELLAR_PLATFORM_SECRET provided for deriving platform wallet.',
            );
          }
        }

        if (!platformWallet) {
          throw new Error(
            'Platform wallet address not configured or derivable',
          );
        }

        // Release escrow funds via Stellar
        if (!deal.escrowSecretKey) {
          throw new Error(`Escrow secret key missing for deal ${tradeDealId}`);
        }

        const escrowSecret = this.stellarService.decryptSecret(
          deal.escrowSecretKey,
        );
        const stellarTxIds = await this.stellarService.releaseEscrow(
          escrowSecret,
          deal.farmer.walletAddress,
          investorShares,
          platformWallet,
          deal.totalValue,
        );

        // The current implementation returns a single transaction ID
        const stellarTxId = stellarTxIds[0];

        // Create payment distribution records using cent-safe arithmetic.
        const paymentDistributions: PaymentDistribution[] = [];
        const totalValue = Number(deal.totalValue);
        const [farmerAmount, platformAmount] = this.splitTotalValue(totalValue);
        const investorAmounts = this.allocateProportionalAmounts(
          totalValue,
          investments.map((investment) => investment.tokenAmount),
        );

        paymentDistributions.push(
          manager.create(PaymentDistribution, {
            tradeDealId,
            recipientType: 'farmer',
            recipientId: deal.farmerId,
            walletAddress: deal.farmer.walletAddress,
            amountUsd: farmerAmount,
            stellarTxId,
            status: 'confirmed',
          }),
        );

        // Investor payments (proportional)
        for (const [index, investment] of investments.entries()) {
          const investorAmount = investorAmounts[index];
          paymentDistributions.push(
            manager.create(PaymentDistribution, {
              tradeDealId,
              recipientType: 'investor',
              recipientId: investment.investorId,
              walletAddress: investment.investor.walletAddress!,
              amountUsd: investorAmount,
              stellarTxId,
              status: 'confirmed',
            }),
          );
        }

        paymentDistributions.push(
          manager.create(PaymentDistribution, {
            tradeDealId,
            recipientType: 'platform',
            recipientId: null,
            walletAddress: platformWallet,
            amountUsd: platformAmount,
            stellarTxId,
            status: 'confirmed',
          }),
        );

        // Save all payment distribution records
        await manager.save(PaymentDistribution, paymentDistributions);

        // Update deal status to completed
        const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
        await manager.update(TradeDeal, tradeDealId, {
          status: 'completed',
          appTraceId,
        });

        this.logger.info(
          `Deal ${tradeDealId} completed successfully. Stellar TX: ${stellarTxId}`,
        );

        // Enqueue email notifications (outside transaction to avoid rollback issues)
        setTimeout(() => {
          this.sendCompletionNotifications(tradeDealId, deal, investments);
          this.queueService.enqueueDealCleanup(tradeDealId).catch((err) => {
            this.logger.error(`Failed to enqueue deal cleanup: ${err.message}`);
          });
        }, 0);
      });
    } catch (error) {
      await this.handleEscrowFailure(tradeDealId, error);
      throw error;
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
      // Notify farmer
      const totalValue = Number(deal.totalValue);
      const [farmerAmount] = this.splitTotalValue(totalValue);
      const investorPool = farmerAmount;
      const investorReturnAmounts = this.allocateProportionalAmounts(
        investorPool,
        investments.map((investment) => investment.tokenAmount),
      );

      await this.queueService.emit('email.notification', {
        type: 'deal_completed',
        recipient: 'farmer',
        userId: deal.farmerId,
        dealId: tradeDealId,
        dealDetails: {
          commodity: deal.commodity,
          totalValue,
          farmerAmount,
        },
      });

      // Notify trader
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

      // Notify all investors
      for (const [index, investment] of investments.entries()) {
        const returnAmount = investorReturnAmounts[index];

        await this.queueService.emit('email.notification', {
          type: 'deal_completed',
          recipient: 'investor',
          userId: investment.investorId,
          dealId: tradeDealId,
          dealDetails: {
            commodity: deal.commodity,
            totalValue,
            investmentAmount: investment.amountUsd,
            returnAmount: returnAmount,
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
    const farmerCents = totalCents - platformCents;
    return [this.fromCents(farmerCents), this.fromCents(platformCents)];
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
