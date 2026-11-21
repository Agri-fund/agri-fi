import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, LessThan, Not, IsNull, In } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Investment } from '../investments/entities/investment.entity';
import { DataRetentionLog } from './entities/data-retention-log.entity';
import { MailService } from '../mail/mail.service';

export const RETENTION_YEARS = 7;
export const NOTIFICATION_DAYS_BEFORE = 90;
export const ANONYMISED_NAME = 'Anonymised User';
export const ANONYMISED_EMAIL_DOMAIN = 'deleted.agri-fi';

export interface RetentionCandidate {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  lastLoginAt: Date | null;
}

export interface AnonymisationResult {
  userId: string;
  previousEmail: string;
  anonymisedEmail: string;
  anonymisedAt: Date;
}

@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Investment)
    private readonly investmentRepository: Repository<Investment>,
    @InjectRepository(DataRetentionLog)
    private readonly retentionLogRepository: Repository<DataRetentionLog>,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  /**
   * Compute the cutoff date for inactivity: NOW() - INTERVAL '7 years'.
   */
  getInactivityCutoff(now: Date = new Date()): Date {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
    return cutoff;
  }

  /**
   * Compute the notification cutoff: users whose last_login_at is older than
   * (7 years - 90 days) but not yet past the full 7-year cutoff should be notified.
   */
  getNotificationCutoff(now: Date = new Date()): Date {
    const cutoff = this.getInactivityCutoff(now);
    cutoff.setDate(cutoff.getDate() + NOTIFICATION_DAYS_BEFORE);
    return cutoff;
  }

  /**
   * Build the query identifying users eligible for anonymisation:
   * - last_login_at < NOW() - INTERVAL '7 years'
   * - no active investments
   * - retention_exempt = false
   */
  async findEligibleUsers(now: Date = new Date()): Promise<RetentionCandidate[]> {
    const cutoff = this.getInactivityCutoff(now);

    const qb = this.userRepository
      .createQueryBuilder('user')
      .where('user.last_login_at < :cutoff', { cutoff })
      .andWhere('(user.retention_exempt = false OR user.retention_exempt IS NULL)')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM investments inv
          WHERE inv.user_id = user.id
            AND inv.status = :activeStatus
        )`,
        { activeStatus: 'active' },
      );

    const users = await qb.getMany();

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  /**
   * Build the query identifying users who should receive the 90-day advance
   * notification: last_login_at is older than (7 years - 90 days) but not yet
   * past the full 7-year cutoff, no active investments, not exempt, and not
   * already notified.
   */
  async findUsersToNotify(now: Date = new Date()): Promise<RetentionCandidate[]> {
    const fullCutoff = this.getInactivityCutoff(now);
    const notifyCutoff = this.getNotificationCutoff(now);

    const qb = this.userRepository
      .createQueryBuilder('user')
      .where('user.last_login_at < :notifyCutoff', { notifyCutoff })
      .andWhere('user.last_login_at >= :fullCutoff', { fullCutoff })
      .andWhere('(user.retention_exempt = false OR user.retention_exempt IS NULL)')
      .andWhere('(user.retention_notified_at IS NULL)')
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM investments inv
          WHERE inv.user_id = user.id
            AND inv.status = :activeStatus
        )`,
        { activeStatus: 'active' },
      );

    const users = await qb.getMany();

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  /**
   * Anonymise a single user's PII and record the action in data_retention_log.
   */
  async anonymiseUser(user: RetentionCandidate, now: Date = new Date()): Promise<AnonymisationResult> {
    const anonymisedEmail = `anon_${user.id}@${ANONYMISED_EMAIL_DOMAIN}`;

    await this.dataSource.transaction(async (manager) => {
      await manager.update(User, user.id, {
        firstName: ANONYMISED_NAME,
        lastName: '',
        email: anonymisedEmail,
        phone: null,
        address: null,
        dateOfBirth: null,
        anonymisedAt: now,
      });

      const log = manager.create(DataRetentionLog, {
        userId: user.id,
        action: 'anonymised',
        previousEmail: user.email,
        anonymisedEmail,
        performedAt: now,
        reason: `Inactive for more than ${RETENTION_YEARS} years with no active investments`,
      });
      await manager.save(DataRetentionLog, log);
    });

    this.logger.log(`Anonymised user ${user.id} (${user.email} -> ${anonymisedEmail})`);

    return {
      userId: user.id,
      previousEmail: user.email,
      anonymisedEmail,
      anonymisedAt: now,
    };
  }

  /**
   * Send the 90-day advance notification email to a user.
   */
  async notifyUser(user: RetentionCandidate, now: Date = new Date()): Promise<void> {
    const scheduledDate = new Date(now);
    scheduledDate.setFullYear(scheduledDate.getFullYear() + RETENTION_YEARS);
    // The scheduled anonymisation is 90 days from now (since they're already past
    // the notify cutoff). Compute the actual date based on last login.
    const lastLogin = user.lastLoginAt ?? now;
    const anonymisationDate = new Date(lastLogin);
    anonymisationDate.setFullYear(anonymisationDate.getFullYear() + RETENTION_YEARS);

    await this.mailService.sendRetentionNotificationEmail({
      to: user.email,
      firstName: user.firstName ?? 'there',
      anonymisationDate,
    });

    await this.userRepository.update(user.id, {
      retentionNotifiedAt: now,
    });

    await this.retentionLogRepository.save(
      this.retentionLogRepository.create({
        userId: user.id,
        action: 'notified',
        previousEmail: user.email,
        performedAt: now,
        reason: `${NOTIFICATION_DAYS_BEFORE}-day advance notification sent`,
      }),
    );

    this.logger.log(`Sent retention notification to user ${user.id}`);
  }

  /**
   * Nightly cron: send advance notifications and anonymise eligible users.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runNightlyRetentionJob(): Promise<void> {
    const now = new Date();
    this.logger.log('Starting nightly data retention job');

    try {
      const toNotify = await this.findUsersToNotify(now);
      for (const user of toNotify) {
        try {
          await this.notifyUser(user, now);
        } catch (err) {
          this.logger.error(`Failed to notify user ${user.id}: ${(err as Error).message}`);
        }
      }

      const eligible = await this.findEligibleUsers(now);
      for (const user of eligible) {
        try {
          await this.anonymiseUser(user, now);
        } catch (err) {
          this.logger.error(`Failed to anonymise user ${user.id}: ${(err as Error).message}`);
        }
      }

      this.logger.log(
        `Data retention job complete: notified=${toNotify.length}, anonymised=${eligible.length}`,
      );
    } catch (err) {
      this.logger.error(`Data retention job failed: ${(err as Error).message}`);
    }
  }
}