import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { EmailTemplateService } from './email-template.service';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { PushSubscriptionEntity } from './entities/push-subscription.entity';
import { PushNotificationService } from './push-notification.service';
import { WsJwtGuard } from './ws-jwt.guard';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationPreference,
      PushSubscriptionEntity,
    ]),
  ],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [
    NotificationsService,
    EmailTemplateService,
    NotificationsGateway,
    NotificationPreferencesService,
    PushNotificationService,
    WsJwtGuard,
  ],
  exports: [
    NotificationsService,
    EmailTemplateService,
    NotificationPreferencesService,
    PushNotificationService,
  ],
})
export class NotificationsModule {}
