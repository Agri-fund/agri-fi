import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ShipmentMilestone,
  MilestoneType,
} from './entities/shipment-milestone.entity';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { ConfigService } from '@nestjs/config';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

const MILESTONE_SEQUENCE: MilestoneType[] = [
  'farm',
  'warehouse',
  'port',
  'importer',
];

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async recordMilestone(
    userId: string,
    dto: CreateMilestoneDto,
  ): Promise<ShipmentMilestone> {
    // Use a transaction to ensure atomicity
    return await this.dataSource.transaction(async (manager) => {
      // Load the deal via entity manager to avoid raw SQL
      const deal = await manager.findOne(TradeDeal, {
        where: { id: dto.trade_deal_id },
        select: ['id', 'status', 'traderId', 'escrowSecretKey'],
      });

      if (!deal) {
        throw new NotFoundException('Trade deal not found.');
      }

      // 5.6 — only funded deals
      if (deal.status !== 'funded') {
        throw new UnprocessableEntityException({
          code: 'DEAL_NOT_FUNDED',
          message: 'Milestones can only be recorded for funded deals.',
        });
      }

      // 5.6 — only the assigned trader
      if (deal.traderId !== userId) {
        throw new ForbiddenException({
          code: 'NOT_ASSIGNED_TRADER',
          message:
            'Only the assigned trader can record milestones for this deal.',
        });
      }

      // 5.3 / 5.4 — enforce sequence
      const existing = await manager.find(ShipmentMilestone, {
        where: { tradeDealId: dto.trade_deal_id },
        order: { recordedAt: 'ASC' },
      });

      const nextIndex = existing.length;
      const expected = MILESTONE_SEQUENCE[nextIndex];

      if (!expected) {
        throw new UnprocessableEntityException({
          code: 'ALL_MILESTONES_RECORDED',
          message: 'All milestones have already been recorded for this deal.',
        });
      }

      if (dto.milestone !== expected) {
        throw new UnprocessableEntityException({ expected });
      }

      // 5.2 — anchor on Stellar
      const dealIdShort = deal.id.replace(/-/g, '').slice(0, 8);
      const unixTs = Math.floor(Date.now() / 1000);
      const memoText = `AGRIC:MILESTONE:${dealIdShort}:${dto.milestone}:${unixTs}`;

      const signerSecret =
        deal.escrowSecretKey ||
        this.config.get<string>('STELLAR_PLATFORM_SECRET', '');

      const stellarTxId = await this.stellarService.recordMemo(
        memoText,
        signerSecret,
        'hash',
      );

      // Create and save the milestone
      const milestone = manager.create(ShipmentMilestone, {
        tradeDealId: dto.trade_deal_id,
        milestone: dto.milestone,
        recordedBy: userId,
        notes: dto.notes ?? null,
        stellarTxId,
        memoText,
      });

      const savedMilestone = await manager.save(milestone);

      // 5.5 — Handle importer milestone: transition to delivered and enqueue job
      if (dto.milestone === 'importer') {
        // Update trade deal status to delivered
        await manager.update(TradeDeal, dto.trade_deal_id, {
          status: 'delivered',
        });

        // Enqueue deal.delivered job for escrow release
        await this.queueService.enqueueDealDelivered(dto.trade_deal_id);

        this.logger.log(
          `Deal ${dto.trade_deal_id} transitioned to delivered — escrow release job enqueued`,
        );
      }

      return savedMilestone;
    });
  }

  async findByDeal(tradeDealId: string): Promise<ShipmentMilestone[]> {
    // First verify the trade deal exists
    const deal = await this.tradeDealRepo.findOne({
      where: { id: tradeDealId },
      select: ['id'],
    });

    if (!deal) {
      throw new NotFoundException('Trade deal not found');
    }

    // Return milestones ordered by recorded_at ASC
    return this.milestoneRepo.find({
      where: { tradeDealId },
      order: { recordedAt: 'ASC' },
    });
  }
}
