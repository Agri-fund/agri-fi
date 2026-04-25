import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { TradeDeal } from '../users/entities/trade-deal.entity';
import { Investment } from '../users/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { StellarService, InvestorShare } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';

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

    this.logger.log(`Processing deal.delivered for deal ${tradeDealId}`);

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
          where: { tradeDealId, status: 'confirmed' },
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
        const platformWallet = this.config.get<string>(
          'STELLAR_PLATFORM_WALLET',
          this.config.get<string>('STELLAR_PLATFORM_SECRET', ''),
        );

        if (!platformWallet) {
          throw new Error('Platform wallet address not configured');
        }

        // Release escrow funds via Stellar
        const stellarTxIds = await this.stellarService.releaseEscrow(
          deal.escrowSecretKey!,
          deal.farmer.walletAddress,
          investorShares,
          platformWallet,
          deal.totalValue,
        );

        // The current implementation returns a single transaction ID
        const stellarTxId = stellarTxIds[0];

        // Create payment distribution records
        const paymentDistributions: PaymentDistribution[] = [];

        // Farmer payment (98%)
        const farmerAmount = deal.totalValue * 0.98;
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
        for (const investment of investments) {
          const investorAmount =
            (investment.tokenAmount / totalTokens) * deal.totalValue;
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

        // Platform fee (2%)
        const platformAmount = deal.totalValue * 0.02;
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
        await manager.update(TradeDeal, tradeDealId, { status: 'completed' });

        this.logger.log(
          `Deal ${tradeDealId} completed successfully. Stellar TX: ${stellarTxId}`,
        );

        // Enqueue email notifications (outside transaction to avoid rollback issues)
        setTimeout(() => {
          this.sendCompletionNotifications(tradeDealId, deal, investments);
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

      this.logger.log(
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
      await this.queueService.emit('email.notification', {
        type: 'deal_completed',
        recipient: 'farmer',
        userId: deal.farmerId,
        dealId: tradeDealId,
        dealDetails: {
          commodity: deal.commodity,
          totalValue: deal.totalValue,
          farmerAmount: deal.totalValue * 0.98,
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
          totalValue: deal.totalValue,
        },
      });

      // Notify all investors
      const totalTokens = investments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );
      const investorPool = deal.totalValue * 0.98;

      for (const investment of investments) {
        const returnAmount =
          (investment.tokenAmount / totalTokens) * investorPool;

        await this.queueService.emit('email.notification', {
          type: 'deal_completed',
          recipient: 'investor',
          userId: investment.investorId,
          dealId: tradeDealId,
          dealDetails: {
            commodity: deal.commodity,
            totalValue: deal.totalValue,
            investmentAmount: investment.amountUsd,
            returnAmount: returnAmount,
            tokenAmount: investment.tokenAmount,
          },
        });
      }

      this.logger.log(`Completion notifications sent for deal ${tradeDealId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send completion notifications for deal ${tradeDealId}`,
        error,
      );
    }
  }
}
