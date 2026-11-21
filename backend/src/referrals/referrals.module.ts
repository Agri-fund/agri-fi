import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferralTrackingService } from './referral-tracking.service';
import { ReferralCreditService } from './referral-credit.service';
import { ReferralsController } from './referrals.controller';
import { Referral } from '../auth/entities/referral.entity';
import { ReferralCode } from '../auth/entities/referral-code.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Referral, ReferralCode, User]),
    NotificationsModule,
    QueueModule,
  ],
  controllers: [ReferralsController],
  providers: [ReferralTrackingService, ReferralCreditService],
  exports: [ReferralTrackingService, ReferralCreditService],
})
export class ReferralsModule {}
