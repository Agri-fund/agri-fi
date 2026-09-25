import { MetricsIpGuard } from './metrics-ip.guard';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function makeContext(ip: string, forwardedFor?: string): ExecutionContext {
  const request: any = {
    ip,
    headers: {} as Record<string, string>,
    socket: { remoteAddress: ip },
  };
  if (forwardedFor) {
    request.headers['x-forwarded-for'] = forwardedFor;
  }
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeConfig(allowedIps?: string, trustProxy?: string): ConfigService {
  return {
    get: (key: string, defaultValue: string) => {
      if (key === 'METRICS_ALLOWED_IPS')
        return allowedIps ?? '127.0.0.1,::1,::ffff:127.0.0.1';
      if (key === 'TRUST_PROXY') return trustProxy ?? 'false';
      return defaultValue;
    },
  } as unknown as ConfigService;
}

describe('MetricsIpGuard', () => {
  it('allows loopback IPv4 by default', () => {
    const guard = new MetricsIpGuard(makeConfig());
    expect(guard.canActivate(makeContext('127.0.0.1'))).toBe(true);
  });

  it('allows loopback IPv6 by default', () => {
    const guard = new MetricsIpGuard(makeConfig());
    expect(guard.canActivate(makeContext('::1'))).toBe(true);
  });

  it('blocks an external IP not in the allowlist', () => {
    const guard = new MetricsIpGuard(makeConfig());
    expect(guard.canActivate(makeContext('203.0.113.1'))).toBe(false);
  });

  it('allows a custom IP added via METRICS_ALLOWED_IPS', () => {
    const guard = new MetricsIpGuard(makeConfig('127.0.0.1,::1,10.0.0.5'));
    expect(guard.canActivate(makeContext('10.0.0.5'))).toBe(true);
  });

  it('still blocks IPs not in the custom allowlist', () => {
    const guard = new MetricsIpGuard(makeConfig('10.0.0.5'));
    expect(guard.canActivate(makeContext('10.0.0.6'))).toBe(false);
  });

  it('reads X-Forwarded-For when TRUST_PROXY=true', () => {
    const guard = new MetricsIpGuard(makeConfig('10.0.0.5', 'true'));
    const ctx = makeContext('192.168.1.1', '10.0.0.5, 192.168.1.1');
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('ignores X-Forwarded-For when TRUST_PROXY=false', () => {
    const guard = new MetricsIpGuard(makeConfig('10.0.0.5', 'false'));
    const ctx = makeContext('192.168.1.1', '10.0.0.5');
    // socket IP (192.168.1.1) is not in allowlist → blocked
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows mapped IPv4-in-IPv6 loopback by default', () => {
    const guard = new MetricsIpGuard(makeConfig());
    expect(guard.canActivate(makeContext('::ffff:127.0.0.1'))).toBe(true);
  });
});
