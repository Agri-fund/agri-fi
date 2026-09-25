import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { InvestorEmailSequence } from './entities/investor-email-sequence.entity';
import { EmailSequenceService } from './email-sequence.service';
import { EmailSequenceController } from './email-sequence.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../auth/entities/user.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([InvestorEmailSequence, User]),
    NotificationsModule,
  ],
  controllers: [EmailSequenceController],
  providers: [EmailSequenceService],
  exports: [EmailSequenceService],
})
export class EmailSequenceModule {}
