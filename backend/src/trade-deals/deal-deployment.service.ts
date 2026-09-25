import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { TradeDeal } from './entities/trade-deal.entity';
import { SorobanService } from '../soroban/soroban.service';
import { FeeConfigurationService } from '../investments/fee-configuration.service';
import { MAX_FEE_BPS } from '../database/entities/fee-configuration.entity';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';

/**
 * Admin deal approval + on-chain FarmCampaign deployment via the
 * ProjectFactory contract (#830).
 *
 * Happy path:  admin approves a draft deal -> factory `create_campaign` is invoked ->
 *              returned contract address is stored on the deal and the deal
 *              goes live (status "open").
 * Failure path: deployment failure reverts the approval (deal stays/reverts to
 *              draft) and raises an admin alert.
 */
@Injectable()
export class DealDeploymentService {
  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly sorobanService: SorobanService,
    private readonly feeConfigurationService: FeeConfigurationService,
    private readonly auditService: AuditService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DealDeploymentService.name);
  }

  async approveDeal(dealId: string, adminId: string): Promise<TradeDeal> {
    const factoryContractId = this.config.get<string>(
      'SOROBAN_FACTORY_CONTRACT_ID',
    );
    const sorobanRpcUrl = this.config.get<string>('SOROBAN_RPC_URL');
    if (!factoryContractId || !sorobanRpcUrl) {
      throw new UnprocessableEntityException({
        code: 'SOROBAN_NOT_CONFIGURED',
        message:
          'Soroban ProjectFactory is not configured; deals cannot be approved for on-chain deployment.',
      });
    }

    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
      relations: ['farmer'],
    });
    if (!deal) {
      throw new NotFoundException('Trade deal not found.');
    }
    if (deal.status !== 'draft') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_DRAFT',
        message: 'Only draft deals can be approved for deployment.',
      });
    }
    if (!deal.farmer?.walletAddress) {
      throw new UnprocessableEntityException({
        code: 'NO_FARMER_WALLET',
        message:
          'The farmer has not linked a Stellar wallet; cannot deploy the campaign contract.',
      });
    }

    const targetUsd = Number(deal.minimumFundingTarget ?? deal.totalValue);
    if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CAMPAIGN_TARGET',
        message: 'Campaign funding target must be greater than zero.',
      });
    }
    const targetStroopsNumber = Math.round(targetUsd * 1e7);
    if (!Number.isSafeInteger(targetStroopsNumber) || targetStroopsNumber <= 0) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CAMPAIGN_TARGET',
        message: 'Campaign funding target must be greater than zero.',
      });
    }
    const targetStroops = BigInt(targetStroopsNumber);

    const deadline = Math.floor(
      new Date(deal.fundingDeadline ?? deal.deliveryDate).getTime() / 1000,
    );
    if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000)) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CAMPAIGN_DEADLINE',
        message: 'Campaign funding deadline must be in the future.',
      });
    }

    const feeBps = await this.feeConfigurationService.getPlatformOriginationFeeBps(
      deal.commodity,
    );
    if (
      !Number.isSafeInteger(feeBps) ||
      feeBps < 0 ||
      feeBps > MAX_FEE_BPS
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_CAMPAIGN_FEE_BPS',
        message: `Campaign fee must be between 0 and ${MAX_FEE_BPS} bps.`,
      });
    }

    try {
      const campaignAddress = await this.sorobanService.deployFarmCampaign(
        dealId,
        {
          farmerAddress: deal.farmer.walletAddress,
          targetAmount: targetStroops,
          deadline,
          feeBps,
        },
      );

      deal.sorobanCampaignContractId = campaignAddress;
      deal.status = 'open';
      deal.appTraceId = `app-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .substring(2, 10)}`;
      const saved = await this.tradeDealRepo.save(deal);

      // Audit trail: deployed contract address + deployer wallet (#830)
      await this.auditService.logEvent({
        actorId: adminId,
        actorRole: 'admin',
        route: '/v1/trade-deals/:id/approve',
        statusCode: 200,
        requestDetails: {
          dealId,
          contractAddress: campaignAddress,
          deployerWallet: this.sorobanService.platformPublicKey(),
        },
      });

      this.logger.info(
        { dealId, campaignAddress },
        'FarmCampaign deployed after admin approval',
      );
      return saved;
    } catch (error) {
      // Roll back the approval — the deal reverts to pending (draft).
      await this.tradeDealRepo.update(dealId, { status: 'draft' });

      this.logger.error(
        { dealId, error: error.message },
        'FarmCampaign deployment failed — deal reverted to draft',
      );

      await this.queueService.emit('admin.alert', {
        type: 'deal_deployment_failed',
        dealId,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      throw new UnprocessableEntityException({
        code: 'DEAL_DEPLOYMENT_FAILED',
        message:
          'On-chain campaign deployment failed. The deal approval was rolled back and admins have been alerted.',
      });
    }
  }
}
