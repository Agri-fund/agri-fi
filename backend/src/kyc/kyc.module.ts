import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { KycService } from './kyc.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Investment]), NotificationsModule],
  providers: [KycService],
  exports: [KycService],
})
export class KycModule {}
