import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { decryptPayload } from '../queue/queue.crypto';
import {
  DEFAULT_QUEUE_MAX_RETRIES,
  getDeliveryAttempt,
} from '../queue/retry-policy';
import {
  TAX_STATEMENT_GENERATE,
  TaxReportService,
  TaxStatementJobPayload,
} from './tax-report.service';

/**
 * Background worker for large-portfolio tax statements (#1298).
 *
 * `TaxReportService.requestStatement()` queues a job when a portfolio is too
 * big to render inside an HTTP request. This consumer renders the PDF, stores
 * it in S3 and emails the investor a time-limited download link.
 */
@Controller()
export class TaxStatementConsumer {
  private readonly logger = new Logger(TaxStatementConsumer.name);

  constructor(private readonly taxReportService: TaxReportService) {}

  @EventPattern(TAX_STATEMENT_GENERATE)
  async handleGenerate(
    @Payload() payload: unknown,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const msg = context.getMessage();

    let job: TaxStatementJobPayload;
    try {
      job = this.parse(payload);
    } catch (err: any) {
      // Malformed messages can never succeed — send straight to the DLQ.
      this.logger.error(`Malformed tax-statement job: ${err?.message}`);
      channel.nack(msg, false, false);
      return;
    }

    try {
      await this.taxReportService.generateAndEmailStatement(job);
      channel.ack(msg);
    } catch (err: any) {
      const attempt = getDeliveryAttempt(msg);
      const exhausted = attempt >= DEFAULT_QUEUE_MAX_RETRIES;
      this.logger.error(
        `Tax statement ${job.year} for investor ${job.investorId} failed (attempt ${attempt}): ${err?.message}`,
      );
      channel.nack(msg, false, !exhausted);
    }
  }

  private parse(payload: unknown): TaxStatementJobPayload {
    const data =
      typeof payload === 'string'
        ? decryptPayload<Partial<TaxStatementJobPayload>>(
            payload,
            TAX_STATEMENT_GENERATE,
          )
        : (payload as Partial<TaxStatementJobPayload>);

    if (
      !data ||
      typeof data.investorId !== 'string' ||
      !data.investorId ||
      !Number.isInteger(data.year)
    ) {
      throw new Error('Expected { investorId: string, year: number }');
    }
    return { investorId: data.investorId, year: data.year as number };
  }
}
