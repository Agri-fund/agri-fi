import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { EmailTemplateService } from './email-template.service';
import { NotificationsController } from './notifications.controller';
import { NotificationEntity } from './entities/notification.entity';
import { WsJwtGuard } from './ws-jwt.guard';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([NotificationEntity]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EmailTemplateService,
    NotificationsGateway,
    WsJwtGuard,
  ],
  exports: [NotificationsService, EmailTemplateService],
})
export class NotificationsModule {}
