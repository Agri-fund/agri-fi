import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { NotificationEntity } from './entities/notification.entity';

@Injectable()
export class SmsRateLimiterService {
  private readonly dailySmsCap: number;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {
    this.dailySmsCap = parseInt(
      this.config.get<string>('SMS_DAILY_CAP_PER_USER', '10'),
      10,
    );
  }

  async isWithinDailyLimit(userId: string): Promise<boolean> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await this.notificationRepo.count({
      where: {
        userId,
        createdAt: MoreThanOrEqual(today),
        metadataJson: {
          channel: 'sms',
        } as any,
      },
    });

    return count < this.dailySmsCap;
  }

  getDailySmsCap(): number {
    return this.dailySmsCap;
  }
}
