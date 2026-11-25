import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import {
  PriceNegotiation,
  PriceNegotiationStatus,
} from './entities/price-negotiation.entity';
import { TradeDeal } from './entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateNegotiationDto,
  UpdateNegotiationDto,
} from './dto/price-negotiation.dto';

const MAX_NEGOTIATION_ROUNDS = 10;
const FINALIZED_STATUSES = [
  'funded',
  'delivered',
  'completed',
  'failed',
  'canceled',
  'expired',
];

@Injectable()
export class PriceNegotiationsService {
  constructor(
    @InjectRepository(PriceNegotiation)
    private readonly negotiationRepo: Repository<PriceNegotiation>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Optional()
    private readonly notificationsService?: NotificationsService,
    @Optional()
    private readonly logger?: PinoLogger,
  ) {
    if (this.logger && typeof (this.logger as any).setContext === 'function') {
      (this.logger as any).setContext(PriceNegotiationsService.name);
    }
  }

  /**
   * Submits a new price proposal or counter-offer on a trade deal.
   * If a previous proposal is PENDING, it transitions to COUNTERED.
   * Caps negotiations at 10 rounds per deal.
   */
  async submitProposal(
    dealId: string,
    userId: string,
    userRole: string,
    dto: CreateNegotiationDto,
  ): Promise<PriceNegotiation> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
    });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    if (FINALIZED_STATUSES.includes(deal.status)) {
      throw new BadRequestException(
        `Cannot negotiate price on a ${deal.status} deal`,
      );
    }

    const isFarmer = deal.farmerId === userId;
    const isTrader = deal.traderId === userId;
    const isAdmin = userRole === 'admin';

    if (!isFarmer && !isTrader && !isAdmin) {
      throw new ForbiddenException(
        'Only the farmer or trader of this deal can propose prices',
      );
    }

    const roundCount = await this.negotiationRepo.count({
      where: { dealId },
    });
    if (roundCount >= MAX_NEGOTIATION_ROUNDS) {
      throw new BadRequestException(
        `Maximum ${MAX_NEGOTIATION_ROUNDS} rounds of negotiation reached for this deal`,
      );
    }

    // If there is an existing PENDING proposal, counter it
    const activePending = await this.negotiationRepo.findOne({
      where: { dealId, status: PriceNegotiationStatus.PENDING },
      order: { createdAt: 'DESC' },
    });

    if (activePending) {
      activePending.status = PriceNegotiationStatus.COUNTERED;
      await this.negotiationRepo.save(activePending);
    }

    const proposal = this.negotiationRepo.create({
      dealId,
      proposerId: userId,
      proposedPrice: Number(dto.proposed_price),
      message: dto.message || null,
      status: PriceNegotiationStatus.PENDING,
    });

    const saved = await this.negotiationRepo.save(proposal);

    // Notify counterpart & all parties
    await this.notifyParties(
      deal,
      userId,
      `New price proposal: $${Number(dto.proposed_price).toLocaleString()} offered for ${deal.title || deal.commodity}`,
      dto.message || undefined,
      'proposal',
    );

    return saved;
  }

  /**
   * Accepts or rejects a pending price negotiation proposal.
   * On acceptance, automatically updates trade_deals.total_value.
   */
  async respondToProposal(
    dealId: string,
    negotiationId: string,
    userId: string,
    userRole: string,
    dto: UpdateNegotiationDto,
  ): Promise<PriceNegotiation> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
    });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    const negotiation = await this.negotiationRepo.findOne({
      where: { id: negotiationId, dealId },
    });
    if (!negotiation) {
      throw new NotFoundException(
        `Negotiation ${negotiationId} not found on deal ${dealId}`,
      );
    }

    if (negotiation.status !== PriceNegotiationStatus.PENDING) {
      throw new BadRequestException(
        `Negotiation is already ${negotiation.status} and cannot be modified`,
      );
    }

    const isAdmin = userRole === 'admin';
    const isProposer = negotiation.proposerId === userId;
    const isParty = deal.farmerId === userId || deal.traderId === userId;

    if (!isParty && !isAdmin) {
      throw new ForbiddenException(
        'Only the farmer or trader of this deal can respond to negotiations',
      );
    }

    if (isProposer && !isAdmin) {
      throw new BadRequestException(
        'Cannot accept or reject your own proposal',
      );
    }

    const action = (dto.action || dto.status || '').toUpperCase();
    if (action === 'ACCEPT' || action === PriceNegotiationStatus.ACCEPTED) {
      negotiation.status = PriceNegotiationStatus.ACCEPTED;
      await this.negotiationRepo.save(negotiation);

      // Automatically update trade_deals.total_value
      deal.totalValue = Number(negotiation.proposedPrice);
      await this.tradeDealRepo.save(deal);

      await this.notifyParties(
        deal,
        userId,
        `Price proposal accepted: total deal value updated to $${Number(negotiation.proposedPrice).toLocaleString()}`,
        dto.message || undefined,
        'accepted',
      );
    } else if (
      action === 'REJECT' ||
      action === PriceNegotiationStatus.REJECTED
    ) {
      negotiation.status = PriceNegotiationStatus.REJECTED;
      await this.negotiationRepo.save(negotiation);

      await this.notifyParties(
        deal,
        userId,
        `Price proposal of $${Number(negotiation.proposedPrice).toLocaleString()} was rejected`,
        dto.message || undefined,
        'rejected',
      );
    } else {
      throw new BadRequestException(
        `Invalid status or action: must be ACCEPTED or REJECTED`,
      );
    }

    return negotiation;
  }

  /**
   * Retrieves the negotiation thread history for a deal.
   * Visible ONLY to the deal's farmer and trader (and admin).
   */
  async getNegotiations(
    dealId: string,
    userId: string,
    userRole: string,
  ): Promise<PriceNegotiation[]> {
    const deal = await this.tradeDealRepo.findOne({
      where: { id: dealId },
    });
    if (!deal) {
      throw new NotFoundException(`Trade deal ${dealId} not found`);
    }

    const isFarmer = deal.farmerId === userId;
    const isTrader = deal.traderId === userId;
    const isAdmin = userRole === 'admin';

    if (!isFarmer && !isTrader && !isAdmin) {
      throw new ForbiddenException(
        'Negotiation history is only visible to the deal farmer and trader',
      );
    }

    return this.negotiationRepo.find({
      where: { dealId },
      order: { createdAt: 'ASC' },
      relations: ['proposer'],
    });
  }

  /**
   * Dispatches in-app notifications and emails to both farmer and trader on each round.
   */
  private async notifyParties(
    deal: TradeDeal,
    actorId: string,
    summary: string,
    messageDetail?: string,
    event?: 'proposal' | 'accepted' | 'rejected',
  ): Promise<void> {
    if (!this.notificationsService) {
      return;
    }

    const partyIds = Array.from(
      new Set([deal.farmerId, deal.traderId].filter(Boolean)),
    );

    const users = await this.userRepo.find({
      where: partyIds.map((id) => ({ id })),
    });

    const linkUrl = `/marketplace/${deal.id}`;

    for (const user of users) {
      // In-app notification
      try {
        await this.notificationsService.createNotification({
          userId: user.id,
          type: 'deal',
          title: `Price Negotiation: ${deal.title || deal.commodity}`,
          message: summary + (messageDetail ? ` — "${messageDetail}"` : ''),
          linkUrl,
          metadataJson: {
            dealId: deal.id,
            actorId,
            event,
          },
        });
      } catch (err: any) {
        if (this.logger) {
          this.logger.warn(
            `Failed to create negotiation notification for user ${user.id}: ${err.message}`,
          );
        }
      }

      // Email notification
      if (user.email) {
        try {
          const subject = `AgriFi — Deal Price Negotiation Update: ${deal.title || deal.commodity}`;
          const text = `Hello ${user.fullName || 'User'},\n\nThere is an update to the price negotiation on deal "${deal.title || deal.commodity}":\n\n${summary}\n${messageDetail ? `Note: ${messageDetail}\n` : ''}\nView deal: ${linkUrl}\n\nBest regards,\nThe AgriFi Team`;
          const html = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 8px;">
              <h2 style="color: #0f172a; margin-top: 0;">Deal Price Negotiation Update</h2>
              <p>Hello <strong>${user.fullName || 'User'}</strong>,</p>
              <p>There is an update on trade deal <strong>${deal.title || deal.commodity}</strong>:</p>
              <div style="background-color: #f8fafc; border-left: 4px solid #10b981; padding: 12px 16px; margin: 16px 0;">
                <p style="margin: 0; font-weight: 600; color: #1e293b;">${summary}</p>
                ${messageDetail ? `<p style="margin: 8px 0 0; color: #64748b; font-style: italic;">"${messageDetail}"</p>` : ''}
              </div>
              <p style="margin-top: 24px;">
                <a href="${linkUrl}" style="background-color: #10b981; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block;">
                  View Negotiation Thread
                </a>
              </p>
            </div>
          `;
          await this.notificationsService.sendEmail(
            user.email,
            subject,
            text,
            html,
          );
        } catch (err: any) {
          if (this.logger) {
            this.logger.warn(
              `Failed to send negotiation email to ${user.email}: ${err.message}`,
            );
          }
        }
      }
    }
  }
}
