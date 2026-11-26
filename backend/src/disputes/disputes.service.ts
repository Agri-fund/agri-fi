import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThanOrEqual, Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Dispute, DisputeStatus } from './entities/dispute.entity';
import {
  CreateDisputeDto,
  DisputeResponseDto,
  ResolveDisputeDto,
} from './dto/dispute.dto';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import {
  Investment,
  InvestmentStatus,
} from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { User } from '../auth/entities/user.entity';
import { DocumentsService } from '../documents/documents.service';
import { EscrowService } from '../escrow/escrow.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QueueService } from '../queue/queue.service';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVE_DISPUTE_STATUSES = [
  DisputeStatus.OPEN,
  DisputeStatus.UNDER_REVIEW,
  DisputeStatus.ESCALATED,
];

@Injectable()
export class DisputesService {
  constructor(
    @InjectRepository(Dispute)
    private readonly disputeRepo: Repository<Dispute>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(ShipmentMilestone)
    private readonly milestoneRepo: Repository<ShipmentMilestone>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly documentsService: DocumentsService,
    private readonly escrowService: EscrowService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly queueService: QueueService,
    private readonly dataSource: DataSource,
    @Optional() private readonly logger?: PinoLogger,
  ) {
    (this.logger as any)?.setContext?.(DisputesService.name);
  }

  toResponseDto(dispute: Dispute): DisputeResponseDto {
    return {
      id: dispute.id,
      deal_id: dispute.dealId,
      raised_by: dispute.raisedBy,
      reason: dispute.reason,
      evidence_urls: dispute.evidenceUrls ?? [],
      status: dispute.status,
      reviewed_by: dispute.reviewedBy ?? null,
      resolution_notes: dispute.resolutionNotes ?? null,
      resolved_at: dispute.resolvedAt ?? null,
      escalated_at: dispute.escalatedAt ?? null,
      created_at: dispute.createdAt,
      updated_at: dispute.updatedAt,
    };
  }

  async createDispute(
    userId: string,
    dto: CreateDisputeDto,
  ): Promise<DisputeResponseDto> {
    const dealId = dto.deal_id ?? dto.dealId;
    if (!dealId) {
      throw new BadRequestException('deal_id is required.');
    }

    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found.`);
    }

    if (deal.status === 'DISPUTED') {
      throw new ConflictException({
        code: 'DEAL_ALREADY_DISPUTED',
        message: 'This deal already has an active dispute.',
      });
    }

    if (deal.status !== 'funded') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_DISPUTABLE',
        message: `Disputes can only be raised for funded deals (current status: ${deal.status}).`,
      });
    }

    const investorPosition = await this.investmentRepo.findOne({
      where: {
        tradeDealId: dealId,
        investorId: userId,
        status: In([InvestmentStatus.CONFIRMED, InvestmentStatus.ACTIVE]),
      },
    });
    if (!investorPosition) {
      throw new ForbiddenException({
        code: 'NOT_DEAL_INVESTOR',
        message: 'Only confirmed investors in this deal can raise a dispute.',
      });
    }

    const importerMilestone = await this.milestoneRepo.findOne({
      where: { tradeDealId: dealId, milestone: 'importer' },
    });
    if (importerMilestone) {
      throw new UnprocessableEntityException({
        code: 'IMPORTER_MILESTONE_RECORDED',
        message:
          'Cannot raise an undelivered shipment dispute after the Importer milestone has been recorded.',
      });
    }

    const deliveryDeadline = new Date(deal.deliveryDate);
    const disputeEligibilityDate = new Date(
      deliveryDeadline.getTime() + FOURTEEN_DAYS_MS,
    );
    if (Date.now() < disputeEligibilityDate.getTime()) {
      throw new UnprocessableEntityException({
        code: 'DISPUTE_WINDOW_NOT_OPEN',
        message:
          'A dispute can only be raised once 14 days have elapsed past the expected delivery date without an Importer milestone.',
      });
    }

    const existingActive = await this.disputeRepo.findOne({
      where: {
        dealId,
        status: In(ACTIVE_DISPUTE_STATUSES),
      },
    });
    if (existingActive) {
      throw new ConflictException({
        code: 'DISPUTE_ALREADY_EXISTS',
        message: 'An active dispute already exists for this deal.',
      });
    }

    const evidenceUrls = Array.from(
      new Set([...(dto.evidence_urls ?? []), ...(dto.evidenceUrls ?? [])]),
    );

    const saved = await this.dataSource.transaction(async (manager) => {
      const dispute = manager.create(Dispute, {
        dealId,
        raisedBy: userId,
        reason: dto.reason.trim(),
        evidenceUrls,
        status: DisputeStatus.OPEN,
      });
      const created = await manager.save(Dispute, dispute);

      const appTraceId = `app-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
      await manager.update(TradeDeal, dealId, {
        status: 'DISPUTED',
        appTraceId,
      });

      return created;
    });

    await this.logAuditEvent(
      userId,
      'investor',
      'POST /v1/disputes',
      'dispute.created',
      saved.id,
      201,
      { dealId, reason: saved.reason, evidenceCount: evidenceUrls.length },
    );

    await this.notifyDisputeRaised(deal, saved);

    return this.toResponseDto(saved);
  }

  async findAll(user: User): Promise<DisputeResponseDto[]> {
    if (user.role === 'admin' || user.role === 'compliance_officer') {
      const all = await this.disputeRepo.find({
        order: { createdAt: 'DESC' },
      });
      return all.map((d) => this.toResponseDto(d));
    }

    const disputes = await this.disputeRepo
      .createQueryBuilder('dispute')
      .leftJoin('dispute.deal', 'deal')
      .where('dispute.raisedBy = :userId', { userId: user.id })
      .orWhere('deal.farmerId = :userId', { userId: user.id })
      .orWhere('deal.traderId = :userId', { userId: user.id })
      .orderBy('dispute.createdAt', 'DESC')
      .getMany();

    return disputes.map((d) => this.toResponseDto(d));
  }

  async findOne(id: string, user: User): Promise<DisputeResponseDto> {
    const dispute = await this.disputeRepo.findOne({
      where: { id },
      relations: ['deal'],
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${id} not found.`);
    }

    const isAdmin = user.role === 'admin' || user.role === 'compliance_officer';
    const isParty =
      dispute.raisedBy === user.id ||
      dispute.deal?.farmerId === user.id ||
      dispute.deal?.traderId === user.id;

    if (!isAdmin && !isParty) {
      throw new ForbiddenException(
        'You do not have permission to view this dispute.',
      );
    }

    return this.toResponseDto(dispute);
  }

  async uploadEvidence(
    disputeId: string,
    userId: string,
    userRole: string,
    file: Express.Multer.File,
  ): Promise<DisputeResponseDto> {
    if (!file) {
      throw new BadRequestException('Evidence file is required.');
    }

    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
      relations: ['deal'],
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found.`);
    }

    if (!ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
      throw new UnprocessableEntityException({
        code: 'DISPUTE_ALREADY_RESOLVED',
        message: 'Cannot upload evidence to a resolved dispute.',
      });
    }

    const isAdmin = userRole === 'admin' || userRole === 'compliance_officer';
    const isParty =
      dispute.raisedBy === userId ||
      dispute.deal?.farmerId === userId ||
      dispute.deal?.traderId === userId;

    if (!isAdmin && !isParty) {
      throw new ForbiddenException(
        'You do not have permission to upload evidence for this dispute.',
      );
    }

    const uploaded = await this.documentsService.handleUpload({
      file,
      docType: 'dispute_evidence',
      tradeDealId: dispute.dealId,
      userId,
    });

    const evidenceUrl =
      (uploaded as any).storageUrl ??
      (uploaded as any).storage_url ??
      (uploaded as any).verificationUrl;

    if (evidenceUrl) {
      dispute.evidenceUrls = Array.from(
        new Set([...(dispute.evidenceUrls ?? []), evidenceUrl]),
      );
    }

    const updated = await this.disputeRepo.save(dispute);

    await this.logAuditEvent(
      userId,
      userRole,
      `POST /v1/disputes/${disputeId}/evidence`,
      'dispute.evidence_uploaded',
      dispute.id,
      201,
      {
        dealId: dispute.dealId,
        documentId: (uploaded as any).id,
        evidenceUrl,
      },
    );

    return this.toResponseDto(updated);
  }

  async startReview(
    disputeId: string,
    adminId: string,
  ): Promise<DisputeResponseDto> {
    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found.`);
    }

    if (
      dispute.status !== DisputeStatus.OPEN &&
      dispute.status !== DisputeStatus.ESCALATED
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DISPUTE_TRANSITION',
        message: `Cannot move dispute in "${dispute.status}" status to UNDER_REVIEW.`,
      });
    }

    dispute.status = DisputeStatus.UNDER_REVIEW;
    dispute.reviewedBy = adminId;
    const saved = await this.disputeRepo.save(dispute);

    await this.logAuditEvent(
      adminId,
      'admin',
      `PATCH /v1/disputes/${disputeId}/review`,
      'dispute.under_review',
      dispute.id,
      200,
      { dealId: dispute.dealId },
    );

    return this.toResponseDto(saved);
  }

  async resolveDispute(
    disputeId: string,
    adminId: string,
    dto: ResolveDisputeDto,
  ): Promise<DisputeResponseDto> {
    const dispute = await this.disputeRepo.findOne({
      where: { id: disputeId },
    });
    if (!dispute) {
      throw new NotFoundException(`Dispute ${disputeId} not found.`);
    }

    if (!ACTIVE_DISPUTE_STATUSES.includes(dispute.status)) {
      throw new UnprocessableEntityException({
        code: 'DISPUTE_ALREADY_RESOLVED',
        message: `Dispute is already resolved with status "${dispute.status}".`,
      });
    }

    if (dto.resolution === 'release_farmer') {
      await this.escrowService.releaseDisputedEscrowToFarmer(dispute.dealId);
      dispute.status = DisputeStatus.RESOLVED_FARMER;
    } else {
      await this.escrowService.refundDisputedEscrowToInvestors(dispute.dealId);
      dispute.status = DisputeStatus.RESOLVED_INVESTOR;
    }

    dispute.reviewedBy = adminId;
    dispute.resolutionNotes = dto.notes?.trim() ?? null;
    dispute.resolvedAt = new Date();
    const saved = await this.disputeRepo.save(dispute);

    await this.logAuditEvent(
      adminId,
      'admin',
      `POST /v1/disputes/${disputeId}/resolve`,
      'dispute.resolved',
      dispute.id,
      200,
      {
        dealId: dispute.dealId,
        resolution: dto.resolution,
        status: saved.status,
        notes: saved.resolutionNotes,
      },
    );

    try {
      await this.notificationsService.createNotification({
        userId: dispute.raisedBy,
        type: 'deal',
        title: 'Escrow dispute resolved',
        message:
          dto.resolution === 'release_farmer'
            ? 'Your shipment dispute was resolved and escrow has been released to the farmer.'
            : 'Your shipment dispute was resolved in favor of investors and refunds have been issued.',
        linkUrl: `/marketplace/${dispute.dealId}`,
        metadataJson: {
          disputeId: dispute.id,
          dealId: dispute.dealId,
          status: saved.status,
        },
      });
    } catch (err: any) {
      this.logger?.warn?.(
        { disputeId: dispute.id, error: err?.message },
        'Failed to send dispute resolution notification',
      );
    }

    return this.toResponseDto(saved);
  }

  /**
   * Nightly cron (#1387) checking the 14-day dispute deadline:
   *  1. Unresolved OPEN/UNDER_REVIEW disputes older than 14 days are escalated
   *     to ESCALATED and trigger an admin alert + audit log entry.
   *  2. Already ESCALATED unresolved disputes trigger a follow-up alert.
   */
  @Cron('0 3 * * *')
  async checkFourteenDayDeadlines(now = new Date()): Promise<{
    escalatedCount: number;
    alertedCount: number;
  }> {
    const cutoff = new Date(now.getTime() - FOURTEEN_DAYS_MS);
    let escalatedCount = 0;
    let alertedCount = 0;

    const overdueDisputes = await this.disputeRepo.find({
      where: {
        status: In([
          DisputeStatus.OPEN,
          DisputeStatus.UNDER_REVIEW,
          DisputeStatus.ESCALATED,
        ]),
        createdAt: LessThanOrEqual(cutoff),
      },
    });

    if (overdueDisputes.length === 0) {
      return { escalatedCount, alertedCount };
    }

    const admins = await this.userRepo.find({
      where: { role: 'admin' },
      select: ['id'],
    });

    for (const dispute of overdueDisputes) {
      if (dispute.status !== DisputeStatus.ESCALATED) {
        dispute.status = DisputeStatus.ESCALATED;
        dispute.escalatedAt = now;
        await this.disputeRepo.save(dispute);
        escalatedCount += 1;

        await this.logAuditEvent(
          'system',
          'system',
          'cron/disputes/14-day-deadline',
          'dispute.escalated',
          dispute.id,
          200,
          { dealId: dispute.dealId, escalatedAt: now.toISOString() },
        );
      }

      try {
        await this.queueService.emit('admin.alert', {
          type: 'dispute_14_day_unresolved',
          disputeId: dispute.id,
          dealId: dispute.dealId,
          status: dispute.status,
          createdAt: dispute.createdAt?.toISOString?.() ?? null,
          timestamp: now.toISOString(),
        });
      } catch (err: any) {
        this.logger?.warn?.(
          { disputeId: dispute.id, error: err?.message },
          'Failed to emit queue alert for unresolved dispute',
        );
      }

      for (const admin of admins) {
        try {
          await this.notificationsService.createNotification({
            userId: admin.id,
            type: 'alert',
            title: 'Unresolved Escrow Dispute Past 14-Day Deadline',
            message: `Dispute ${dispute.id} for deal ${dispute.dealId} remains unresolved past the 14-day deadline.`,
            linkUrl: `/dashboard/admin`,
            metadataJson: {
              disputeId: dispute.id,
              dealId: dispute.dealId,
              status: dispute.status,
            },
          });
        } catch (err: any) {
          this.logger?.warn?.(
            { adminId: admin.id, disputeId: dispute.id, error: err?.message },
            'Failed to notify admin of unresolved dispute',
          );
        }
      }

      await this.logAuditEvent(
        'system',
        'system',
        'cron/disputes/14-day-deadline',
        'dispute.deadline_alert_sent',
        dispute.id,
        200,
        { dealId: dispute.dealId, status: dispute.status },
      );

      alertedCount += 1;
    }

    return { escalatedCount, alertedCount };
  }

  private async notifyDisputeRaised(
    deal: TradeDeal,
    dispute: Dispute,
  ): Promise<void> {
    const recipientIds = new Set<string>();
    if (deal.farmerId) recipientIds.add(deal.farmerId);
    if (deal.traderId) recipientIds.add(deal.traderId);

    for (const recipientId of recipientIds) {
      try {
        await this.notificationsService.createNotification({
          userId: recipientId,
          type: 'alert',
          title: 'Escrow dispute opened',
          message: `An investor raised a shipment dispute on deal ${deal.tokenSymbol}.`,
          linkUrl: `/marketplace/${deal.id}`,
          metadataJson: { disputeId: dispute.id, dealId: deal.id },
        });
      } catch (err: any) {
        this.logger?.warn?.(
          { recipientId, disputeId: dispute.id, error: err?.message },
          'Failed to notify deal party about new dispute',
        );
      }
    }

    try {
      await this.queueService.emit('admin.alert', {
        type: 'dispute_opened',
        disputeId: dispute.id,
        dealId: deal.id,
        raisedBy: dispute.raisedBy,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger?.warn?.(
        { disputeId: dispute.id, error: err?.message },
        'Failed to emit admin alert for new dispute',
      );
    }
  }

  private async logAuditEvent(
    actorId: string,
    actorRole: string,
    route: string,
    action: string,
    resourceId: string,
    statusCode: number,
    requestDetails: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.logEvent({
      actorId,
      actorRole,
      route,
      action,
      resourceType: 'dispute',
      resourceId,
      statusCode,
      requestDetails,
    });
  }
}
