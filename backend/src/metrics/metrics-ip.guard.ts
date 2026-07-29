import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards the /metrics endpoint so that only requests originating from
 * trusted internal addresses (Prometheus scrapers, monitoring sidecars, etc.)
 * can access it.
 *
 * Allowed IPs are configured via the METRICS_ALLOWED_IPS environment
 * variable as a comma-separated list of IPv4/IPv6 addresses or CIDR ranges.
 * Defaults to loopback (127.0.0.1 and ::1) when the variable is absent.
 *
 * The guard honours the X-Forwarded-For header when TRUST_PROXY=true so it
 * works correctly behind an Nginx reverse proxy or Kubernetes ingress.
 */
@Injectable()
export class MetricsIpGuard implements CanActivate {
  private readonly logger = new Logger(MetricsIpGuard.name);
  private readonly allowedIps: string[];
  private readonly trustProxy: boolean;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>(
      'METRICS_ALLOWED_IPS',
      '127.0.0.1,::1,::ffff:127.0.0.1',
    );
    this.allowedIps = raw
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    this.trustProxy =
      this.config.get<string>('TRUST_PROXY', 'false').toLowerCase() === 'true';

    this.logger.log(
      `Metrics IP allowlist: [${this.allowedIps.join(', ')}] (trust_proxy=${this.trustProxy})`,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const clientIp = this.resolveClientIp(request);

    const allowed = this.allowedIps.includes(clientIp);

    if (!allowed) {
      this.logger.warn(
        `Blocked /metrics access attempt from ${clientIp}`,
      );
    }

    return allowed;
  }

  /** Extract the originating IP, respecting X-Forwarded-For when trusted. */
  private resolveClientIp(request: any): string {
    if (this.trustProxy) {
      const forwarded: string | undefined =
        request.headers['x-forwarded-for'];
      if (forwarded) {
        // X-Forwarded-For may be a comma-separated chain: take the leftmost
        // (client) address.
        return forwarded.split(',')[0].trim();
      }
    }
    // Fall back to the direct socket address
    return request.ip ?? request.socket?.remoteAddress ?? '';
  }
}
