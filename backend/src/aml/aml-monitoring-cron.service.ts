import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AmlRulesService } from './aml-rules.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { SanctionsScreeningService } from './sanctions-screening.service';
import { RegulatoryReportingService } from './regulatory-reporting.service';

/**
 * Scheduled AML work (#1217). Everything here is advisory: a job that throws
 * would otherwise stop the others, so each one catches and logs. The behavioural
 * detectors, screening and filing logic all live in their services so the same
 * code runs on the schedule and from the admin endpoints.
 */
@Injectable()
export class AmlMonitoringCronService {
  private readonly logger = new Logger(AmlMonitoringCronService.name);
  private sweepInFlight = false;

  constructor(
    private readonly rulesService: AmlRulesService,
    private readonly monitoringService: TransactionMonitoringService,
    private readonly screeningService: SanctionsScreeningService,
    private readonly reportingService: RegulatoryReportingService,
  ) {}

  /**
   * Hourly behavioural sweep over the last hour of flows. The first run on a
   * fresh database also seeds the shipped rule set, so monitoring starts
   * working without an operator having to POST the rules first.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runHourlySweep(): Promise<void> {
    if (!this.monitoringService.isEnabled) return;
    if (this.sweepInFlight) {
      this.logger.warn(
        'Previous AML sweep is still running; skipping this tick',
      );
      return;
    }
    this.sweepInFlight = true;
    try {
      await this.rulesService.ensureDefaults();
      const result = await this.monitoringService.runSweep({
        windowStart: new Date(Date.now() - 60 * 60_000),
        windowEnd: new Date(),
        trigger: 'scheduled',
      });
      if (result.alertsRaised > 0) {
        this.logger.log(
          `AML sweep raised ${result.alertsRaised} alert(s) over ${result.flowsEvaluated} flow(s)`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Scheduled AML sweep failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.sweepInFlight = false;
    }
  }

  /** Daily re-screen of every verified subject against the stored lists. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyRescreen(): Promise<void> {
    if (!this.monitoringService.isEnabled) return;
    try {
      const summary = await this.screeningService.rescreenVerifiedUsers();
      this.logger.log(
        `AML re-screen: ${summary.screened} screened, ${summary.matches} match(es), ${summary.reviews} review(s)`,
      );
    } catch (error) {
      this.logger.error(
        `Scheduled re-screen failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Retries filings that never got an acceptance. Only relevant when the API
   * channel is configured; the manual-portal path leaves nothing pending, so
   * this is a cheap no-op in that deployment.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async retryPendingSubmissions(): Promise<void> {
    try {
      const due = await this.reportingService.dueForRetry();
      const apiDriven = due.filter(
        (submission) => submission.channel === 'api',
      );
      if (apiDriven.length === 0) return;
      for (const submission of apiDriven) {
        try {
          await this.reportingService.retry(submission.id);
        } catch (error) {
          this.logger.warn(
            `Retry of submission ${submission.submissionNumber} failed: ${(error as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Submission retry pass failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
