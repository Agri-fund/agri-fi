import {
  Processor,
  Process,
  InjectQueue,
  OnWorkerEvent,
} from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Queue, Job } from 'bull';
import { MilestonePartialReleaseService } from '../escrow/milestone-partial-release.service';
import { MilestoneType } from '../shipments/entities/shipment-milestone.entity';

export interface MilestoneRecordedPayload {
  dealId: string;
  milestoneType: MilestoneType;
  milestoneId: string;
}

/**
 * Queue processor for handling milestone recorded events.
 * Triggers partial escrow releases when milestones are completed.
 */
@Processor('milestone-release')
export class MilestoneReleaseProcessor {
  private readonly logger = new Logger(MilestoneReleaseProcessor.name);

  constructor(
    @InjectQueue('milestone-release')
    private readonly milestoneReleaseQueue: Queue<MilestoneRecordedPayload>,
    private readonly partialReleaseService: MilestonePartialReleaseService,
  ) {}

  /**
   * Main job handler: processes milestone recorded event and triggers partial release.
   */
  @Process()
  async processMilestoneRelease(
    job: Job<MilestoneRecordedPayload>,
  ): Promise<void> {
    const { dealId, milestoneType, milestoneId } = job.data;

    this.logger.log(
      `Processing milestone release: deal=${dealId}, milestone=${milestoneType}`,
    );

    try {
      await this.partialReleaseService.onMilestoneRecorded(dealId, milestoneType);

      this.logger.log(
        `Milestone release completed: deal=${dealId}, milestone=${milestoneType}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to process milestone release: deal=${dealId}, milestone=${milestoneType}, error=${error.message}`,
        error.stack,
      );

      // Re-throw to trigger Bull's retry mechanism
      throw error;
    }
  }

  /**
   * Job retry event handler.
   */
  @OnWorkerEvent('failed')
  onJobFailed(job: Job): void {
    this.logger.warn(
      `Milestone release job failed: job=${job.id}, attempt=${job.attemptsMade}`,
    );
  }

  /**
   * Job completion handler.
   */
  @OnWorkerEvent('completed')
  onJobCompleted(job: Job): void {
    this.logger.debug(`Milestone release job completed: job=${job.id}`);
  }
}
