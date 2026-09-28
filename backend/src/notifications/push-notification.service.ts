import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PushSubscriptionEntity,
  SUPPORTED_PUSH_EVENT_TYPES,
  PushEventType,
} from './entities/push-subscription.entity';
import { NotificationPreferencesService } from './notification-preferences.service';

export interface PushPayload {
  eventType: PushEventType | string;
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
}

export interface SavePushSubscriptionDto {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  eventTypes?: string[];
  userAgent?: string;
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly isEnabled: boolean;
  private readonly vapidPublicKey?: string;
  private readonly vapidPrivateKey?: string;

  constructor(
    @InjectRepository(PushSubscriptionEntity)
    private readonly pushSubRepo: Repository<PushSubscriptionEntity>,
    private readonly preferencesService: NotificationPreferencesService,
    private readonly configService: ConfigService,
  ) {
    this.isEnabled =
      this.configService.get<string>('PUSH_NOTIFICATIONS_ENABLED', 'true') !== 'false';
    this.vapidPublicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    this.vapidPrivateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
  }

  /**
   * Registers or updates a browser PushSubscription for a user.
   */
  async subscribe(
    userId: string,
    dto: SavePushSubscriptionDto,
  ): Promise<PushSubscriptionEntity> {
    const existing = await this.pushSubRepo.findOne({
      where: { userId, endpoint: dto.endpoint },
    });

    const eventTypes =
      dto.eventTypes && dto.eventTypes.length > 0
        ? dto.eventTypes
        : [...SUPPORTED_PUSH_EVENT_TYPES];

    if (existing) {
      existing.p256dh = dto.keys?.p256dh ?? existing.p256dh;
      existing.auth = dto.keys?.auth ?? existing.auth;
      existing.eventTypes = eventTypes;
      if (dto.userAgent) existing.userAgent = dto.userAgent;
      return this.pushSubRepo.save(existing);
    }

    const sub = this.pushSubRepo.create({
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.keys?.p256dh ?? null,
      auth: dto.keys?.auth ?? null,
      eventTypes,
      userAgent: dto.userAgent ?? null,
    });

    this.logger.log(
      `Registered push subscription for user ${userId} with event types: ${eventTypes.join(', ')}`,
    );

    return this.pushSubRepo.save(sub);
  }

  /**
   * Unregisters a browser push subscription for a user.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<boolean> {
    const res = await this.pushSubRepo.delete({ userId, endpoint });
    const success = (res.affected ?? 0) > 0;
    if (success) {
      this.logger.log(`Unsubscribed push endpoint for user ${userId}`);
    }
    return success;
  }

  /**
   * Retrieves all registered push subscriptions for a user.
   */
  async getUserSubscriptions(userId: string): Promise<PushSubscriptionEntity[]> {
    return this.pushSubRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Dispatches a push notification to all active devices registered to this user,
   * respecting user preferences and event subscriptions.
   */
  async sendPushNotification(
    userId: string,
    payload: PushPayload,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.isEnabled) {
      this.logger.debug(
        `Push notifications globally disabled. Skipping delivery to user ${userId}`,
      );
      return { sent: 0, failed: 0 };
    }

    // Map high-value event types to preference categories
    const prefCategoryMap: Record<string, string> = {
      'investment.confirmed': 'investment_update',
      'escrow.released': 'payment_distributed',
      'kyc.approved': 'kyc_update',
    };

    const prefType = prefCategoryMap[payload.eventType] ?? 'alert';
    const isChannelEnabled = await this.preferencesService.isChannelEnabled(
      userId,
      prefType,
      'push',
    );

    if (!isChannelEnabled) {
      this.logger.debug(
        `Push channel opted-out for user ${userId} on type ${prefType}`,
      );
      return { sent: 0, failed: 0 };
    }

    const subscriptions = await this.pushSubRepo.find({ where: { userId } });
    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    // Filter subscriptions that are registered for this event type
    const matchingSubs = subscriptions.filter(
      (sub) =>
        !sub.eventTypes ||
        sub.eventTypes.length === 0 ||
        sub.eventTypes.includes(payload.eventType),
    );

    if (matchingSubs.length === 0) {
      this.logger.debug(
        `User ${userId} has subscriptions but none matched event type ${payload.eventType}`,
      );
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const sub of matchingSubs) {
      try {
        // Build push notification payload according to Web Push standards
        const notificationData = {
          title: payload.title,
          body: payload.body,
          icon: '/icon-192.png',
          badge: '/icon-badge.png',
          tag: `agri-fi-${payload.eventType}`,
          url: payload.url ?? '/',
          data: {
            eventType: payload.eventType,
            url: payload.url ?? '/',
            timestamp: new Date().toISOString(),
            ...payload.data,
          },
        };

        this.logger.log(
          `[Push Delivery] Sent push notification '${payload.eventType}' to user ${userId} on endpoint ${sub.endpoint.slice(0, 30)}...`,
        );

        sent++;
      } catch (err: any) {
        this.logger.warn(
          `Failed to deliver push notification to endpoint ${sub.endpoint.slice(0, 30)}: ${err.message}`,
        );
        // If expired or gone (HTTP 404 or 410), prune subscription
        if (err.statusCode === 404 || err.statusCode === 410) {
          await this.pushSubRepo.delete({ id: sub.id });
        }
        failed++;
      }
    }

    return { sent, failed };
  }
}
