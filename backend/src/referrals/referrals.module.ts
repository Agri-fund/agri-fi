import { Module } from '@nestjs/common';
import { ReferralTrackingService } from './referral-tracking.service';
import { ReferralsController } from './referrals.controller';

@Module({
  controllers: [ReferralsController],
  providers: [ReferralTrackingService],
  exports: [ReferralTrackingService],
})
export class ReferralsModule {}
