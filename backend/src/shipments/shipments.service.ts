import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ShipmentMilestone,
  MilestoneType,
} from './entities/shipment-milestone.entity';
import { MilestoneComment } from './entities/milestone-comment.entity';
import { MilestoneVerification } from './entities/milestone-verification.entity';
import { CreateMilestoneDto } from './dto/create-milestone.dto';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import {
  CreateMilestoneCommentDto,
  MilestoneCommentResponseDto,
} from './dto/milestone-comment.dto';
import {
  CreateMilestoneVerificationDto,
  MilestoneVerificationResponseDto,
} from './dto/milestone-verification.dto';
import { StellarService } from '../stellar/stellar.service';
import { QueueService } from '../queue/queue.service';
import { ConfigService } from '@nestjs/config';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { buildShipmentMemo } from '../stellar/anchor-memo';

const MILESTONE_SEQUENCE: MilestoneType[] = [
  'farm',
  'warehouse',
  'port',
  'importer',
];

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly logger: PinoLogger,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(MilestoneComment)
    private readonly commentRepo: Repository<MilestoneComment>,
    @InjectRepository(MilestoneVerification)
    private readonly verificationRepo: Repository<MilestoneVerification>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    private readonly stellarService: StellarService,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    @Optional() private readonly notificationsGateway?: NotificationsGateway,
  ) {
    (this.logger as any).setContext(ShipmentsService.name);
  }

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
      const memoText = buildShipmentMemo(deal.id, dto.milestone);

      let signerSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
      if (deal.escrowSecretKey) {
        signerSecret = this.stellarService.decryptSecret(deal.escrowSecretKey);
      }

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
        // Prefer structured location object; fall back to legacy top-level fields
        latitude: dto.location?.lat ?? dto.latitude ?? null,
        longitude: dto.location?.lng ?? dto.longitude ?? null,
        evidenceDocumentIds: dto.evidence?.length ? dto.evidence : null,
      });

      const savedMilestone = await manager.save(milestone);

      // 5.5 — Handle importer milestone: transition to delivered and enqueue job
      if (dto.milestone === 'importer') {
        // Update trade deal status to delivered
        const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
        await manager.update(TradeDeal, dto.trade_deal_id, {
          status: 'delivered',
          appTraceId,
        });

        // Enqueue deal.delivered job for escrow release
        await this.queueService.enqueueDealDelivered(dto.trade_deal_id);

        this.logger.info(
          { dealId: dto.trade_deal_id },
          'Deal transitioned to delivered — escrow release job enqueued',
        );
      }

      this.notificationsGateway?.publishMilestoneReached({
        dealId: dto.trade_deal_id,
        milestone: dto.milestone,
        title: 'Shipment milestone reached',
        message: `${dto.milestone} milestone recorded for the deal`,
      });

      if (dto.milestone === 'importer') {
        this.notificationsGateway?.publishDealStatusChanged({
          dealId: dto.trade_deal_id,
          status: 'delivered',
          title: 'Deal status changed',
          message: 'The deal is now delivered',
        });
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

  async addComment(
    userId: string,
    userDisplayName: string,
    dto: CreateMilestoneCommentDto,
  ): Promise<MilestoneCommentResponseDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id: dto.milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    const comment = this.commentRepo.create({
      milestoneId: dto.milestoneId,
      userId,
      userDisplayName,
      content: dto.content,
      role: dto.role || null,
    });

    const saved = await this.commentRepo.save(comment);

    return {
      id: saved.id,
      milestoneId: saved.milestoneId,
      userId: saved.userId,
      userDisplayName: saved.userDisplayName,
      content: saved.content,
      role: saved.role,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async getComments(
    milestoneId: string,
  ): Promise<MilestoneCommentResponseDto[]> {
    const comments = await this.commentRepo.find({
      where: { milestoneId },
      order: { createdAt: 'ASC' },
    });

    return comments.map((c) => ({
      id: c.id,
      milestoneId: c.milestoneId,
      userId: c.userId,
      userDisplayName: c.userDisplayName,
      content: c.content,
      role: c.role,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  }

  async verifyMilestone(
    userId: string,
    verifierRole: string,
    dto: CreateMilestoneVerificationDto,
  ): Promise<MilestoneVerificationResponseDto> {
    const milestone = await this.milestoneRepo.findOne({
      where: { id: dto.milestoneId },
    });

    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }

    // Check if already verified by this user
    const existing = await this.verificationRepo.findOne({
      where: { milestoneId: dto.milestoneId, verifiedBy: userId },
    });

    if (existing) {
      throw new UnprocessableEntityException(
        'User has already verified this milestone',
      );
    }

    const verification = this.verificationRepo.create({
      milestoneId: dto.milestoneId,
      verifiedBy: userId,
      verifierRole,
      status: dto.status,
      notes: dto.notes || null,
    });

    const saved = await this.verificationRepo.save(verification);

    return {
      id: saved.id,
      milestoneId: saved.milestoneId,
      verifiedBy: saved.verifiedBy,
      verifierRole: saved.verifierRole,
      status: saved.status,
      notes: saved.notes,
      verifiedAt: saved.verifiedAt,
    };
  }

  async getVerifications(
    milestoneId: string,
  ): Promise<MilestoneVerificationResponseDto[]> {
    const verifications = await this.verificationRepo.find({
      where: { milestoneId },
      order: { verifiedAt: 'ASC' },
    });

    return verifications.map((v) => ({
      id: v.id,
      milestoneId: v.milestoneId,
      verifiedBy: v.verifiedBy,
      verifierRole: v.verifierRole,
      status: v.status,
      notes: v.notes,
      verifiedAt: v.verifiedAt,
    }));
  }

  async getMilestoneHistory(tradeDealId: string): Promise<any> {
    const milestones = await this.findByDeal(tradeDealId);

    const history = await Promise.all(
      milestones.map(async (m) => {
        const comments = await this.getComments(m.id);
        const verifications = await this.getVerifications(m.id);

        return {
          milestone: m,
          comments,
          verifications,
        };
      }),
    );

    return history;
  }
}
