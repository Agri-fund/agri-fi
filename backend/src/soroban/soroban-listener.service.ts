import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { rpc, scValToNative } from '@stellar/stellar-sdk';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

@Injectable()
export class SorobanListenerService implements OnModuleInit {
  private readonly rpcServer: rpc.Server;
  private lastProcessedLedger = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SorobanListenerService.name);

    const rpcUrl = this.config.get<string>(
      'SOROBAN_RPC_URL',
      'https://soroban-testnet.stellar.org',
    );
    this.rpcServer = new rpc.Server(rpcUrl, { allowHttp: false });
  }

  async onModuleInit(): Promise<void> {
    try {
      const latest = await this.rpcServer.getLatestLedger();
      this.lastProcessedLedger = Math.max(0, latest.sequence - 10);
      this.logger.info(
        { startLedger: this.lastProcessedLedger },
        'SorobanListenerService initialized',
      );
    } catch (err: any) {
      this.logger.warn(
        { err: err.message },
        'Failed to fetch initial ledger; will retry on first poll',
      );
    }
  }

  @Cron('*/30 * * * * *')
  async pollContractEvents(): Promise<void> {
    try {
      const latestLedger = (await this.rpcServer.getLatestLedger()).sequence;
      if (latestLedger <= this.lastProcessedLedger) return;

      const startLedger = this.lastProcessedLedger + 1;

      const deals = await this.tradeDealRepo.find({
        where: { sorobanCampaignContractId: Not(IsNull()) },
        select: ['sorobanCampaignContractId'],
      });
      const contractIds = deals
        .map((d) => d.sorobanCampaignContractId)
        .filter(Boolean) as string[];

      if (contractIds.length === 0) {
        this.lastProcessedLedger = latestLedger;
        return;
      }

      const response = await this.rpcServer.getEvents({
        startLedger,
        filters: [{ type: 'contract', contractIds }],
        limit: 100,
      });

      for (const event of response.events) {
        if (!event.inSuccessfulContractCall) continue;
        await this.handleEvent(event);
      }

      this.lastProcessedLedger = Math.max(
        this.lastProcessedLedger,
        response.latestLedger,
      );
    } catch (err: any) {
      this.logger.error({ err: err.message }, 'Soroban event poll failed');
    }
  }

  private async handleEvent(event: rpc.Api.EventResponse): Promise<void> {
    const topic = event.topic;
    if (topic.length === 0) return;

    let eventName: string;
    try {
      eventName = String(scValToNative(topic[0]));
    } catch {
      return;
    }

    const contractId = event.contractId as unknown as string;

    const deal = await this.tradeDealRepo.findOne({
      where: { sorobanCampaignContractId: contractId },
    });
    if (!deal) return;

    this.logger.debug(
      { contractId, eventName, ledger: event.ledger },
      'Processing Soroban event',
    );

    switch (eventName) {
      case 'approve':
        if (deal.status === 'draft') {
          deal.status = 'open';
        }
        break;
      case 'pause':
      case 'mark_failed':
        deal.status = 'failed';
        break;
      case 'distribute_revenue':
        if (deal.status === 'funded' || deal.status === 'delivered') {
          deal.status = 'completed';
        }
        break;
      default:
        return;
    }

    await this.tradeDealRepo.save(deal);
    this.logger.info(
      { contractId, eventName, newStatus: deal.status },
      'Trade deal status updated from Soroban event',
    );
  }
}
