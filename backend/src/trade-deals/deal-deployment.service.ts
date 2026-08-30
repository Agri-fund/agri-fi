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
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';

/**
 * Admin deal approval + on-chain FarmCampaign deployment via the
 * ProjectFactory contract (#830).
 *
 * Happy path:  admin approves a draft deal -> factory `deploy` is invoked ->
 *              returned contract address is stored on the deal and the deal
 *              goes live (status "open").
 * Failure path: deployment failure reverts the approval (deal stays/reverts to
 *              draft) and raises an admin alert.
 */
@Injectable()
export class DealDeploymentService {
  /** Approximate Stellar ledger close time in milliseconds. */
  private static readonly LEDGER_DURATION_MS = 5_000;

  constructor(
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly sorobanService: SorobanService,
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

    const targetStroops = BigInt(Math.round(Number(deal.totalValue) * 1e7));
    const durationLedgers = Math.max(
      1,
      Math.ceil(
        (new Date(deal.deliveryDate).getTime() - Date.now()) /
          DealDeploymentService.LEDGER_DURATION_MS,
      ),
    );
    const commodityCode = deal.commodity
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 9);

    try {
      const campaignAddress = await this.sorobanService.deployFarmCampaign(
        dealId,
        {
          farmerAddress: deal.farmer.walletAddress,
          targetAmount: targetStroops,
          durationLedgers,
          commodityCode,
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
