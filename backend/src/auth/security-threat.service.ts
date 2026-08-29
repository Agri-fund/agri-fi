import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { RedisConfig } from '../config/redis.config';
import { RedisClientType } from 'redis';
import { QueueService } from '../queue/queue.service';
import {
  SecurityIpBlock,
  SecurityBlockType,
} from '../database/entities/security-ip-block.entity';

export type ThreatAction = 'allow' | 'captcha' | 'blocked';

export interface LoginThreatVerdict {
  action: ThreatAction;
  captchaRequired: boolean;
  reasons: string[];
}

/**
 * #898 — Credential-stuffing / rate-limit-bypass detection.
 *
 * Per-IP throttling alone is trivially bypassed by distributing attempts
 * across many source IPs. This service detects distributed attacks using
 * Redis sliding windows and escalates:
 *
 * 1. Same email attempted from more than {@link DISTINCT_IPS_THRESHOLD}
 *    distinct IPs within 1 hour → global (not per-IP) rate limit on that
 *    email + CAPTCHA required on next login + security-team alert.
 * 2. More than {@link SUBNET_FAIL_THRESHOLD} failed logins originating from
 *    the same /16 IPv4 subnet within 10 minutes → a *pending* subnet block
 *    is proposed for manual admin approval.
 * 3. Client IP inside a configured bad range ({@code SECURITY_BAD_IP_RANGES})
 *    or inside an approved subnet block → login rejected outright.
 * 4. Same email seen from more than {@link GEO_COUNTRIES_THRESHOLD} distinct
 *    countries within 1 hour → CAPTCHA required + alert.
 *
 * All counters live in Redis with TTLs matching their window; enforcement
 * records are persisted in `security_ip_blocks` for audit and admin review.
 */
@Injectable()
export class SecurityThreatService implements OnModuleInit, OnModuleDestroy {
  private redisClient: RedisClientType | null = null;

  /** Distinct IPs per email within the window before a targeted attack is assumed. */
  readonly distinctIpsThreshold: number;
  /** Failed logins per /16 subnet within the window before a block is proposed. */
  readonly subnetFailThreshold: number;
  /** Distinct countries per email before geo anomaly is flagged. */
  readonly geoCountriesThreshold: number;

  private readonly badRanges: { network: number; prefix: number }[] = [];

  constructor(
    private readonly redisConfig: RedisConfig,
    @InjectRepository(SecurityIpBlock)
    private readonly blockRepo: Repository<SecurityIpBlock>,
    private readonly config: ConfigService,
    private readonly queueService: QueueService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SecurityThreatService.name);
    this.distinctIpsThreshold = Number(
      config.get<number>('SECURITY_DISTINCT_IPS_THRESHOLD', 10),
    );
    this.subnetFailThreshold = Number(
      config.get<number>('SECURITY_SUBNET_FAIL_THRESHOLD', 50),
    );
    this.geoCountriesThreshold = Number(
      config.get<number>('SECURITY_GEO_COUNTRIES_THRESHOLD', 3),
    );
    this.badRanges = this.parseBadRanges(
      config.get<string>('SECURITY_BAD_IP_RANGES', ''),
    );
  }

  async onModuleInit(): Promise<void> {
    this.redisClient = await this.redisConfig.createClient();
    if (this.redisClient && !this.redisClient.isOpen) {
      try {
        await this.redisClient.connect();
      } catch (err: any) {
        this.logger.warn(
          { error: err.message },
          'Failed to connect Redis client for security threat detection',
        );
      }
    }

    // Re-seed the Redis deny-set from the DB so approved subnet blocks keep
    // working after a Redis restart/flush.
    try {
      const active = await this.blockRepo.find({
        where: { type: 'subnet_active', active: true },
      });
      for (const block of active) {
        await this.addToDenySet(block.cidr);
      }
    } catch (err: any) {
      this.logger.warn(
        { error: err.message },
        'Could not re-seed subnet deny list from DB',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  // ── pre-login gate ─────────────────────────────────────────────────────────

  /**
   * Runs all pre-login checks. Called by AuthService before credential
   * verification so blocked traffic never reaches bcrypt/argon2 (DoS safety).
   */
  async checkLogin(email: string, ip?: string): Promise<LoginThreatVerdict> {
    const reasons: string[] = [];

    // 1. Configured threat-feed ranges → immediate block.
    if (ip && this.isInBadRange(ip)) {
      reasons.push('bad_ip_range');
      return { action: 'blocked', captchaRequired: false, reasons };
    }

    // 2. Approved /16 subnet blocks → immediate block.
    if (ip) {
      const subnet = this.ipv4Subnet16(ip);
      if (subnet && (await this.deniedSubnets().then((s) => s.has(subnet)))) {
        reasons.push('subnet_blocked');
        return { action: 'blocked', captchaRequired: false, reasons };
      }
    }

    // 3. Global per-email rate limit (targeted distributed attack).
    if (await this.hasKey(`sec:ratelimit:${this.normEmail(email)}`)) {
      reasons.push('email_rate_limited');
      return { action: 'blocked', captchaRequired: false, reasons };
    }

    // 4. CAPTCHA required for this email?
    const captchaRequired = await this.hasKey(
      `sec:captcha:${this.normEmail(email)}`,
    );

    if (captchaRequired) reasons.push('captcha_required');
    return {
      action: captchaRequired ? 'captcha' : 'allow',
      captchaRequired,
      reasons,
    };
  }

  /**
   * Verifies an hCaptcha response token against the siteverify API.
   * Returns true when the integration is not configured (feature off).
   */
  async verifyCaptcha(token: string, ip?: string): Promise<boolean> {
    const secret = this.config.get<string>('HCAPTCHA_SECRET_KEY');
    if (!secret) return true;

    try {
      const body = new URLSearchParams({ secret, response: token });
      if (ip) body.set('remoteip', ip);
      const res = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = (await res.json()) as { success?: boolean };
      return data.success === true;
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'hCaptcha siteverify request failed',
      );
      return false;
    }
  }

  // ── signal recording ───────────────────────────────────────────────────────

  /**
   * Records a failed login attempt and evaluates every distributed-attack
   * signal. Called after each wrong password (and for unknown emails too,
   * since stuffing attacks rarely target real accounts exclusively).
   */
  async recordFailedLogin(
    email: string,
    ip?: string,
    country?: string,
  ): Promise<void> {
    const normalized = this.normEmail(email);

    // Signal 1 — same email from many distinct IPs within 1 hour.
    if (ip) {
      const ipsKey = `sec:login:ips:${normalized}`;
      await this.sAdd(ipsKey, ip, 3600);
      const distinctIps = await this.sCard(ipsKey);

      if (distinctIps > this.distinctIpsThreshold) {
        await this.escalateTargetedEmail(normalized, distinctIps, ip);
      }
    }

    // Signal 2 — many failures from one /16 subnet within 10 minutes.
    if (ip) {
      const subnet = this.ipv4Subnet16(ip);
      if (subnet) {
        const count = await this.incrWithTtl(`sec:fail:subnet:${subnet}`, 600);
        if (count === this.subnetFailThreshold) {
          await this.proposeSubnetBlock(subnet, count, normalized);
        }
      }
    }

    // Signal 3 — unusual geographic distribution within 1 hour.
    if (country) {
      const geoKey = `sec:geo:${normalized}`;
      await this.sAdd(geoKey, country.toUpperCase(), 3600);
      const countries = await this.sCard(geoKey);

      if (countries > this.geoCountriesThreshold) {
        await this.escalateGeoAnomaly(normalized, countries);
      }
    }
  }

  /** Applies targeted-email countermeasures exactly once per window. */
  private async escalateTargetedEmail(
    normalizedEmail: string,
    distinctIps: number,
    latestIp: string,
  ): Promise<void> {
    const fresh = await this.setIfAbsent(
      `sec:escalated:email:${normalizedEmail}`,
      3600,
    );
    if (!fresh) return; // already escalated in this window

    // Global rate limit + CAPTCHA requirement
    await this.client()?.setEx(`sec:ratelimit:${normalizedEmail}`, 3600, '1');
    await this.client()?.setEx(`sec:captcha:${normalizedEmail}`, 1800, '1');

    await this.persistBlock({
      type: 'email_ratelimit',
      cidr: normalizedEmail,
      reason: 'distributed_credential_stuffing',
      metadata: { distinctIps, windowSeconds: 3600, sampleIp: latestIp },
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await this.persistBlock({
      type: 'captcha_email',
      cidr: normalizedEmail,
      reason: 'distributed_credential_stuffing',
      metadata: { distinctIps, windowSeconds: 3600, sampleIp: latestIp },
      expiresAt: new Date(Date.now() + 1800_000),
    });

    await this.alertSecurityTeam(
      'Targeted credential-stuffing attack detected',
      `Email ${normalizedEmail} was attempted from ${distinctIps} distinct IPs in the last hour. A global rate-limit and CAPTCHA requirement were applied automatically.`,
      { type: 'targeted_email_attack', email: normalizedEmail, distinctIps },
    );
  }

  /** Proposes a /16 subnet block pending manual approval (exactly once). */
  private async proposeSubnetBlock(
    subnet: string,
    failCount: number,
    sampleEmail: string,
  ): Promise<void> {
    const existing = await this.blockRepo.findOne({
      where: { cidr: subnet, type: In(['subnet_pending', 'subnet_active']) },
    });
    if (existing) return;

    await this.persistBlock({
      type: 'subnet_pending',
      cidr: subnet,
      reason: 'credential_stuffing',
      metadata: {
        failedLogins: failCount,
        windowSeconds: 600,
        sampleEmail,
      },
      expiresAt: null,
    });

    await this.alertSecurityTeam(
      'Credential stuffing from single subnet',
      `${failCount} failed logins originated from ${subnet} within 10 minutes. A temporary subnet block has been proposed and is awaiting manual approval.`,
      { type: 'subnet_block_proposed', subnet, failedLogins: failCount },
    );
  }

  /** Flags unusual geographic distribution (exactly once per window). */
  private async escalateGeoAnomaly(
    normalizedEmail: string,
    countryCount: number,
  ): Promise<void> {
    const fresh = await this.setIfAbsent(
      `sec:escalated:geo:${normalizedEmail}`,
      3600,
    );
    if (!fresh) return;

    await this.client()?.setEx(`sec:captcha:${normalizedEmail}`, 1800, '1');

    await this.persistBlock({
      type: 'captcha_email',
      cidr: normalizedEmail,
      reason: 'unusual_geo_distribution',
      metadata: { countryCount, windowSeconds: 3600 },
      expiresAt: new Date(Date.now() + 1800_000),
    });

    await this.alertSecurityTeam(
      'Unusual geographic distribution of login attempts',
      `Email ${normalizedEmail} was attempted from ${countryCount} distinct countries within one hour. CAPTCHA is now required for this address.`,
      { type: 'geo_anomaly', email: normalizedEmail, countryCount },
    );
  }

  // ── admin operations ───────────────────────────────────────────────────────

  listBlocks(): Promise<SecurityIpBlock[]> {
    return this.blockRepo.find({ order: { createdAt: 'DESC' }, take: 200 });
  }

  /** Approves a pending subnet block, activating enforcement immediately. */
  async approveBlock(
    blockId: string,
    adminId: string,
  ): Promise<SecurityIpBlock> {
    const block = await this.blockRepo.findOne({ where: { id: blockId } });
    if (!block) throw new Error('Security block not found.');
    if (block.type !== 'subnet_pending') {
      throw new Error('Only pending subnet blocks can be approved.');
    }

    block.type = 'subnet_active';
    block.approvedBy = adminId;
    const saved = await this.blockRepo.save(block);

    await this.addToDenySet(saved.cidr);
    this.logger.info(
      { blockId, cidr: saved.cidr, adminId },
      'Subnet block approved',
    );
    return saved;
  }

  /** Lifts (deactivates) a block and clears its Redis enforcement state. */
  async liftBlock(blockId: string): Promise<SecurityIpBlock> {
    const block = await this.blockRepo.findOne({ where: { id: blockId } });
    if (!block) throw new Error('Security block not found.');

    block.active = false;
    const saved = await this.blockRepo.save(block);

    if (block.type === 'subnet_active') {
      await this.removeFromDenySet(block.cidr);
    }
    if (block.type === 'captcha_email') {
      await this.client()?.del(`sec:captcha:${block.cidr}`);
    }
    if (block.type === 'email_ratelimit') {
      await this.client()?.del(`sec:ratelimit:${block.cidr}`);
    }
    return saved;
  }

  // ── CIDR helpers ───────────────────────────────────────────────────────────

  /** Parses "1.2.3.0/24,5.6.7.8/32" style threat-feed configuration. */
  parseBadRanges(raw: string): { network: number; prefix: number }[] {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => this.parseCidr(entry))
      .filter((r): r is { network: number; prefix: number } => r !== null);
  }

  isInBadRange(ip: string): boolean {
    const addr = this.ipv4ToLong(ip);
    if (addr === null) return false;
    return this.badRanges.some(
      ({ network, prefix }) =>
        prefix >= 0 &&
        prefix <= 32 &&
        this.mask(addr, prefix) === this.mask(network, prefix),
    );
  }

  /** Extracts the /16 subnet ("203.0.x.x" → "203.0.0.0/16") for IPv4 inputs. */
  ipv4Subnet16(ip: string): string | null {
    const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(ip);
    if (!m) return null;
    return `${m[1]}.${m[2]}.0.0/16`;
  }

  private parseCidr(cidr: string): { network: number; prefix: number } | null {
    const [addr, prefixRaw] = cidr.split('/');
    const network = this.ipv4ToLong(addr);
    if (network === null) return null;
    const prefix = prefixRaw === undefined ? 32 : parseInt(prefixRaw, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    return { network: this.mask(network, prefix), prefix };
  }

  private mask(value: number, prefix: number): number {
    if (prefix === 0) return 0;
    return value & ((0xffffffff << (32 - prefix)) >>> 0);
  }

  private ipv4ToLong(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let result = 0;
    for (const part of parts) {
      const octet = Number(part);
      if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
      result = result * 256 + octet;
    }
    return result >>> 0;
  }

  // ── Redis helpers (all no-op safely when Redis is unavailable) ─────────────

  private client(): RedisClientType | null {
    return this.redisClient;
  }

  private normEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private deniedSubnets(): Promise<Set<string>> {
    return (async () => {
      const client = this.client();
      if (!client?.isOpen) {
        const rows = await this.blockRepo.find({
          where: { type: 'subnet_active', active: true },
        });
        return new Set(rows.map((r) => r.cidr));
      }
      const members = await client.sMembers('sec:deny:subnets');
      return new Set(members ?? []);
    })();
  }

  private addToDenySet(cidr: string): Promise<void> {
    return (async () => {
      const client = this.client();
      if (client?.isOpen) await client.sAdd('sec:deny:subnets', cidr);
    })();
  }

  private removeFromDenySet(cidr: string): Promise<void> {
    return (async () => {
      const client = this.client();
      if (client?.isOpen) await client.sRem('sec:deny:subnets', cidr);
    })();
  }

  private async hasKey(key: string): Promise<boolean> {
    const client = this.client();
    if (!client?.isOpen) return false;
    return (await client.exists(key)) === 1;
  }

  private async setIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const client = this.client();
    if (!client?.isOpen) return false; // without Redis, never escalate
    return (await client.set(key, '1', { EX: ttlSeconds, NX: true })) === 'OK';
  }

  private async sAdd(
    key: string,
    member: string,
    ttlSeconds: number,
  ): Promise<void> {
    const client = this.client();
    if (!client?.isOpen) return;
    await client.sAdd(key, member);
    await client.expire(key, ttlSeconds);
  }

  private async sCard(key: string): Promise<number> {
    const client = this.client();
    if (!client?.isOpen) return 0;
    return client.sCard(key);
  }

  private async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const client = this.client();
    if (!client?.isOpen) return 0;
    const value = await client.incr(key);
    if (value === 1) await client.expire(key, ttlSeconds);
    return value;
  }

  private persistBlock(data: {
    type: SecurityBlockType;
    cidr: string;
    reason: string;
    metadata: Record<string, unknown>;
    expiresAt: Date | null;
  }): Promise<SecurityIpBlock> {
    return this.blockRepo.save(this.blockRepo.create(data as any));
  }

  private async alertSecurityTeam(
    subject: string,
    body: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.queueService.emit('admin.alert', {
        type: 'security_threat',
        subject,
        message: body,
        ...details,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        'Failed to emit security alert event',
      );
    }
  }
}
