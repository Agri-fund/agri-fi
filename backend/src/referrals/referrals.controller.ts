import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReferralTrackingService, ReferralEvent } from './referral-tracking.service';

const DEFAULT_REFERRAL_EVENTS: ReferralEvent[] = [
  { id: 'click-1', type: 'click', channel: 'email', createdAt: '2024-01-10T09:00:00.000Z' },
  { id: 'click-2', type: 'click', channel: 'email', createdAt: '2024-01-10T10:00:00.000Z' },
  { id: 'click-3', type: 'click', channel: 'social', createdAt: '2024-01-11T11:00:00.000Z' },
  { id: 'signup-1', type: 'signup', channel: 'email', createdAt: '2024-01-12T09:00:00.000Z' },
  { id: 'signup-2', type: 'signup', channel: 'social', createdAt: '2024-01-12T12:00:00.000Z' },
  { id: 'activated-1', type: 'activated', channel: 'email', createdAt: '2024-01-16T09:00:00.000Z' },
  { id: 'reward-1', type: 'reward', channel: 'email', amount: 15, createdAt: '2024-01-18T09:00:00.000Z' },
  { id: 'reward-2', type: 'reward', channel: 'social', amount: 7.5, createdAt: '2024-01-19T09:00:00.000Z' },
];

@ApiTags('referrals')
@Controller('referrals')
export class ReferralsController {
  constructor(private readonly referralTrackingService: ReferralTrackingService) {}

  @Get('analytics')
  @ApiOperation({ summary: 'Get referral funnel and reward analytics by channel' })
  @ApiQuery({ name: 'channel', required: false, description: 'Filter the response to a specific channel' })
  @ApiResponse({ status: 200, description: 'Referral funnel analytics' })
  getAnalytics(@Query('channel') channel?: string) {
    const source = DEFAULT_REFERRAL_EVENTS.filter((event) => {
      if (!channel) return true;
      return event.channel?.toLowerCase() === channel.toLowerCase();
    });

    const analytics = this.referralTrackingService.buildAnalytics(source);
    return analytics;
  }
}
