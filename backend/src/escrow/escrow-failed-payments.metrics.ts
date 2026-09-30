import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import {
  TransactionLog,
  TxStatus,
} from '../database/entities/transaction-log.entity';

/**
 * Periodically refreshes the escrow_failed_payments gauge from transaction_logs.
 */
@Injectable()
export class EscrowFailedPaymentsMetrics
  implements OnApplicationBootstrap
{
  private readonly logger = new Logger(EscrowFailedPaymentsMetrics.name);
  private intervalRef?: NodeJS.Timeout;

  constructor(
    @InjectRepository(TransactionLog)
    private readonly txLogRepo: Repository<TransactionLog>,
    @InjectMetric('escrow_failed_payments')
    private readonly failedPaymentsGauge: Gauge<string>,
  ) {}

  onApplicationBootstrap(): void {
    void this.refresh();
    this.intervalRef = setInterval(() => void this.refresh(), 30_000);
    this.intervalRef.unref?.();
  }

  private async refresh(): Promise<void> {
    try {
      const count = await this.txLogRepo.count({
        where: { status: TxStatus.FAILED },
      });
      this.failedPaymentsGauge.set(count);
    } catch (err) {
      this.logger.warn(
        `Failed to refresh escrow_failed_payments: ${(err as Error).message}`,
      );
    }
  }
}
