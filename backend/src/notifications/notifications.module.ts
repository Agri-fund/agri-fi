import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { EmailTemplateService } from './email-template.service';
import { WsJwtGuard } from './ws-jwt.guard';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [NotificationsService, EmailTemplateService, NotificationsGateway, WsJwtGuard],
  exports: [NotificationsService, EmailTemplateService],
})
export class NotificationsModule {}
