import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionLog } from './entities/transaction-log.entity';
import { QueueService } from '../queue/queue.service';

export interface FailedPaymentSummary {
  id: string;
  dealId: string | null;
  userId: string | null;
  txHash: string | null;
  errorCode: string | null;
  createdAt: Date;
  /** Expose deal commodity for UI convenience when relation is loaded */
  dealCommodity?: string | null;
}

export interface PaginatedFailedPayments {
  data: FailedPaymentSummary[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class FailedPaymentsService {
  private readonly logger = new Logger(FailedPaymentsService.name);

  constructor(
    @InjectRepository(TransactionLog)
    private readonly txLogRepo: Repository<TransactionLog>,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Return a paginated list of transaction_logs rows with status = 'failed',
   * ordered newest-first.  Loads the associated trade deal so the UI can
   * display the commodity name.
   */
  async getFailedPayments(
    page = 1,
    limit = 20,
  ): Promise<PaginatedFailedPayments> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safePage = Math.max(1, page);
    const skip = (safePage - 1) * safeLimit;

    const [rows, total] = await this.txLogRepo.findAndCount({
      where: { status: 'failed' },
      relations: ['deal'],
      order: { createdAt: 'DESC' },
      take: safeLimit,
      skip,
    });

    const data: FailedPaymentSummary[] = rows.map((row) => ({
      id: row.id,
      dealId: row.dealId,
      userId: row.userId,
      txHash: row.txHash,
      errorCode: row.errorCode,
      createdAt: row.createdAt,
      dealCommodity: row.deal?.commodity ?? null,
    }));

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  /**
   * Fetch a single failed transaction log by ID.
   * Throws NotFoundException if not found or not in 'failed' status.
   */
  async getFailedPaymentById(id: string): Promise<TransactionLog> {
    const log = await this.txLogRepo.findOne({
      where: { id },
      relations: ['deal', 'user'],
    });

    if (!log) {
      throw new NotFoundException(`Transaction log ${id} not found`);
    }

    if (log.status !== 'failed') {
      throw new BadRequestException(
        `Transaction ${id} is not in failed state (current: ${log.status})`,
      );
    }

    return log;
  }

  /**
   * Enqueue a manual retry for a failed transaction by re-publishing
   * a `deal.delivered` event for the associated trade deal.
   *
   * Acceptance criterion: "Admins can trigger manual retries directly from the UI."
   */
  async retryFailedPayment(
    id: string,
  ): Promise<{ queued: boolean; dealId: string }> {
    const log = await this.getFailedPaymentById(id);

    if (!log.dealId) {
      throw new BadRequestException(
        `Transaction ${id} has no associated deal — cannot retry automatically`,
      );
    }

    this.logger.log(
      `Admin-triggered retry for transaction ${id} (deal ${log.dealId})`,
    );

    await this.queueService.enqueueDealDelivered(log.dealId);

    this.logger.log(
      `Retry event published for deal ${log.dealId} (triggered from tx log ${id})`,
    );

    return { queued: true, dealId: log.dealId };
  }
}
