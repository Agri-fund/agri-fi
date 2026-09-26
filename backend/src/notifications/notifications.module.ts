import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { SmsRateLimiterService } from './sms-rate-limiter.service';
import { SMS_PROVIDER_TOKEN } from './providers/sms.provider';
import { AfricasTalkingProvider } from './providers/africas-talking.provider';
import { TwilioProvider } from './providers/twilio.provider';
import { FakeSmsProvider } from './providers/fake-sms.provider';
import { SmsNotificationHelper } from './sms-notification-helper';

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
    SmsRateLimiterService,
    SmsNotificationHelper,
    WsJwtGuard,
    {
      provide: SMS_PROVIDER_TOKEN,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>(
          'NOTIFICATIONS_SMS_PROVIDER',
          'fake',
        );

        if (provider === 'africas_talking') {
          return new AfricasTalkingProvider(configService);
        } else if (provider === 'twilio') {
          return new TwilioProvider(configService);
        }
        // Default to fake provider for testing
        return new FakeSmsProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [
    NotificationsService,
    EmailTemplateService,
    NotificationPreferencesService,
    PushNotificationService,
    SmsRateLimiterService,
    SmsNotificationHelper,
  ],
})
export class NotificationsModule {}
