import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralTrackingService } from './referral-tracking.service';
import { ReferralsController } from './referrals.controller';
import { Referral } from '../auth/entities/referral.entity';
import { ReferralCode } from '../auth/entities/referral-code.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Referral, ReferralCode])],
  controllers: [ReferralsController],
  providers: [ReferralTrackingService],
  exports: [ReferralTrackingService],
})
export class ReferralsModule {}
