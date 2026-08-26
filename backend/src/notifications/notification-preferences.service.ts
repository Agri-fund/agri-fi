import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreference } from './entities/notification-preference.entity';

const DEFAULT_NOTIFICATION_TYPES = [
  'deal_update',
  'investment_update',
  'security_alert',
  'kyc_update',
  'payment_distributed',
];

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
  ) {}

  async getPreferences(userId: string): Promise<NotificationPreference[]> {
    let prefs = await this.preferenceRepo.find({
      where: { userId },
      order: { notificationType: 'ASC' },
    });

    // Seed defaults if none exist
    if (prefs.length === 0) {
      prefs = await this.seedDefaults(userId);
    }

    return prefs;
  }

  async updatePreference(
    userId: string,
    dto: {
      notificationType: string;
      emailEnabled?: boolean;
      pushEnabled?: boolean;
      inAppEnabled?: boolean;
    },
  ): Promise<NotificationPreference> {
    let pref = await this.preferenceRepo.findOne({
      where: { userId, notificationType: dto.notificationType },
    });

    if (!pref) {
      pref = this.preferenceRepo.create({
        userId,
        notificationType: dto.notificationType,
        emailEnabled: dto.emailEnabled ?? true,
        pushEnabled: dto.pushEnabled ?? true,
        inAppEnabled: dto.inAppEnabled ?? true,
      });
    } else {
      if (dto.emailEnabled !== undefined) pref.emailEnabled = dto.emailEnabled;
      if (dto.pushEnabled !== undefined) pref.pushEnabled = dto.pushEnabled;
      if (dto.inAppEnabled !== undefined) pref.inAppEnabled = dto.inAppEnabled;
    }

    return this.preferenceRepo.save(pref);
  }

  async isChannelEnabled(
    userId: string,
    notificationType: string,
    channel: 'email' | 'push' | 'inApp',
  ): Promise<boolean> {
    const pref = await this.preferenceRepo.findOne({
      where: { userId, notificationType },
    });

    if (!pref) return true;

    switch (channel) {
      case 'email':
        return pref.emailEnabled;
      case 'push':
        return pref.pushEnabled;
      case 'inApp':
        return pref.inAppEnabled;
      default:
        return true;
    }
  }

  private async seedDefaults(userId: string): Promise<NotificationPreference[]> {
    const prefs = DEFAULT_NOTIFICATION_TYPES.map((type) =>
      this.preferenceRepo.create({
        userId,
        notificationType: type,
        emailEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
      }),
    );
    return this.preferenceRepo.save(prefs);
  }
}
