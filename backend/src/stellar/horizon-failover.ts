import { Horizon } from '@stellar/stellar-sdk';
import { PinoLogger } from 'nestjs-pino';

export interface NodeHealthStatus {
  url: string;
  healthy: boolean;
  lastLatencyMs?: number;
  lastErrorAt?: Date;
  lastError?: string;
  checkedAt: Date;
}

/**
 * Wraps a list of Horizon node URLs and retries failed requests against the
 * next available node. On a connection error or rate-limit (HTTP 429) the
 * wrapper advances to the next URL, logs a warning, and replaces `this.server`
 * with a fresh `Horizon.Server` instance pointed at the new URL.
 *
 * Also tracks health status and latency metrics for each node.
 *
 * Usage:
 *   const client = new HorizonFailoverClient(urls, logger, { timeout: 30000 });
 *   const account = await client.call(s => s.loadAccount(address));
 *   const health = client.getNodeHealth();
 */
export class HorizonFailoverClient {
  private readonly urls: string[];
  private currentIndex: number = 0;
  private server: Horizon.Server;
  private readonly serverOptions: Horizon.Server.Options;
  private readonly logger: PinoLogger;
  private nodeHealth: Map<string, NodeHealthStatus> = new Map();
  private lastHealthCheckTime: Date = new Date();

  constructor(
    urls: string[],
    logger: PinoLogger,
    options: Horizon.Server.Options = {},
  ) {
    if (urls.length === 0) {
      throw new Error('HorizonFailoverClient requires at least one URL');
    }
    this.urls = urls;
    this.logger = logger;
    this.serverOptions = options;
    this.server = new Horizon.Server(urls[0], options);

    // Initialize health status for all nodes
    for (const url of urls) {
      this.nodeHealth.set(url, {
        url,
        healthy: true,
        checkedAt: new Date(),
      });
    }
  }

  /** The URL of the currently active Horizon node. */
  get activeUrl(): string {
    return this.urls[this.currentIndex];
  }

  /** The underlying `Horizon.Server` for the active node. */
  get activeServer(): Horizon.Server {
    return this.server;
  }

  /**
   * Execute `fn` against the active Horizon node, retrying each remaining node
   * on connection failure or HTTP 429 until one succeeds or all nodes are
   * exhausted.
   */
  async call<T>(fn: (server: Horizon.Server) => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.urls.length; attempt++) {
      const startTime = Date.now();
      try {
        const result = await fn(this.server);
        const latencyMs = Date.now() - startTime;

        // Record successful latency
        const status = this.nodeHealth.get(this.activeUrl);
        if (status) {
          status.healthy = true;
          status.lastLatencyMs = latencyMs;
          status.checkedAt = new Date();
          status.lastError = undefined;
        }

        return result;
      } catch (err: unknown) {
        const latencyMs = Date.now() - startTime;
        lastError = err;

        if (!this.isRetryable(err)) {
          throw err;
        }

        const failedUrl = this.activeUrl;
        const errorMsg = err instanceof Error ? err.message : String(err);

        // Record failure
        const status = this.nodeHealth.get(failedUrl);
        if (status) {
          status.healthy = false;
          status.lastErrorAt = new Date();
          status.lastError = errorMsg;
          status.checkedAt = new Date();
        }

        this.advance();

        this.logger.warn(
          {
            failedUrl,
            nextUrl: this.activeUrl,
            attempt: attempt + 1,
            latencyMs,
          },
          `Horizon node ${failedUrl} failed — failing over to ${this.activeUrl}`,
        );
      }
    }

    throw lastError;
  }

  /**
   * Check health of all nodes by pinging them.
   * Returns immediately on first successful node check (doesn't wait for all).
   */
  async checkAllNodesHealth(): Promise<NodeHealthStatus[]> {
    const checks = this.urls.map(async (url) => {
      const startTime = Date.now();
      try {
        const server = new Horizon.Server(url, this.serverOptions);
        // Simple health check: fetch server info
        await server.serverInfo();
        const latencyMs = Date.now() - startTime;

        const status = this.nodeHealth.get(url) || {
          url,
          healthy: true,
          checkedAt: new Date(),
        };
        status.healthy = true;
        status.lastLatencyMs = latencyMs;
        status.checkedAt = new Date();
        status.lastError = undefined;

        this.nodeHealth.set(url, status);
        return status;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const status = this.nodeHealth.get(url) || {
          url,
          healthy: false,
          checkedAt: new Date(),
        };
        status.healthy = false;
        status.lastErrorAt = new Date();
        status.lastError = errorMsg;
        status.checkedAt = new Date();

        this.nodeHealth.set(url, status);
        return status;
      }
    });

    const results = await Promise.all(checks);
    this.lastHealthCheckTime = new Date();
    return results;
  }

  /**
   * Get current health status of all nodes without performing new checks.
   */
  getNodeHealth(): NodeHealthStatus[] {
    return this.urls.map((url) => {
      return (
        this.nodeHealth.get(url) || {
          url,
          healthy: true,
          checkedAt: new Date(),
        }
      );
    });
  }

  /**
   * Get the latency of the currently active node (from last call).
   */
  getActiveNodeLatency(): number | undefined {
    return this.nodeHealth.get(this.activeUrl)?.lastLatencyMs;
  }

  /**
   * Check if all nodes are unhealthy.
   */
  areAllNodesUnhealthy(): boolean {
    return this.urls.every((url) => {
      const status = this.nodeHealth.get(url);
      return status && !status.healthy;
    });
  }

  private advance(): void {
    this.currentIndex = (this.currentIndex + 1) % this.urls.length;
    this.server = new Horizon.Server(
      this.urls[this.currentIndex],
      this.serverOptions,
    );
  }

  private isRetryable(err: unknown): boolean {
    if (err instanceof Error) {
      // Network-level failures
      if (
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ECONNRESET') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('socket hang up') ||
        err.message.includes('network timeout')
      ) {
        return true;
      }
    }
    // HTTP 429 Too Many Requests or 503 Service Unavailable
    const status = (err as { response?: { status?: number } })?.response
      ?.status;
    return status === 429 || status === 503;
  }
}
