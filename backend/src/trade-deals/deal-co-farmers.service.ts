import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import {
  DealCoFarmer,
  DealCoFarmerStatus,
} from './entities/deal-co-farmer.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { QueueService } from '../queue/queue.service';
import { InviteCoFarmerDto } from './dto/co-farmer.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Co-investment workflow for deals (#891): a lead farmer (or the assigned
 * trader) invites other farmer users onto a deal, each responsible for a
 * defined portion% of delivery and payout. A deal cannot be activated until
 * every co-farmer has accepted and passed KYC verification.
 */
@Injectable()
export class DealCoFarmersService {
  constructor(
    @InjectRepository(DealCoFarmer)
    private readonly coFarmerRepo: Repository<DealCoFarmer>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly queueService: QueueService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DealCoFarmersService.name);
  }

  /** Invites a co-farmer onto a deal by email or Stellar wallet address. */
  async inviteCoFarmer(
    dealId: string,
    inviterId: string,
    dto: InviteCoFarmerDto,
  ): Promise<DealCoFarmer> {
    if (!dto.email && !dto.walletAddress) {
      throw new BadRequestException({
        code: 'MISSING_INVITE_TARGET',
        message: 'Either email or walletAddress is required.',
      });
    }

    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Trade deal not found.');

    // Only the lead farmer or assigned trader can invite co-farmers.
    if (deal.farmerId !== inviterId && deal.traderId !== inviterId) {
      throw new ForbiddenException({
        code: 'NOT_DEAL_OWNER',
        message:
          'Only the lead farmer or assigned trader can invite co-farmers.',
      });
    }

    if (deal.status !== 'draft' && deal.status !== 'open') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_MODIFIABLE',
        message:
          'Co-farmers can only be invited while the deal is draft or open.',
      });
    }

    const target = await this.userRepo.findOne({
      where: dto.walletAddress
        ? { walletAddress: dto.walletAddress }
        : { email: dto.email!.toLowerCase() },
    });
    if (!target || target.role !== 'farmer') {
      throw new BadRequestException({
        code: 'INVALID_CO_FARMER',
        message:
          'Invite target must be an existing user with the "farmer" role.',
      });
    }
    if (target.id === deal.farmerId) {
      throw new ConflictException({
        code: 'LEAD_FARMER_CONFLICT',
        message: 'The lead farmer cannot be invited as a co-farmer.',
      });
    }

    const existing = await this.coFarmerRepo.findOne({
      where: { tradeDealId: dealId, farmerId: target.id },
    });
    if (existing && existing.status !== 'removed') {
      throw new ConflictException({
        code: 'ALREADY_INVITED',
        message: 'This user is already a co-farmer on the deal.',
      });
    }

    // Portions of all active co-farmers plus the new one must fit in 100%.
    const rows = await this.coFarmerRepo.find({
      where: { tradeDealId: dealId },
    });
    const committedPortions = rows
      .filter((r) => r.status !== 'removed' && r.farmerId !== target.id)
      .reduce((sum, r) => sum + Number(r.portionPercent), 0);
    if (committedPortions + Number(dto.portionPercent) > 100) {
      throw new BadRequestException({
        code: 'PORTION_EXCEEDS_TOTAL',
        message: `Total portions would exceed 100%. Already committed: ${committedPortions}%.`,
      });
    }

    const token = randomBytes(32).toString('hex');

    let record: DealCoFarmer;
    if (existing) {
      // Re-invite a previously removed/declined co-farmer
      existing.status = 'invited';
      existing.portionPercent = dto.portionPercent;
      existing.invitedEmail = target.email;
      existing.invitationToken = token;
      existing.invitationExpiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      existing.invitedBy = inviterId;
      record = await this.coFarmerRepo.save(existing);
    } else {
      record = await this.coFarmerRepo.save(
        this.coFarmerRepo.create({
          tradeDealId: dealId,
          farmerId: target.id,
          portionPercent: dto.portionPercent,
          status: 'invited' as DealCoFarmerStatus,
          invitedEmail: target.email,
          invitationToken: token,
          invitationExpiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          invitedBy: inviterId,
        }),
      );
    }

    await this.sendInvitationEmail(deal, record, inviterId);

    this.logger.info(
      { dealId, coFarmerId: record.id },
      'Co-farmer invitation created',
    );
    return record;
  }

  /** Co-farmer accepts an outstanding invitation. */
  async acceptInvitation(
    dealId: string,
    userId: string,
    token: string,
  ): Promise<DealCoFarmer> {
    const record = await this.findInvitation(dealId, userId);

    if (
      record.invitationToken !== token ||
      !record.invitationExpiresAt ||
      record.invitationExpiresAt < new Date()
    ) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired invitation token.',
      });
    }

    record.status = 'accepted';
    record.acceptedAt = new Date();
    record.invitationToken = null;
    return this.coFarmerRepo.save(record);
  }

  /** Co-farmer declines an outstanding invitation. */
  async declineInvitation(
    dealId: string,
    userId: string,
    token: string,
  ): Promise<DealCoFarmer> {
    const record = await this.findInvitation(dealId, userId);

    if (record.invitationToken !== token) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        message: 'Invalid invitation token.',
      });
    }

    record.status = 'declined';
    record.declinedAt = new Date();
    record.invitationToken = null;
    return this.coFarmerRepo.save(record);
  }

  /** Removes a co-farmer before activation (lead farmer or trader only). */
  async removeCoFarmer(
    dealId: string,
    farmerId: string,
    requesterId: string,
  ): Promise<void> {
    const deal = await this.tradeDealRepo.findOne({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Trade deal not found.');
    if (deal.farmerId !== requesterId && deal.traderId !== requesterId) {
      throw new ForbiddenException({
        code: 'NOT_DEAL_OWNER',
        message:
          'Only the lead farmer or assigned trader can remove co-farmers.',
      });
    }
    if (deal.status === 'delivered' || deal.status === 'completed') {
      throw new UnprocessableEntityException({
        code: 'DEAL_NOT_MODIFIABLE',
        message: 'Co-farmers cannot be removed after delivery.',
      });
    }

    const record = await this.coFarmerRepo.findOne({
      where: { tradeDealId: dealId, farmerId },
    });
    if (!record) throw new NotFoundException('Co-farmer not found.');

    record.status = 'removed';
    await this.coFarmerRepo.save(record);
  }

  listCoFarmers(dealId: string): Promise<DealCoFarmer[]> {
    return this.coFarmerRepo.find({
      where: { tradeDealId: dealId },
      relations: ['farmer'],
    });
  }

  /**
   * KYC gate (#891): every co-farmer must have accepted the invitation AND be
   * KYC verified before the deal can go live. Throws when the gate fails.
   */
  async assertAllCoFarmersVerified(dealId: string): Promise<void> {
    const records = await this.coFarmerRepo.find({
      where: { tradeDealId: dealId },
      relations: ['farmer'],
    });

    if (records.length === 0) return;

    const blocking: Record<string, unknown>[] = [];
    for (const record of records) {
      if (record.status === 'removed') continue;
      if (record.status !== 'accepted') {
        blocking.push({
          farmerId: record.farmerId,
          reason: 'invitation_not_accepted',
        });
      } else if (record.farmer?.kycStatus !== 'verified') {
        blocking.push({
          farmerId: record.farmerId,
          reason: `kyc_${record.farmer?.kycStatus ?? 'unknown'}`,
        });
      }
    }

    if (blocking.length > 0) {
      throw new UnprocessableEntityException({
        code: 'CO_FARMERS_NOT_VERIFIED',
        message:
          'All co-farmers must accept the invitation and pass KYC verification before the deal can go live.',
        details: blocking,
      });
    }
  }

  /** Returns accepted, non-removed co-farmer portions keyed by farmer id. */
  async getAcceptedPortions(dealId: string): Promise<DealCoFarmer[]> {
    return this.coFarmerRepo.find({
      where: { tradeDealId: dealId, status: 'accepted' },
    });
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async findInvitation(
    dealId: string,
    userId: string,
  ): Promise<DealCoFarmer> {
    const record = await this.coFarmerRepo.findOne({
      where: { tradeDealId: dealId, farmerId: userId },
    });

    if (!record || record.status === 'removed') {
      throw new NotFoundException(
        'No invitation found for this user on the deal.',
      );
    }
    if (record.status === 'accepted') {
      throw new ConflictException({
        code: 'ALREADY_ACCEPTED',
        message: 'Invitation has already been accepted.',
      });
    }

    return record;
  }

  private async sendInvitationEmail(
    deal: TradeDeal,
    record: DealCoFarmer,
    inviterId: string,
  ): Promise<void> {
    try {
      const inviter = await this.userRepo.findOne({ where: { id: inviterId } });
      const acceptUrl = `${this.config.get<string>('APP_BASE_URL', 'http://localhost:3001')}/dashboard/deals/${deal.id}/co-farmers/accept?token=${record.invitationToken ?? ''}`;

      await this.queueService.emit('email.notification', {
        type: 'co_farmer_invitation',
        userId: record.farmerId,
        dealId: deal.id,
        dealDetails: {
          dealName: deal.commodity,
          portionPercent: Number(record.portionPercent),
          leadFarmerName: inviter?.fullName ?? undefined,
        },
        acceptUrl,
      });
    } catch (error: any) {
      // Invitation emails are best-effort; the record carries the token.
      this.logger.warn(
        { dealId: deal.id, error: error.message },
        'Failed to enqueue co-farmer invitation email',
      );
    }
  }
}
