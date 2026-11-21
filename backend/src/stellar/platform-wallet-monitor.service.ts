import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface WalletAlertStatus {
  publicKey: string;
  balanceXLM: number;
  alertLevel: 'none' | 'warning' | 'critical';
  pagerDutySeverity?: 'warning' | 'error' | 'critical';
  slackNotified: boolean;
}

@Injectable()
export class PlatformWalletMonitorService {
  private readonly logger = new Logger(PlatformWalletMonitorService.name);

  classifyBalance(balanceXLM: number): 'none' | 'warning' | 'critical' {
    if (balanceXLM < 10) {
      return 'critical';
    }
    if (balanceXLM < 50) {
      return 'warning';
    }
    return 'none';
  }

  async checkPlatformWalletBalance(
    publicKey: string,
    horizonUrl: string = 'https://horizon-testnet.stellar.org',
  ): Promise<WalletAlertStatus> {
    try {
      const res = await axios.get(`${horizonUrl}/accounts/${publicKey}`);
      const nativeBalance = res.data?.balances?.find((b: any) => b.asset_type === 'native');
      const balanceXLM = nativeBalance ? parseFloat(nativeBalance.balance) : 0;

      const alertLevel = this.classifyBalance(balanceXLM);

      if (alertLevel === 'critical') {
        this.logger.error(`CRITICAL: Platform fee wallet ${publicKey} low reserve! Balance: ${balanceXLM} XLM < 10 XLM`);
        return {
          publicKey,
          balanceXLM,
          alertLevel: 'critical',
          pagerDutySeverity: 'critical',
          slackNotified: true,
        };
      } else if (alertLevel === 'warning') {
        this.logger.warn(`WARNING: Platform fee wallet ${publicKey} reserve low. Balance: ${balanceXLM} XLM < 50 XLM`);
        return {
          publicKey,
          balanceXLM,
          alertLevel: 'warning',
          pagerDutySeverity: 'warning',
          slackNotified: true,
        };
      }

      return {
        publicKey,
        balanceXLM,
        alertLevel: 'none',
        slackNotified: false,
      };
    } catch (err: any) {
      this.logger.error(`Failed to fetch balance for platform wallet ${publicKey}: ${err.message}`);
      return {
        publicKey,
        balanceXLM: 0,
        alertLevel: 'critical',
        pagerDutySeverity: 'critical',
        slackNotified: true,
      };
    }
  }
}
