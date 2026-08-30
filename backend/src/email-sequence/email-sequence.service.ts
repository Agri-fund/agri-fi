import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { InvestorEmailSequence } from './entities/investor-email-sequence.entity';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailTemplateService } from '../notifications/email-template.service';

// ── Drip sequence definition ──────────────────────────────────────────────────

export interface DripStep {
  /** Zero-based index (0-4). */
  step: number;
  /** Day offset from registration when the email is scheduled. */
  dayOffset: number;
  /** Template name under templates/{locale}/<templateName>.hbs */
  templateName: string;
}

/**
 * The five-step investor onboarding sequence.
 * Day 0 is sent immediately on registration; subsequent steps are scheduled
 * relative to the registration timestamp.
 */
export const DRIP_STEPS: DripStep[] = [
  { step: 0, dayOffset: 0, templateName: 'drip-welcome' },
  { step: 1, dayOffset: 1, templateName: 'drip-how-it-works' },
  { step: 2, dayOffset: 3, templateName: 'drip-featured-deal' },
  { step: 3, dayOffset: 5, templateName: 'drip-risk-returns' },
  { step: 4, dayOffset: 7, templateName: 'drip-last-chance' },
];

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class EmailSequenceService {
  constructor(
    @InjectRepository(InvestorEmailSequence)
    private readonly sequenceRepo: Repository<InvestorEmailSequence>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly notificationsService: NotificationsService,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly logger: PinoLogger,
    private readonly config: ConfigService,
  ) {
    this.logger.setContext(EmailSequenceService.name);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Schedules all 5 drip steps for a newly registered investor.
   * Called by AuthService immediately after the user row is persisted.
   * Idempotent: silently skips on duplicate key (same user+step).
   */
  async scheduleForUser(
    userId: string,
    registrationTime: Date = new Date(),
  ): Promise<void> {
    const rows = DRIP_STEPS.map((s) => {
      const scheduledAt = new Date(registrationTime);
      scheduledAt.setDate(scheduledAt.getDate() + s.dayOffset);
      return this.sequenceRepo.create({
        userId,
        sequenceStep: s.step,
        scheduledAt,
        sentAt: null,
        error: null,
      });
    });

    // INSERT … ON CONFLICT DO NOTHING — prevents double-scheduling if called twice
    await this.sequenceRepo
      .createQueryBuilder()
      .insert()
      .into(InvestorEmailSequence)
      .values(rows)
      .orIgnore()
      .execute();

    this.logger.info({ userId }, 'Scheduled drip email sequence for investor');
  }

  /**
   * Cancels remaining (unsent) steps for a user.
   * Called by InvestmentsService when the investor's first investment is confirmed.
   * Marks all pending rows with a synthetic sentAt so the cron skips them.
   */
  async haltForUser(userId: string): Promise<void> {
    const now = new Date();
    const result = await this.sequenceRepo
      .createQueryBuilder()
      .update(InvestorEmailSequence)
      .set({ sentAt: now, error: 'HALTED: user made first investment' })
      .where('user_id = :userId', { userId })
      .andWhere('sent_at IS NULL')
      .execute();

    this.logger.info(
      { userId, haltedRows: result.affected ?? 0 },
      'Halted drip email sequence — user made first investment',
    );
  }

  /**
   * Processes the one-click unsubscribe request.
   * Sets `emailSequenceUnsubscribed = true` on the user and halts remaining steps.
   * The token is the user's id encoded as a URL-safe base64 string
   * (kept simple — no expiry; sequence emails are low-sensitivity).
   */
  async unsubscribe(token: string): Promise<void> {
    const userId = this.decodeUnsubscribeToken(token);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Unsubscribe token is invalid');

    if (!user.emailSequenceUnsubscribed) {
      await this.userRepo.update(userId, { emailSequenceUnsubscribed: true });
      await this.haltForUser(userId);
      this.logger.info(
        { userId },
        'User unsubscribed from drip email sequence',
      );
    }
  }

  /**
   * Returns sequence rows for a given user (admin view).
   */
  async getSequenceStatus(userId: string): Promise<InvestorEmailSequence[]> {
    return this.sequenceRepo.find({
      where: { userId },
      order: { sequenceStep: 'ASC' },
    });
  }

  /**
   * Paginated list of all sequences (admin dashboard).
   */
  async listAllSequences(opts: {
    page: number;
    limit: number;
  }): Promise<{ data: InvestorEmailSequence[]; total: number }> {
    const [data, total] = await this.sequenceRepo.findAndCount({
      order: { userId: 'ASC', sequenceStep: 'ASC' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
      relations: ['user'],
    });
    return { data, total };
  }

  // ── Token helpers ───────────────────────────────────────────────────────────

  /** Encodes userId as URL-safe base64 for the unsubscribe link. */
  encodeUnsubscribeToken(userId: string): string {
    return Buffer.from(userId, 'utf8').toString('base64url');
  }

  private decodeUnsubscribeToken(token: string): string {
    try {
      return Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      throw new NotFoundException('Unsubscribe token is invalid');
    }
  }

  // ── Cron ────────────────────────────────────────────────────────────────────

  /**
   * Runs every hour. Finds all sequence rows that are due and not yet sent,
   * checks the user has not unsubscribed, and dispatches the templated email.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async processPendingSteps(): Promise<void> {
    const now = new Date();
    this.logger.info(
      { now },
      'EmailSequenceService: processing pending drip steps',
    );

    const due = await this.sequenceRepo.find({
      where: {
        sentAt: IsNull(),
        scheduledAt: LessThanOrEqual(now),
      },
      relations: ['user'],
    });

    this.logger.info({ count: due.length }, 'Drip steps due for dispatch');

    for (const row of due) {
      await this.dispatchStep(row);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async dispatchStep(row: InvestorEmailSequence): Promise<void> {
    const { user } = row;

    // Guard: user unsubscribed (race-condition safety)
    if (user.emailSequenceUnsubscribed) {
      await this.sequenceRepo.update(row.id, {
        sentAt: new Date(),
        error: 'SKIPPED: user unsubscribed',
      });
      return;
    }

    const step = DRIP_STEPS.find((s) => s.step === row.sequenceStep);
    if (!step) {
      await this.sequenceRepo.update(row.id, {
        sentAt: new Date(),
        error: `SKIPPED: unknown step ${row.sequenceStep}`,
      });
      return;
    }

    const appUrl = this.config.get<string>(
      'APP_BASE_URL',
      'http://localhost:3001',
    );
    const unsubToken = this.encodeUnsubscribeToken(user.id);
    const unsubscribeUrl = `${appUrl}/email-sequence/unsubscribe?token=${unsubToken}`;

    const vars: Record<string, unknown> = {
      userName: user.email.split('@')[0],
      userEmail: user.email,
      appUrl,
      unsubscribeUrl,
      // CAN-SPAM: physical mailing address in footer
      physicalAddress: this.config.get<string>(
        'COMPANY_ADDRESS',
        'Agri-Fi Ltd, Nairobi, Kenya',
      ),
      companyName: 'Agri-Fi',
    };

    try {
      const { subject, html, text } = this.emailTemplateService.render(
        step.templateName,
        vars,
        user.preferredLanguage,
      );

      await this.notificationsService.sendEmail(
        user.email,
        subject,
        text,
        html,
      );

      await this.sequenceRepo.update(row.id, {
        sentAt: new Date(),
        error: null,
      });

      this.logger.info(
        {
          userId: user.id,
          step: row.sequenceStep,
          template: step.templateName,
        },
        'Drip email dispatched successfully',
      );
    } catch (err: any) {
      const message: string = err?.message ?? String(err);
      await this.sequenceRepo.update(row.id, { error: message });
      this.logger.error(
        { userId: user.id, step: row.sequenceStep, error: message },
        'Failed to dispatch drip email',
      );
      // Do NOT mark sentAt so the cron retries next hour
    }
  }
}
