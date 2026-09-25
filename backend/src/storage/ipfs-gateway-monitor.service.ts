import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

/**
 * Well-known public gateways used for document retrieval.
 * Order matters: the first healthy gateway becomes the active one.
 */
const DEFAULT_GATEWAYS = [
  'https://cloudflare-ipfs.com',
  'https://ipfs.io',
  'https://gateway.pinata.cloud',
  'https://dweb.link',
];

/**
 * A small, widely-pinned CID used as a liveness probe.
 * This is the CID for the IPFS welcome page (stable, always available).
 */
const PROBE_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

/** Maximum acceptable response time in milliseconds. */
const SLOW_THRESHOLD_MS = 5_000;

/** HTTP request timeout — gateway must respond within this window. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface GatewayStatus {
  url: string;
  latencyMs: number | null;
  healthy: boolean;
}

/**
 * IpfsGatewayMonitorService (#736)
 *
 * Periodically probes each configured IPFS gateway. If the primary gateway
 * is slow or offline the service logs a warning and rotates to the next
 * healthy gateway, which StorageService can read via `getActiveGateway()`.
 */
@Injectable()
export class IpfsGatewayMonitorService {
  private readonly logger = new Logger(IpfsGatewayMonitorService.name);

  private readonly gateways: string[];
  private readonly alertWebhookUrl: string | undefined;

  /** The URL of the currently active (primary) gateway. */
  private activeGateway: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    const configuredGateways = this.configService
      .get<string>('IPFS_GATEWAYS', '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean);

    this.gateways =
      configuredGateways.length > 0 ? configuredGateways : DEFAULT_GATEWAYS;

    this.activeGateway = this.gateways[0];

    this.alertWebhookUrl =
      this.configService.get<string>('SLACK_WEBHOOK_URL') ||
      this.configService.get<string>('DISCORD_WEBHOOK_URL') ||
      this.configService.get<string>('ALERT_WEBHOOK_URL');
  }

  /**
   * Returns the URL of the currently active IPFS gateway.
   * StorageService can call this to route document fetches.
   */
  getActiveGateway(): string {
    return this.activeGateway;
  }

  /**
   * Probe all gateways every 10 minutes.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkGateways(): Promise<void> {
    this.logger.log(`Probing ${this.gateways.length} IPFS gateways…`);

    const results = await Promise.all(
      this.gateways.map((url) => this.probeGateway(url)),
    );

    for (const result of results) {
      if (!result.healthy) {
        this.logger.warn(
          `IPFS gateway ${result.url} is OFFLINE (timeout/error)`,
        );
      } else if (
        result.latencyMs !== null &&
        result.latencyMs > SLOW_THRESHOLD_MS
      ) {
        this.logger.warn(
          `IPFS gateway ${result.url} is SLOW (${result.latencyMs} ms > ${SLOW_THRESHOLD_MS} ms threshold)`,
        );
      } else {
        this.logger.log(
          `IPFS gateway ${result.url} OK — ${result.latencyMs} ms`,
        );
      }
    }

    // Rotate to the first healthy gateway
    const healthyGateways = results.filter((r) => r.healthy);
    if (healthyGateways.length === 0) {
      this.logger.error('All IPFS gateways are offline!');
      await this.sendWebhookAlert(
        '🔴 *IPFS Alert*: All configured IPFS gateways are currently offline or unreachable.',
      );
      return;
    }

    const [best] = healthyGateways;
    if (best.url !== this.activeGateway) {
      this.logger.warn(
        `IPFS primary gateway rotated from ${this.activeGateway} → ${best.url}`,
      );
      await this.sendWebhookAlert(
        `⚠️ *IPFS Gateway Rotation*: Primary gateway changed from \`${this.activeGateway}\` to \`${best.url}\`. ` +
          'Previous gateway may be slow or offline.',
      );
      this.activeGateway = best.url;
    }
  }

  /**
   * Probe a single gateway by fetching the first 512 bytes of the probe CID.
   */
  private async probeGateway(gatewayUrl: string): Promise<GatewayStatus> {
    const probeUrl = `${gatewayUrl}/ipfs/${PROBE_CID}/readme`;
    const start = Date.now();
    try {
      await firstValueFrom(
        this.httpService
          .get(probeUrl, {
            responseType: 'arraybuffer',
            headers: { Range: 'bytes=0-511' },
            validateStatus: (status) => status < 500,
          })
          .pipe(timeout(REQUEST_TIMEOUT_MS)),
      );
      const latencyMs = Date.now() - start;
      return { url: gatewayUrl, latencyMs, healthy: true };
    } catch {
      return { url: gatewayUrl, latencyMs: null, healthy: false };
    }
  }

  private async sendWebhookAlert(message: string): Promise<void> {
    if (!this.alertWebhookUrl) {
      this.logger.warn(
        'No webhook URL configured — IPFS alert not sent to external channel.',
      );
      return;
    }
    try {
      const payload = { text: message, content: message };
      await firstValueFrom(
        this.httpService.post(this.alertWebhookUrl, payload),
      );
    } catch (err) {
      this.logger.error({ err }, 'Failed to send IPFS gateway webhook alert');
    }
  }
}
