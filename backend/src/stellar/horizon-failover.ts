import { Horizon } from '@stellar/stellar-sdk';
import { PinoLogger } from 'nestjs-pino';

/**
 * Wraps a list of Horizon node URLs and retries failed requests against the
 * next available node. On a connection error or rate-limit (HTTP 429) the
 * wrapper advances to the next URL, logs a warning, and replaces `this.server`
 * with a fresh `Horizon.Server` instance pointed at the new URL.
 *
 * Usage:
 *   const client = new HorizonFailoverClient(urls, logger, { timeout: 30000 });
 *   const account = await client.call(s => s.loadAccount(address));
 */
export class HorizonFailoverClient {
  private readonly urls: string[];
  private currentIndex: number = 0;
  private server: Horizon.Server;
  private readonly serverOptions: Horizon.Server.Options;
  private readonly logger: PinoLogger;

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
      try {
        return await fn(this.server);
      } catch (err: unknown) {
        lastError = err;

        if (!this.isRetryable(err)) {
          throw err;
        }

        const failedUrl = this.activeUrl;
        this.advance();

        this.logger.warn(
          { failedUrl, nextUrl: this.activeUrl, attempt: attempt + 1 },
          `Horizon node ${failedUrl} failed — failing over to ${this.activeUrl}`,
        );
      }
    }

    throw lastError;
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
