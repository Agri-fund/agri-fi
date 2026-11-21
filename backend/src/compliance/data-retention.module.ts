import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataRetentionService } from './data-retention.service';
import { DataRetentionLog } from './entities/data-retention-log.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, DataRetentionLog]),
    NotificationsModule,
  ],
  providers: [DataRetentionService],
  exports: [DataRetentionService],
})
export class DataRetentionModule {}