import {
  Controller,
  Get,
  Query,
  Request,
  UseGuards,
  Version,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ReferralTrackingService,
  ReferralEvent,
} from './referral-tracking.service';
import { Referral } from '../auth/entities/referral.entity';
import { User } from '../auth/entities/user.entity';

interface AuthRequest extends Request {
  user: User;
}

/**
 * Converts persisted referral rows into the flat event stream expected by
 * ReferralTrackingService funnel math (#1018).
 */
function referralsToEvents(referrals: Referral[]): ReferralEvent[] {
  const events: ReferralEvent[] = [];

  for (const referral of referrals) {
    const channel = referral.channel || 'unknown';
    const createdAt = referral.createdAt;

    // Every referral starts as a click
    events.push({
      id: `${referral.id}-click`,
      type: 'click',
      channel,
      createdAt,
    });

    if (referral.status === 'registered' || referral.status === 'rewarded') {
      events.push({
        id: `${referral.id}-signup`,
        type: 'signup',
        channel,
        createdAt,
        referredUserId: referral.refereeId ?? undefined,
      });
    }

    if (referral.status === 'rewarded') {
      // First investment activates the referral and accrues the reward
      events.push({
        id: `${referral.id}-activated`,
        type: 'activated',
        channel,
        createdAt,
        referredUserId: referral.refereeId ?? undefined,
      });
      events.push({
        id: `${referral.id}-reward`,
        type: 'reward',
        channel,
        createdAt,
        amount: Number(referral.rewardAmount ?? 0),
        payoutStatus: referral.payoutStatus ?? 'accrued',
      });
    }
  }

  return events;
}

@ApiTags('referrals')
@ApiBearerAuth('jwt')
@Controller({ path: 'referrals', version: '1' })
export class ReferralsController {
  constructor(
    private readonly referralTrackingService: ReferralTrackingService,
    @InjectRepository(Referral)
    private readonly referralRepo: Repository<Referral>,
  ) {}

  @Get('analytics')
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({
    summary: 'Get referral funnel and reward analytics by channel (#1018)',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Filter the response to a specific channel',
  })
  @ApiResponse({ status: 200, description: 'Referral funnel analytics' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAnalytics(
    @Request() req: AuthRequest,
    @Query('channel') channel?: string,
  ) {
    const referrals = await this.referralRepo.find({
      where: { referrerId: req.user.id },
      order: { createdAt: 'ASC' },
    });

    let events = referralsToEvents(referrals);

    if (channel) {
      events = events.filter(
        (event) => event.channel?.toLowerCase() === channel.toLowerCase(),
      );
    }

    return this.referralTrackingService.buildAnalytics(events);
  }
}
