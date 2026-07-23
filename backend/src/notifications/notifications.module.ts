import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { WsJwtGuard } from './ws-jwt.guard';

@Module({
  imports: [ConfigModule, AuthModule],
  providers: [NotificationsService, NotificationsGateway, WsJwtGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
