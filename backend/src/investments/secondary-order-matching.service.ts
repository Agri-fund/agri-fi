import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import {
  MarketplaceSettlementService,
  MatchOrderResult,
} from './marketplace-settlement.service';

/**
 * Drives the secondary market.
 *
 * Every tick it asks the settlement service for the tokens that have live
 * interest, arms any stop-loss orders the market has crossed, and runs the
 * matching pass for each token. Ticks never throw: a failed sweep must not
 * take down the scheduler.
 */
@Injectable()
export class SecondaryOrderMatchingService {
  private isProcessing = false;

  constructor(
    private readonly settlementService: MarketplaceSettlementService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SecondaryOrderMatchingService.name);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async runScheduledMatching(): Promise<void> {
    if (this.isProcessing) {
      this.logger.trace(
        'Secondary order matching already running, skipping tick',
      );
      return;
    }

    this.isProcessing = true;

    try {
      const tokenCodes = await this.settlementService.getActiveTokenCodes();

      if (tokenCodes.length === 0) {
        this.logger.trace('No active secondary orders to match');
        return;
      }

      this.logger.debug(
        { tokenCodes, count: tokenCodes.length },
        `Matching secondary orders across ${tokenCodes.length} token(s)`,
      );

      for (const tokenCode of tokenCodes) {
        await this.matchToken(tokenCode);
      }
    } catch (error) {
      this.logger.error(
        { err: error },
        'Secondary order matching sweep failed',
      );
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Runs one token's sweep — arming stops and matching are handled together by
   * `matchOpenOrders`. Errors are contained per token so a single bad market
   * cannot abort the others.
   */
  private async matchToken(tokenCode: string): Promise<void> {
    try {
      const results = await this.settlementService.matchOpenOrders(tokenCode);

      const summary = this.summarise(results);
      if (
        summary.triggered ||
        summary.filled ||
        summary.killed ||
        summary.partiallyFilled
      ) {
        this.logger.info(
          { tokenCode, ...summary, orders: results.length },
          'Secondary matching sweep complete',
        );
      }
    } catch (error) {
      this.logger.error(
        { err: error, tokenCode },
        'Failed to match secondary orders for token',
      );
    }
  }

  private summarise(results: MatchOrderResult[]): {
    triggered: number;
    filled: number;
    killed: number;
    partiallyFilled: number;
  } {
    return {
      triggered: results.filter((r) => r.triggered).length,
      filled: results.filter((r) => r.filled).length,
      killed: results.filter((r) => r.killed).length,
      partiallyFilled: results.filter((r) => !r.filled && r.fills.length > 0)
        .length,
    };
  }
}
