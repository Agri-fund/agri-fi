import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Horizon, Keypair } from '@stellar/stellar-sdk';
import axios from 'axios';

@Injectable()
export class StellarMonitorService {
  private readonly logger = new Logger(StellarMonitorService.name);
  private readonly server: Horizon.Server;
  private readonly platformAccountId: string | null = null;
  
  // Track last alert time to prevent spamming
  private lastAlertTime: number = 0;
  // Cooldown in milliseconds (e.g., 1 hour)
  private readonly ALERT_COOLDOWN_MS = 60 * 60 * 1000;

  constructor(private readonly config: ConfigService) {
    const horizonUrl = this.config.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new Horizon.Server(horizonUrl);

    const platformSecret = this.config.get<string>('STELLAR_PLATFORM_SECRET', '');
    if (platformSecret) {
      try {
        const keypair = Keypair.fromSecret(platformSecret);
        this.platformAccountId = keypair.publicKey();
      } catch (err) {
        this.logger.warn('Failed to parse STELLAR_PLATFORM_SECRET for monitor');
      }
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkFeePoolBalance() {
    this.logger.log('Running fee pool balance check...');

    if (!this.platformAccountId) {
      this.logger.warn('No platform account configured. Skipping balance check.');
      return;
    }

    try {
      const account = await this.server.loadAccount(this.platformAccountId);
      
      // Find native XLM balance
      const nativeBalanceStr = account.balances.find((b) => b.asset_type === 'native')?.balance || '0';
      const nativeBalance = parseFloat(nativeBalanceStr);

      this.logger.log(`Current platform XLM balance: ${nativeBalance}`);

      if (nativeBalance < 20) {
        await this.triggerLowBalanceAlert(nativeBalance);
      } else {
        // Reset cooldown if balance is restored
        this.lastAlertTime = 0;
      }
    } catch (error: any) {
      this.logger.error('Error checking fee pool balance', error.stack);
    }
  }

  private async triggerLowBalanceAlert(balance: number) {
    const now = Date.now();
    if (now - this.lastAlertTime < this.ALERT_COOLDOWN_MS) {
      this.logger.warn(`Low balance alert suppressed due to cooldown. Balance is ${balance} XLM`);
      return;
    }

    const webhookUrl = this.config.get<string>('ALERT_WEBHOOK_URL');
    const message = `🚨 *URGENT:* Stellar Platform Account has a low balance of ${balance} XLM. Please fund the wallet (${this.platformAccountId}) to avoid transaction halts.`;
    
    if (webhookUrl) {
      try {
        await axios.post(webhookUrl, {
          text: message,
          // PagerDuty / Slack generic payload formatting
          summary: 'Stellar Platform Account Low Balance',
          source: 'agric-onchain-backend',
          severity: 'critical',
          custom_details: {
            balance,
            accountId: this.platformAccountId,
          }
        });
        this.logger.log('Successfully triggered low balance webhook alert.');
        this.lastAlertTime = now;
      } catch (error: any) {
        this.logger.error('Failed to trigger webhook alert', error.message);
      }
    } else {
      this.logger.error(`ALERT_WEBHOOK_URL not configured! ${message}`);
      // Also update last alert time even if webhook isn't configured so we don't spam the logs
      this.lastAlertTime = now;
    }
  }
}
