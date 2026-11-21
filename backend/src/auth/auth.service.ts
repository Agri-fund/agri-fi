import {
  Injectable,
  Optional,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  OnModuleInit,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisClientType } from 'redis';
import { RedisConfig } from '../config/redis.config';
import * as bcrypt from 'bcrypt';
import * as argon2 from 'argon2';
import { randomBytes, createHash, randomUUID } from 'crypto';
import crypto from 'crypto';
import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  BASE_FEE,
  Transaction,
  Memo,
} from '@stellar/stellar-sdk';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from './jwt.strategy';
import { sanitizeRedirectUrl } from './utils/redirect-sanitizer';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';
import { LoginLog } from '../database/entities/login-log.entity';
import { AdminAction } from '../database/entities/admin-action.entity';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { TokenBlocklistService } from './token-blocklist.service';
import { TokenService } from './token.service';
import { SecurityThreatService } from './security-threat.service';
import { EmailSequenceService } from '../email-sequence/email-sequence.service';
import { KycRulesService } from '../kyc-rules/kyc-rules.service';
import { KycCustomerType } from '../kyc-rules/entities/kyc-jurisdiction-rule.entity';
import { BehavioralRiskService } from './behavioral-risk.service';
import { BehavioralRiskSignalDto } from './dto/behavioral-risk-signal.dto';

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/** Request context used by credential-stuffing detection (#898). */
export interface LoginMeta {
  ip?: string;
  userAgent?: string;
  country?: string;
  acceptLanguage?: string;
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly sep10SigningKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly sep10Domain: string;
  private redisClient: RedisClientType | null = null;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(KycSubmission)
    private readonly kycRepo: Repository<KycSubmission>,
    @InjectRepository(LoginLog)
    private readonly loginLogRepo: Repository<LoginLog>,
    @InjectRepository(AdminAction)
    private readonly adminActionRepo: Repository<AdminAction>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly notificationsService: NotificationsService,
    private readonly ofacSanctionsCheck: OfacSanctionsCheckService,
    private readonly tokenBlocklistService: TokenBlocklistService,
    private readonly tokenService: TokenService,
    private readonly securityThreat: SecurityThreatService,
    @Optional() private readonly emailSequenceService: EmailSequenceService,
    @Optional() private readonly auditService: AuditService,
    @Optional() private readonly kycRulesService: KycRulesService,
    @Optional()
    private readonly behavioralRiskService?: BehavioralRiskService,
    @Optional()
    private readonly redisConfig?: RedisConfig,
  ) {
    const network = this.configService.get<string>(
      'STELLAR_NETWORK',
      'testnet',
    );
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const sep10Secret = this.configService.get<string>(
      'SEP10_SIGNING_SECRET',
      '',
    );
    this.sep10SigningKeypair = sep10Secret
      ? Keypair.fromSecret(sep10Secret)
      : Keypair.random();

    this.sep10Domain = this.configService.get<string>(
      'SEP10_DOMAIN',
      'agri-fi.com',
    );
  }

  async onModuleInit(): Promise<void> {
    if (this.redisConfig && !this.redisClient) {
      try {
        this.redisClient = await this.redisConfig.createClient();
        if (this.redisClient && !this.redisClient.isOpen) {
          await this.redisClient.connect();
        }
      } catch (err: any) {
        this.loggerWarn('Failed to connect Redis client in AuthService for SEP-10', err);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  public setRedisClient(client: RedisClientType | null): void {
    this.redisClient = client;
  }

  private async getRedis(): Promise<RedisClientType | null> {
    if (!this.redisClient && this.redisConfig) {
      try {
        this.redisClient = await this.redisConfig.createClient();
      } catch (err: any) {
        this.loggerWarn('Failed to create Redis client for SEP-10', err);
        return null;
      }
    }
    if (!this.redisClient) return null;
    if (!this.redisClient.isOpen) {
      try {
        await this.redisClient.connect();
      } catch (err: any) {
        this.loggerWarn('Failed to reconnect Redis for SEP-10', err);
        return null;
      }
    }
    return this.redisClient;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private isBcryptHash(hash: string): boolean {
    return hash.startsWith('$2b$') || hash.startsWith('$2a$');
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private async verifyPassword(
    hash: string,
    password: string,
  ): Promise<boolean> {
    if (this.isBcryptHash(hash)) {
      return bcrypt.compare(password, hash);
    }
    return argon2.verify(hash, password);
  }

  private generateVerificationToken(): string {
    return randomBytes(32).toString('hex');
  }

  private appBaseUrl(): string {
    return this.configService.get<string>(
      'APP_BASE_URL',
      'http://localhost:3001',
    );
  }

  private async sendVerificationEmail(
    email: string,
    token: string,
  ): Promise<void> {
    const link = `${this.appBaseUrl()}/auth/verify-email?token=${token}`;
    await this.notificationsService.sendEmail(
      email,
      'Verify your Agri-Fi email address',
      `Please verify your email by visiting: ${link}`,
      `<p>Click <a href="${link}">here</a> to verify your email address. This link is valid for 24 hours.</p>`,
    );
  }

  private async sendEmailChangeVerificationEmail(
    email: string,
    token: string,
  ): Promise<void> {
    const link = `${this.appBaseUrl()}/auth/verify-email-change?token=${token}`;
    await this.notificationsService.sendEmail(
      email,
      'Confirm your new Agri-Fi email address',
      `Please confirm your new email address by visiting: ${link}`,
      `<p>Click <a href="${link}">here</a> to confirm your new email address. This link is valid for 24 hours.</p>`,
    );
  }

  private async sendEmailChangedNotification(
    oldEmail: string,
    newEmail: string,
  ): Promise<void> {
    await this.notificationsService.sendEmail(
      oldEmail,
      'Your Agri-Fi email address has been changed',
      `The email address on your Agri-Fi account has been changed to ${newEmail}. If you did not request this change, please contact support immediately.`,
      `<p>The email address on your Agri-Fi account has been changed to <strong>${newEmail}</strong>.</p>
       <p>If you did not request this change, please contact support immediately.</p>`,
    );
  }

  // ── register ───────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{
    id: string;
    email: string;
    role: string;
    kycStatus: string;
    redirect?: string;
  }> {
    const existing = await this.userRepo.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email is already registered.',
      });
    }

    const passwordHash = await this.hashPassword(dto.password);
    const emailVerificationToken = this.generateVerificationToken();

    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      country: dto.country,
      kycStatus: 'pending',
      isEmailVerified: false,
      emailVerificationToken,
    });

    let saved: User;
    try {
      saved = await this.userRepo.save(user);
    } catch (err: any) {
      // PostgreSQL unique_violation code
      if (err?.code === '23505') {
        throw new ConflictException({
          code: 'EMAIL_EXISTS',
          message: 'Email is already registered.',
        });
      }
      throw err;
    }

    await this.sendVerificationEmail(saved.email, emailVerificationToken);

    // Schedule the investor onboarding drip email sequence for new investors.
    // Fire-and-forget — a scheduling failure must not block registration.
    if (saved.role === 'investor' && this.emailSequenceService) {
      this.emailSequenceService
        .scheduleForUser(saved.id, saved.createdAt)
        .catch((err) => {
          // Non-fatal: log and continue
          console.error('[AuthService] Failed to schedule drip sequence', err);
        });
    }

    const safeRedirect = sanitizeRedirectUrl(dto.redirect);
    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      kycStatus: saved.kycStatus,
      redirect: safeRedirect || undefined,
    };
  }

  // ── verify email ───────────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({
      where: { emailVerificationToken: token },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token.');
    }

    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepo.save(user);

    return { message: 'Email verified successfully.' };
  }

  // ── email change ───────────────────────────────────────────────────────────

  private static readonly EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Requests a change of the account email address. The new address is stored
   * in `emailPending` and only becomes live once the user confirms via the
   * verification link sent to that address (#1414).
   */
  async requestEmailChange(
    userId: string,
    newEmail: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (normalizedEmail === user.email.toLowerCase()) {
      throw new BadRequestException(
        'New email address must differ from the current one.',
      );
    }

    const existing = await this.userRepo.findOne({
      where: { email: normalizedEmail },
    });
    if (existing && existing.id !== user.id) {
      throw new ConflictException({
        code: 'EMAIL_EXISTS',
        message: 'Email is already registered.',
      });
    }

    const token = this.generateVerificationToken();
    user.emailPending = normalizedEmail;
    user.emailChangeToken = token;
    user.emailChangeTokenExpiresAt = new Date(
      Date.now() + AuthService.EMAIL_CHANGE_TTL_MS,
    );
    await this.userRepo.save(user);

    await this.sendEmailChangeVerificationEmail(normalizedEmail, token);

    return {
      message:
        'A verification link has been sent to the new email address. The change will take effect once confirmed.',
    };
  }

  /**
   * Confirms a pending email change. Swaps `emailPending` into `email`, clears
   * the pending fields and notifies the old address of the change.
   */
  async verifyEmailChange(token: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({
      where: { emailChangeToken: token },
    });

    if (!user || !user.emailPending) {
      throw new BadRequestException(
        'Invalid or expired email change token.',
      );
    }

    if (
      !user.emailChangeTokenExpiresAt ||
      user.emailChangeTokenExpiresAt.getTime() < Date.now()
    ) {
      user.emailPending = null;
      user.emailChangeToken = null;
      user.emailChangeTokenExpiresAt = null;
      await this.userRepo.save(user);
      throw new BadRequestException(
        'Invalid or expired email change token.',
      );
    }

    const oldEmail = user.email;
    const newEmail = user.emailPending;

    user.email = newEmail;
    user.emailPending = null;
    user.emailChangeToken = null;
    user.emailChangeTokenExpiresAt = null;
    // The new address was proven via the confirmation link.
    user.isEmailVerified = true;
    await this.userRepo.save(user);

    await this.sendEmailChangedNotification(oldEmail, newEmail);

    return { message: 'Email address updated successfully.' };
  }

  /**
   * Clears stale pending-email state for changes that were never confirmed
   * within the 24-hour window. Intended to be invoked by a scheduled cron.
   */
  async cleanupExpiredEmailChanges(): Promise<{ cleared: number }> {
    const result = await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({
        emailPending: null,
        emailChangeToken: null,
        emailChangeTokenExpiresAt: null,
      })
      .where('email_change_token_expires_at IS NOT NULL')
      .andWhere('email_change_token_expires_at < :now', { now: new Date() })
      .execute();

    return { cleared: result.affected ?? 0 };
  }

  // ── token pair ─────────────────────────────────────────────────────────────

  /**
   * Issues a fresh access/refresh token pair via the shared TokenService.
   * Every refresh token gets a new unique jti; `familyId` is preserved across
   * a rotation chain (or started fresh on login) so replay of a rotated-out
   * token can be detected (#786).
   */
  private issueTokenPair(
    user: User,
    familyId: string = randomUUID(),
  ): { accessToken: string; refreshToken: string } {
    return this.tokenService.issueTokenPair(user, familyId);
  }

  /** Secure cookie options for JWT tokens */
  cookieOptions() {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'strict' as const,
      path: '/',
    };
  }

  async login(
    dto: LoginDto,
    meta?: LoginMeta,
  ): Promise<{ accessToken: string; refreshToken: string; redirect?: string }> {
    // ── #898: distributed credential-stuffing gate ──────────────────────────
    // Runs BEFORE user lookup / password verification so blocked traffic
    // never burns bcrypt/argon2 cycles (DoS safety).
    const threat = await this.securityThreat.checkLogin(dto.email, meta?.ip);
    if (threat.action === 'blocked') {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'LOGIN_RATE_LIMITED',
          message:
            'Too many suspicious login attempts. Please try again later.',
          reasons: threat.reasons,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (threat.captchaRequired) {
      // CAPTCHA was demanded for this email — a valid token must accompany
      // the attempt (tested end-to-end via mocked hCaptcha siteverify).
      if (!dto.captchaToken) {
        throw new ForbiddenException({
          code: 'CAPTCHA_REQUIRED',
          message:
            'Unusual activity detected. Please complete the CAPTCHA challenge.',
        });
      }
      const captchaOk = await this.securityThreat.verifyCaptcha(
        dto.captchaToken,
        meta?.ip,
      );
      if (!captchaOk) {
        throw new ForbiddenException({
          code: 'CAPTCHA_INVALID',
          message: 'CAPTCHA verification failed. Please try again.',
        });
      }
    }

    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) {
      // Unknown emails still feed the detection windows — stuffing attacks
      // rarely target real accounts exclusively.
      await this.securityThreat.recordFailedLogin(
        dto.email,
        meta?.ip,
        meta?.country,
      );
      throw new UnauthorizedException('Invalid credentials.');
    }

    // Check lockout
    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      const unlockAt = user.lockoutUntil.toISOString();
      throw new UnauthorizedException(
        `Account locked. Try again after ${unlockAt}.`,
      );
    }

    // Verify email requirement
    if (!user.isEmailVerified) {
      throw new UnauthorizedException(
        'Please verify your email address before logging in.',
      );
    }

    const valid = await this.verifyPassword(user.passwordHash, dto.password);

    if (!valid) {
      user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;

      // Feed the distributed-attack detectors (#898): distinct-IP-per-email
      // window, /16 subnet failure counter and geo-diversity flag all run
      // off every failed attempt.
      try {
        await this.securityThreat.recordFailedLogin(
          dto.email,
          meta?.ip,
          meta?.country,
        );
      } catch (err: any) {
        // Detection is best-effort; never mask the auth error.
        this.loggerWarn('recordFailedLogin failed', err);
      }

      if (user.failedLoginAttempts >= LOCKOUT_MAX_ATTEMPTS) {
        user.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        user.failedLoginAttempts = 0;
        await this.userRepo.save(user);

        // Generate unlock token and send lockout notification email
        const unlockToken = this.generateUnlockToken(user.id);
        const unlockUrl = `${this.appBaseUrl()}/auth/unlock/${unlockToken}`;
        const unlockAt = user.lockoutUntil.toUTCString();

        await this.notificationsService.sendEmail(
          user.email,
          'Your Agri-Fi account has been locked',
          `Your account has been temporarily locked due to 5 consecutive failed login attempts. Unlock your account: ${unlockUrl}. This link expires in 15 minutes.`,
          `<p>Your account has been temporarily locked due to 5 consecutive failed login attempts.</p>
           <p>You can unlock your account immediately using the link below:</p>
           <p><a href="${unlockUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Unlock My Account</a></p>
           <p><small>This link expires in 15 minutes. After that, your account will unlock automatically at <strong>${unlockAt}</strong>.</small></p>
           <p>If this wasn't you, please <a href="${this.appBaseUrl()}/auth/change-password">reset your password</a> immediately.</p>`,
        );

        throw new UnauthorizedException(
          `Account locked for 15 minutes due to too many failed attempts.`,
        );
      }

      await this.userRepo.save(user);
      throw new UnauthorizedException('Invalid credentials.');
    }

    // Successful login — reset counters and re-hash bcrypt passwords to argon2id
    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;

    if (this.isBcryptHash(user.passwordHash)) {
      user.passwordHash = await this.hashPassword(dto.password);
    }

    // ── #806: enforce MFA enrollment for admin / company_admin roles ─────────
    // Admin accounts must have MFA configured before they can receive tokens.
    // Return a 403 with a machine-readable code so the frontend can redirect
    // the user to the MFA setup flow rather than showing a generic error.
    if (
      (user.role === 'admin' || user.role === 'company_admin') &&
      !user.isMfaEnabled
    ) {
      // Persist the enrollment-required flag so the migration/guard can read it
      user.mfaEnrollmentRequired = true;
      await this.userRepo.save(user);

      throw new ForbiddenException({
        code: 'MFA_ENROLLMENT_REQUIRED',
        requiresMfaEnrollment: true,
        userId: user.id,
        message: 'MFA setup required for admin accounts',
      });
    }

    await this.userRepo.save(user);

    // ── #898/#897: audit log + localized new-device security alert ──────────
    if (meta?.ip || meta?.userAgent) {
      try {
        await this.recordSuccessfulLogin(user, meta);
      } catch (err: any) {
        this.loggerWarn('recordSuccessfulLogin failed', err);
      }
    }

    const tokens = this.issueTokenPair(user);
    const safeRedirect = sanitizeRedirectUrl(dto.redirect);
    return {
      ...tokens,
      redirect: safeRedirect || undefined,
    };
  }

  async loginWithGoogle(identity: GoogleIdentity): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    if (!identity.emailVerified) {
      throw new UnauthorizedException(
        'Your Google email address must be verified before signing in.',
      );
    }

    let user = await this.userRepo.findOne({
      where: { googleSubject: identity.subject },
    });

    if (user && user.role !== 'investor') {
      throw new ForbiddenException(
        'Google sign-in is available for investor accounts only.',
      );
    }

    if (!user) {
      user = await this.userRepo.findOne({ where: { email: identity.email } });
      if (user && user.role !== 'investor') {
        throw new ForbiddenException(
          'Google sign-in is available for investor accounts only.',
        );
      }
    }

    if (!user) {
      user = this.userRepo.create({
        email: identity.email,
        googleSubject: identity.subject,
        passwordHash: await this.hashPassword(randomBytes(32).toString('hex')),
        role: 'investor',
        country: 'UN',
        kycStatus: 'pending',
        isEmailVerified: true,
      });
    } else if (!user.googleSubject) {
      user.googleSubject = identity.subject;
    } else if (user.googleSubject !== identity.subject) {
      throw new UnauthorizedException(
        'This email is already linked to a different Google account.',
      );
    }

    user.failedLoginAttempts = 0;
    user.lockoutUntil = null;
    user.isEmailVerified = true;
    await this.userRepo.save(user);
    return this.issueTokenPair(user);
  }

  /** Persists a LoginLog row and alerts the user about unrecognized devices. */
  private async recordSuccessfulLogin(
    user: User,
    meta?: LoginMeta,
  ): Promise<void> {
    if (!meta?.ip) return;

    const deviceFingerprint = this.computeDeviceFingerprint(
      meta.userAgent,
      meta.acceptLanguage,
    );
    const countryCode = meta.country
      ? meta.country.toUpperCase().slice(0, 2)
      : null;

    const previousLogs =
      this.loginLogRepo && (this.loginLogRepo as any).find
        ? await this.loginLogRepo.find({
            where: { userId: user.id },
            order: { createdAt: 'DESC' },
            take: 5,
          })
        : [];

    await this.loginLogRepo.save(
      this.loginLogRepo.create({
        userId: user.id,
        ipAddress: meta.ip ?? 'unknown',
        userAgent: meta.userAgent ?? 'unknown',
        country: meta.country ?? null,
        countryCode,
        deviceFingerprint,
      }),
    );

    const knownDevice = previousLogs.some(
      (log) => log.deviceFingerprint === deviceFingerprint,
    );

    if (previousLogs.length > 0 && !knownDevice) {
      const revokeToken = randomBytes(32).toString('hex');
      user.revokeToken = revokeToken;
      await this.userRepo.save(user);

      const revokeUrl = `${this.appBaseUrl()}/auth/revoke-session/${revokeToken}`;

      await this.queueService.emit('email.notification', {
        type: 'security_alert_new_device',
        userId: user.id,
        email: user.email,
        details: {
          ipAddress: meta.ip,
          country: meta.country ?? 'Unknown',
          device: meta.userAgent ?? 'unknown device',
          time: new Date().toISOString(),
          revokeUrl,
        },
      });
    }
  }

  private computeDeviceFingerprint(
    userAgent?: string,
    acceptLanguage?: string,
  ): string {
    const raw = `${userAgent ?? ''}|${acceptLanguage ?? ''}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  async revokeSession(revokeToken: string): Promise<{ message: string }> {
    const userId = await this.findUserByRevokeToken(revokeToken);
    if (!userId) {
      throw new BadRequestException('Invalid or expired revocation link.');
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.revokeToken = null;
    await this.userRepo.save(user);

    return { message: 'All sessions have been revoked. Please log in again.' };
  }

  private async findUserByRevokeToken(
    revokeToken: string,
  ): Promise<string | null> {
    if (!revokeToken) return null;
    try {
      const user = await this.userRepo.findOne({
        where: { revokeToken },
      });
      return user?.id ?? null;
    } catch {
      return null;
    }
  }

  /** Minimal warning logging that works with or without an injected logger. */
  private loggerWarn(message: string, err: unknown): void {
    // eslint-disable-next-line no-console
    console.warn(`[AuthService] ${message}:`, (err as Error)?.message);
  }

  // ── refresh ────────────────────────────────────────────────────────────────

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (payload.typ !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const user = await this.userRepo.findOne({ where: { id: payload.sub } });
    if (!user)
      throw new UnauthorizedException('Invalid or expired refresh token.');

    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Token no longer valid.');
    }

    const { jti, familyId } = payload;

    if (
      familyId &&
      (await this.tokenBlocklistService.isTokenFamilyRevoked(familyId))
    ) {
      throw new UnauthorizedException('Token no longer valid.');
    }

    if (jti) {
      const alreadyRotated =
        await this.tokenBlocklistService.isRefreshTokenRotated(jti);

      if (alreadyRotated) {
        // A refresh token that was already rotated out is being replayed —
        // the token family may be compromised. Shut it down and force the
        // user to re-authenticate on every device (#786).
        if (familyId) {
          await this.tokenService.revokeTokenFamily(familyId);
        }
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        await this.userRepo.save(user);
        throw new UnauthorizedException(
          'Refresh token reuse detected. All sessions have been revoked.',
        );
      }

      await this.tokenService.markRefreshTokenRotated(payload);
    }

    return this.issueTokenPair(user, familyId);
  }

  // ── logout & token revocation ──────────────────────────────────────────────

  /**
   * Logout a user. If a raw token string is provided it will be blocklisted
   * until its natural expiry. In all cases the user's `tokenVersion` is
   * incremented to immediately invalidate existing sessions.
   */
  async logout(userId: string, token?: string): Promise<{ message: string }> {
    // If a token string is provided, try to blocklist it until expiry.
    if (token) {
      await this.tokenService.blocklistToken(token);
    }

    // Bump tokenVersion so all issued JWTs become invalid immediately.
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);
    return { message: 'Logged out successfully.' };
  }

  // ── MFA ───────────────────────────────────────────────────────────────────

  private static readonly MFA_MAX_ATTEMPTS = 5;
  private static readonly MFA_LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

  async setupMfa(userId: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeUrl: string;
    backupCodes: string[];
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const secret = authenticator.generateSecret();
    user.mfaSecret = secret;

    // Generate 8 backup codes (plaintext returned once, bcrypt-hashed stored)
    const backupCodes = Array.from({ length: 8 }, () =>
      randomBytes(4).toString('hex').toUpperCase(),
    );
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((code) => bcrypt.hash(code, 10)),
    );
    user.mfaBackupCodes = hashedBackupCodes;

    await this.userRepo.save(user);

    const issuer = this.configService.get<string>(
      'MFA_ISSUER',
      'Agri-Fi Platform',
    );
    const otpauthUrl = authenticator.keyuri(user.email, issuer, secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauthUrl);

    return { secret, otpauthUrl, qrCodeUrl, backupCodes };
  }

  async enableMfa(
    userId: string,
    token: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!user.mfaSecret) {
      throw new BadRequestException(
        'MFA secret not setup. Call /auth/mfa/setup first.',
      );
    }

    let isValid = false;
    try {
      isValid = authenticator.verify({
        token: token.trim(),
        secret: user.mfaSecret,
      });
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new BadRequestException('Invalid MFA verification code.');
    }

    user.isMfaEnabled = true;
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = null;
    await this.userRepo.save(user);

    return { success: true, message: 'MFA enabled successfully.' };
  }

  async disableMfa(
    userId: string,
    token: string,
    password: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!user.isMfaEnabled) {
      throw new BadRequestException('MFA is not enabled for this account.');
    }

    // Verify password
    const passwordValid = await this.verifyPassword(
      user.passwordHash,
      password,
    );
    if (!passwordValid) {
      throw new BadRequestException('Invalid password.');
    }

    // Verify TOTP
    const totpValid = this.verifyTotpToken(user.mfaSecret!, token);
    if (!totpValid) {
      throw new BadRequestException('Invalid MFA token.');
    }

    user.isMfaEnabled = false;
    user.mfaSecret = null;
    user.mfaBackupCodes = null;
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = null;
    await this.userRepo.save(user);

    return { success: true, message: 'MFA disabled successfully.' };
  }

  async verifyMfa(userId: string, token: string): Promise<{ valid: boolean }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!user.isMfaEnabled || !user.mfaSecret) {
      throw new BadRequestException('MFA is not enabled for this account.');
    }

    // Check lockout
    if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
      throw new ForbiddenException({
        code: 'MFA_LOCKED_OUT',
        message: `Too many failed attempts. Try again after ${user.mfaLockedUntil.toISOString()}.`,
      });
    }

    // Try TOTP first
    let isValid = this.verifyTotpToken(user.mfaSecret, token.trim());

    // If TOTP fails, try backup codes
    if (!isValid && user.mfaBackupCodes?.length) {
      for (let i = 0; i < user.mfaBackupCodes.length; i++) {
        const codeMatch = await bcrypt.compare(
          token.trim(),
          user.mfaBackupCodes[i],
        );
        if (codeMatch) {
          isValid = true;
          // Remove used backup code (single-use)
          user.mfaBackupCodes.splice(i, 1);
          break;
        }
      }
    }

    if (!isValid) {
      user.mfaFailedAttempts = (user.mfaFailedAttempts || 0) + 1;
      if (user.mfaFailedAttempts >= AuthService.MFA_MAX_ATTEMPTS) {
        user.mfaLockedUntil = new Date(Date.now() + AuthService.MFA_LOCKOUT_MS);
        user.mfaFailedAttempts = 0;
      }
      await this.userRepo.save(user);
      throw new BadRequestException('Invalid MFA token.');
    }

    // Success — reset failed attempts
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = null;
    await this.userRepo.save(user);

    return { valid: true };
  }

  private verifyTotpToken(secret: string, token: string): boolean {
    try {
      return authenticator.verify({ token: token.trim(), secret });
    } catch {
      return false;
    }
  }

  // ── wallet ─────────────────────────────────────────────────────────────────

  async linkWallet(
    userId: string,
    walletAddress: string,
  ): Promise<{ walletAddress: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    // Check if the wallet address is sanctioned
    const isSanctioned =
      await this.ofacSanctionsCheck.isAddressSanctioned(walletAddress);
    if (isSanctioned) {
      throw new BadRequestException({
        code: 'SANCTIONED_ADDRESS',
        message:
          'The provided wallet address is sanctioned and cannot be linked to an account.',
      });
    }

    user.walletAddress = walletAddress;
    await this.userRepo.save(user);
    return { walletAddress };
  }

  // ── KYC ───────────────────────────────────────────────────────────────────

  async submitKyc(
    userId: string,
    dto: SubmitKycDto,
  ): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    // Enforce country-level KYC document matrix when a jurisdiction is provided (#1019)
    if (dto.countryCode && this.kycRulesService) {
      await this.kycRulesService.assertValidSubmission({
        countryCode: dto.countryCode,
        customerType: dto.isCorporate
          ? KycCustomerType.CORPORATE
          : KycCustomerType.INDIVIDUAL,
        documentType: dto.documentType,
        idNumber: dto.idNumber,
        documentExpiresAt: dto.documentExpiresAt,
        hasGovernmentIdFront: Boolean(dto.governmentIdUrl),
        hasGovernmentIdBack: Boolean(dto.identityDocumentBackUrl),
        hasProofOfAddress: Boolean(dto.proofOfAddressUrl),
        hasSelfie: Boolean(dto.selfieUrl),
        hasBusinessLicense: Boolean(dto.businessLicenseUrl),
        hasArticlesOfIncorporation: Boolean(dto.articlesOfIncorporationUrl),
      });
    }

    const isAutoApprove =
      this.configService.get<string>('KYC_AUTO_APPROVE') === 'true';

    const automatedApproval = dto.isCorporate ? false : isAutoApprove;

    const submission = this.kycRepo.create({
      userId,
      governmentIdUrl: dto.governmentIdUrl,
      identityDocumentBackUrl: dto.identityDocumentBackUrl,
      proofOfAddressUrl: dto.proofOfAddressUrl,
      selfieUrl: dto.selfieUrl,
      isCorporate: dto.isCorporate ?? false,
      companyName: dto.companyName,
      registrationNumber: dto.registrationNumber,
      businessLicenseUrl: dto.businessLicenseUrl,
      articlesOfIncorporationUrl: dto.articlesOfIncorporationUrl,
      documentExpiresAt: dto.documentExpiresAt
        ? new Date(dto.documentExpiresAt)
        : null,
      status: automatedApproval ? 'approved' : 'pending_review',
    });

    await this.kycRepo.save(submission);

    if (dto.isCorporate) {
      user.companyDetails = {
        companyName: dto.companyName,
        registrationNumber: dto.registrationNumber,
        articlesOfIncorporationUrl: dto.articlesOfIncorporationUrl,
      };
      await this.userRepo.save(user);
    }

    if (automatedApproval) {
      user.kycStatus = 'verified';
      user.kycDraft = null;
      await this.userRepo.save(user);
      console.log(
        `KYC auto-verified for user ${user.email} (Method: ${dto.isCorporate ? 'Automated Corporate' : 'System Config'}).`,
      );
      this.queueService.emit('email.notification', {
        type: 'kyc_verified',
        email: user.email,
        userId: user.id,
      });
    } else {
      console.log(`KYC submission pending review for user ${user.email}.`);
    }

    return { kycStatus: user.kycStatus };
  }

  async getKycDraft(
    userId: string,
  ): Promise<{ draft: Record<string, unknown> | null }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return { draft: user.kycDraft ?? null };
  }

  async saveKycDraft(
    userId: string,
    draft: Record<string, unknown>,
  ): Promise<{ draft: Record<string, unknown> | null }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    user.kycDraft = draft;
    await this.userRepo.save(user);
    return { draft: user.kycDraft };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private pickFirstString(
    source: Record<string, unknown>,
    keys: string[],
  ): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private mapProviderKycStatus(
    payload: Record<string, unknown>,
  ): User['kycStatus'] | null {
    const rootStatus = this.pickFirstString(payload, [
      'status',
      'reviewStatus',
      'kycStatus',
      'result',
    ]);

    const reviewResult = this.asRecord(payload.reviewResult);
    const reviewAnswer = reviewResult
      ? this.pickFirstString(reviewResult, ['reviewAnswer', 'answer'])
      : null;

    const normalized = (reviewAnswer ?? rootStatus ?? '').toLowerCase();
    if (!normalized) {
      return null;
    }

    if (
      ['approved', 'verified', 'green', 'completed', 'success'].includes(
        normalized,
      )
    ) {
      return 'verified';
    }

    if (
      ['rejected', 'declined', 'red', 'failed', 'failure'].includes(normalized)
    ) {
      return 'rejected';
    }

    if (
      ['pending', 'yellow', 'processing', 'queued', 'on_hold'].includes(
        normalized,
      )
    ) {
      return 'pending';
    }

    return null;
  }

  private extractKycWebhookUserReference(
    payload: Record<string, unknown>,
  ): string | null {
    const directReference = this.pickFirstString(payload, [
      'externalUserId',
      'userId',
      'customerId',
      'clientId',
      'email',
    ]);
    if (directReference) {
      return directReference;
    }

    const applicant = this.asRecord(payload.applicant);
    if (applicant) {
      return this.pickFirstString(applicant, [
        'externalUserId',
        'userId',
        'email',
      ]);
    }

    return null;
  }

  async handleKycWebhook(payload: Record<string, unknown>): Promise<{
    received: true;
    updated: boolean;
    userId?: string;
    kycStatus?: User['kycStatus'];
  }> {
    const userReference = this.extractKycWebhookUserReference(payload);
    if (!userReference) {
      return { received: true, updated: false };
    }

    const user = await this.userRepo.findOne({
      where: [{ id: userReference }, { email: userReference }],
    });
    if (!user) {
      return { received: true, updated: false };
    }

    const mappedStatus = this.mapProviderKycStatus(payload);
    if (!mappedStatus || user.kycStatus === mappedStatus) {
      return {
        received: true,
        updated: false,
        userId: user.id,
        kycStatus: user.kycStatus,
      };
    }

    user.kycStatus = mappedStatus;
    await this.userRepo.save(user);

    if (mappedStatus === 'verified') {
      this.queueService.emit('email.notification', {
        type: 'kyc_verified',
        email: user.email,
        userId: user.id,
      });
    }

    return {
      received: true,
      updated: true,
      userId: user.id,
      kycStatus: user.kycStatus,
    };
  }

  async approveCorporateKycSubmission(
    submissionId: string,
    adminId: string,
    reason?: string,
  ): Promise<{ kycStatus: string }> {
    const submission = await this.kycRepo.findOne({
      where: { id: submissionId },
    });
    if (!submission) {
      throw new NotFoundException('KYC submission not found.');
    }

    if (!submission.isCorporate) {
      throw new ConflictException({
        code: 'NOT_CORPORATE_SUBMISSION',
        message: 'This KYC submission is not a corporate submission.',
      });
    }

    const user = await this.userRepo.findOne({
      where: { id: submission.userId },
    });
    if (!user) throw new NotFoundException('User not found.');

    submission.status = 'approved';
    await this.kycRepo.save(submission);

    user.isCompany = true;
    user.companyDetails = {
      companyName: submission.companyName ?? undefined,
      registrationNumber: submission.registrationNumber ?? undefined,
      articlesOfIncorporationUrl:
        submission.articlesOfIncorporationUrl ?? undefined,
    };
    user.kycStatus = 'verified';
    await this.userRepo.save(user);

    await this.adminActionRepo.save(
      this.adminActionRepo.create({
        adminId,
        targetUserId: user.id,
        action: 'approve_corporate_kyc',
        payload: { submissionId },
        reason: reason ?? null,
      }),
    );

    return { kycStatus: user.kycStatus };
  }

  async approveKyc(
    userId: string,
    adminId: string,
    reason?: string,
  ): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const submission = await this.kycRepo.findOne({
      where: { userId, status: 'pending_review' },
      order: { createdAt: 'DESC' },
    });

    if (!submission) {
      throw new NotFoundException(
        'No pending KYC submission found for this user.',
      );
    }

    submission.status = 'approved';
    await this.kycRepo.save(submission);

    if (submission.isCorporate) {
      user.isCompany = true;
      user.companyDetails = {
        companyName: submission.companyName ?? undefined,
        registrationNumber: submission.registrationNumber ?? undefined,
        articlesOfIncorporationUrl:
          submission.articlesOfIncorporationUrl ?? undefined,
      };
    }

    user.kycStatus = 'verified';
    await this.userRepo.save(user);

    await this.adminActionRepo.save(
      this.adminActionRepo.create({
        adminId,
        targetUserId: user.id,
        action: 'approve_kyc',
        payload: { submissionId: submission.id },
        reason: reason ?? null,
      }),
    );

    console.log(
      `KYC manually verified for user ${user.email} — notification queued.`,
    );
    this.queueService.emit('email.notification', {
      type: 'kyc_verified',
      email: user.email,
      userId: user.id,
    });

    return { kycStatus: user.kycStatus };
  }

  async rejectKyc(
    userId: string,
    adminId?: string,
    reason?: string,
  ): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const submission = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (submission) {
      submission.status = 'rejected';
      (submission as any).rejectionReason = reason ?? null;
      await this.kycRepo.save(submission);
    }

    user.kycStatus = 'rejected';
    await this.userRepo.save(user);

    if (adminId) {
      await this.adminActionRepo.save(
        this.adminActionRepo.create({
          adminId,
          targetUserId: user.id,
          action: 'reject_kyc',
          payload: { submissionId: submission?.id },
          reason: reason ?? null,
        }),
      );
    }

    this.queueService.emit('email.notification', {
      type: 'kyc_rejected',
      email: user.email,
      userId: user.id,
      reason: reason ?? 'Submitted documents did not meet requirements',
    });

    return { kycStatus: user.kycStatus };
  }

  // ── admin ──────────────────────────────────────────────────────────────────

  async updateUserRole(
    userId: string,
    role: User['role'],
    adminId?: string,
    reason?: string,
    complianceDomain?: string,
  ): Promise<{ id: string; role: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const previousRole = user.role;
    if (role === 'compliance_officer' && !complianceDomain?.trim()) {
      throw new BadRequestException('Compliance officers require a domain.');
    }
    user.role = role;
    user.complianceDomain = role === 'compliance_officer' ? complianceDomain!.trim() : null;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    const saved = await this.userRepo.save(user);

    if (adminId) {
      await this.adminActionRepo.save(
        this.adminActionRepo.create({
          adminId,
          targetUserId: userId,
          action: 'update_user_role',
          payload: { previousRole, newRole: role },
          reason: reason ?? null,
        }),
      );
    }

    return { id: saved.id, role: saved.role };
  }

  // ── password ───────────────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const valid = await this.verifyPassword(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!valid) throw new BadRequestException('Current password is incorrect.');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current password.',
      );
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);

    return {
      message: 'Password updated. All active sessions have been invalidated.',
    };
  }



  // ── behavioral biometrics (#1222) ─────────────────────────────────────────

  /**
   * Accepts a client-computed behavioral risk signal (typing dynamics, mouse
   * trajectory, device usage) and returns an adaptive-authentication decision.
   *
   * Behavioral data is evaluated in-memory only — no raw behavioral samples
   * are persisted or sent to the cloud (privacy requirement).
   */
  async evaluateBehavioralRisk(
    userId: string,
    dto: BehavioralRiskSignalDto,
  ): Promise<{
    decision: 'allow' | 'require_mfa' | 'force_reauth';
    riskScore: number;
    reasons: string[];
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (!this.behavioralRiskService) {
      // Fail open to the existing static auth posture when the behavioral
      // subsystem is not wired (e.g. feature disabled).
      return { decision: 'allow', riskScore: 0, reasons: [] };
    }

    const result = await this.behavioralRiskService.evaluate(userId, dto);

    // High-risk sessions invalidate outstanding tokens so the client is
    // forced through a fresh authentication (re-auth) flow.
    if (result.decision === 'force_reauth') {
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await this.userRepo.save(user);
    }

    try {
      await this.auditService?.logEvent({
        actorId: userId,
        actorRole: user.role,
        route: 'POST /auth/behavioral/risk',
        statusCode: 200,
        requestDetails: {
          decision: result.decision,
          riskScore: result.riskScore,
          reasons: result.reasons,
        },
      });
    } catch (err: any) {
      this.loggerWarn('behavioral risk audit failed', err);
    }

    return result;
  }

  // ── account unlock ────────────────────────────────────────────────────────

  /**
   * Generates a signed JWT unlock token with 15-minute expiry.
   * Token contains userId and is used in the unlock link sent via email.
   */
  private generateUnlockToken(userId: string): string {
    return this.tokenService.generateUnlockToken(userId);
  }

  /**
   * Validates an unlock token and resets the account lockout.
   * Logs the unlock attempt to login_logs table.
   */
  async unlockAccount(
    token: string,
    meta?: LoginMeta,
  ): Promise<{ message: string }> {
    const userId = this.tokenService.verifyUnlockToken(token);
    if (!userId) {
      throw new BadRequestException({ code: 'INVALID_UNLOCK_TOKEN', message: 'Invalid unlock token.' });
    }
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const wasLocked = !!(user.lockoutUntil && user.lockoutUntil > new Date());
    user.lockoutUntil = null;
    user.failedLoginAttempts = 0;
    await this.userRepo.save(user);

    // Log unlock attempt to login_logs with metadata
    if (meta?.ip) {
      const deviceFingerprint = this.computeDeviceFingerprint(meta.userAgent, meta.acceptLanguage);
      const countryCode = meta.country ? meta.country.toUpperCase().slice(0, 2) : null;
      await this.loginLogRepo.save(
        this.loginLogRepo.create({
          userId: user.id,
          ipAddress: meta.ip ?? 'unknown',
          userAgent: `unlock_attempt|${meta.userAgent ?? 'unknown'}`,
          country: meta.country ?? null,
          countryCode,
          deviceFingerprint,
        }),
      );
    }

    return {
      message: wasLocked ? 'Account has been unlocked successfully. You can now log in.' : 'Account unlock token validated.',
    };
  }

  // ── bulk KYC (#800) ────────────────────────────────────────────────────────

  /**
   * Approve or reject multiple KYC submissions in a single request.
   *
   * For each userId:
   *  - Updates the most recent `pending_review` submission to the new status.
   *  - Updates the user's `kycStatus` on the user record.
   *  - Writes an individual entry to `system_audit_logs`.
   *  - Enqueues an email notification for the affected user.
   *
   * Entries that cannot be found (or have no pending submission) are recorded
   * in the `failures` array in the response and do NOT abort the whole batch.
   */
  async bulkApproveOrRejectKyc(params: {
    userIds: string[];
    action: 'approve' | 'reject';
    reason?: string;
    adminId: string;
    adminRole?: string;
  }): Promise<{
    processed: Array<{ userId: string; kycStatus: string }>;
    failures: Array<{ userId: string; reason: string }>;
  }> {
    const { userIds, action, reason, adminId, adminRole } = params;

    if (action === 'reject' && !reason?.trim()) {
      throw new BadRequestException(
        'A reason is required when rejecting KYC submissions.',
      );
    }

    const processed: Array<{ userId: string; kycStatus: string }> = [];
    const failures: Array<{ userId: string; reason: string }> = [];

    for (const userId of userIds) {
      try {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) {
          failures.push({ userId, reason: 'User not found.' });
          continue;
        }

        const submission = await this.kycRepo.findOne({
          where: { userId, status: 'pending_review' },
          order: { createdAt: 'DESC' },
        });
        if (!submission) {
          failures.push({
            userId,
            reason: 'No pending KYC submission found for this user.',
          });
          continue;
        }

        if (action === 'approve') {
          submission.status = 'approved';
          await this.kycRepo.save(submission);

          if (submission.isCorporate) {
            user.isCompany = true;
            user.companyDetails = {
              companyName: submission.companyName ?? undefined,
              registrationNumber: submission.registrationNumber ?? undefined,
              articlesOfIncorporationUrl:
                submission.articlesOfIncorporationUrl ?? undefined,
            };
          }

          user.kycStatus = 'verified';
          await this.userRepo.save(user);

          await this.adminActionRepo.save(
            this.adminActionRepo.create({
              adminId,
              targetUserId: user.id,
              action: 'approve_kyc',
              payload: { submissionId: submission.id, bulk: true },
              reason: reason ?? null,
            }),
          );

          // Write individual audit log entry
          await this.auditService?.logEvent({
            actorId: adminId,
            actorRole: adminRole ?? 'admin',
            route: 'PATCH /admin/kyc/bulk',
            statusCode: 200,
            requestDetails: {
              action: 'approve',
              userId,
              submissionId: submission.id,
              reason: reason ?? null,
            },
          });

          this.queueService.emit('email.notification', {
            type: 'kyc_verified',
            email: user.email,
            userId: user.id,
          });

          processed.push({ userId, kycStatus: user.kycStatus });
        } else {
          submission.status = 'rejected';
          await this.kycRepo.save(submission);

          user.kycStatus = 'rejected';
          await this.userRepo.save(user);

          await this.adminActionRepo.save(
            this.adminActionRepo.create({
              adminId,
              targetUserId: user.id,
              action: 'reject_kyc',
              payload: { submissionId: submission.id, bulk: true },
              reason: reason ?? null,
            }),
          );

          // Write individual audit log entry
          await this.auditService?.logEvent({
            actorId: adminId,
            actorRole: adminRole ?? 'admin',
            route: 'PATCH /admin/kyc/bulk',
            statusCode: 200,
            requestDetails: {
              action: 'reject',
              userId,
              submissionId: submission.id,
              reason,
            },
          });

          this.queueService.emit('email.notification', {
            type: 'kyc_rejected',
            email: user.email,
            userId: user.id,
            reason,
          });

          processed.push({ userId, kycStatus: user.kycStatus });
        }
      } catch (err: any) {
        failures.push({
          userId,
          reason: err?.message ?? 'Unknown error.',
        });
      }
    }

    return { processed, failures };
  }

  // ── list users ─────────────────────────────────────────────────────────────

  async listUsers(
    page = 1,
    limit = 100,
  ): Promise<{ users: Partial<User>[]; total: number }> {
    const [users, total] = await this.userRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
      select: [
        'id',
        'email',
        'role',
        'kycStatus',
        'country',
        'createdAt',
        'walletAddress',
        'isCompany',
        'isEmailVerified',
      ],
    });
    return { users, total };
  }

  /**
   * Generates a SEP-10 challenge transaction for Stellar Web Authentication.
   * The client signs this transaction to prove ownership of their wallet.
   * See detailed flow doc: [SEP-10 Flow](../../../docs/auth/sep10-flow.md)
   */
  async generateSep10Challenge(
    clientPublicKey: string,
  ): Promise<{ transactionXdr: string; networkPassphrase: string }> {
    if (!clientPublicKey || !clientPublicKey.startsWith('G')) {
      throw new BadRequestException('Invalid Stellar public key');
    }

    const redis = await this.getRedis();
    if (!redis) {
      this.loggerWarn('Redis unavailable during SEP-10 challenge generation', 'fail-closed');
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const manageDataKey = `${this.sep10Domain} SEP-10 Web Auth`;
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 300; // 5 minutes

    const tx = new TransactionBuilder(
      {
        sequence: '0',
        accountId: () => this.sep10SigningKeypair.publicKey(),
      } as any,
      {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
        timebounds: {
          minTime: 0,
          maxTime: now + 300,
        },
      },
    )
      .addOperation(
        Operation.manageData({
          name: manageDataKey,
          value: nonce,
          source: clientPublicKey,
        }),
      )
      .addMemo(Memo.text('SEP-10 Auth'))
      .build();

    tx.sign(this.sep10SigningKeypair);

    // Store challenge in Redis with 300s TTL (fail-closed if Redis write fails)
    const challengeKey = `sep10:challenge:${clientPublicKey}`;
    const payload = JSON.stringify({
      nonce,
      transactionXdr: tx.toXDR(),
      expiresAt: expiry,
    });

    try {
      await redis.setEx(challengeKey, 300, payload);
    } catch (err: any) {
      this.loggerWarn('Failed to write SEP-10 challenge to Redis', err);
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    return {
      transactionXdr: tx.toXDR(),
      networkPassphrase: this.networkPassphrase,
    };
  }

  /**
   * Validates a client-signed SEP-10 challenge response and issues a JWT.
   */
  async validateSep10Response(
    signedXdr: string,
  ): Promise<{ accessToken: string; refreshToken: string; publicKey: string }> {
    let tx: Transaction;
    try {
      tx = new Transaction(signedXdr, this.networkPassphrase);
    } catch {
      throw new UnauthorizedException('Invalid SEP-10 response XDR');
    }

    const now = Math.floor(Date.now() / 1000);
    if (tx.timeBounds) {
      if (tx.timeBounds.maxTime && now > tx.timeBounds.maxTime) {
        throw new UnauthorizedException('SEP-10 challenge has expired');
      }
    }

    // Verify server signature
    const serverSigned = tx.signatures.some((sig) => {
      try {
        const keypair = this.sep10SigningKeypair;
        return keypair.verify(tx.hash(), sig.signature);
      } catch {
        return false;
      }
    });
    if (!serverSigned) {
      throw new UnauthorizedException(
        'SEP-10 challenge is not signed by the server',
      );
    }

    // Extract the manageData operation to find the client public key
    const manageDataOp = tx.operations.find(
      (op) => op.type === 11, // manageData
    );
    if (!manageDataOp) {
      throw new UnauthorizedException(
        'SEP-10 challenge must contain a manageData operation',
      );
    }

    const clientPublicKey = (manageDataOp as any).source;
    if (!clientPublicKey) {
      throw new UnauthorizedException(
        'manageData operation must have a source account',
      );
    }

    const redis = await this.getRedis();
    if (!redis) {
      this.loggerWarn('Redis unavailable during SEP-10 challenge validation', 'fail-closed');
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    const challengeKey = `sep10:challenge:${clientPublicKey}`;
    let challengeRaw: string | null = null;
    try {
      challengeRaw = await redis.get(challengeKey);
    } catch (err: any) {
      this.loggerWarn('Failed to fetch SEP-10 challenge from Redis', err);
      throw new ServiceUnavailableException(
        'Authentication service temporarily unavailable',
      );
    }

    if (!challengeRaw) {
      throw new UnauthorizedException('SEP-10 challenge not found or expired');
    }

    let storedChallenge: { nonce: string; transactionXdr?: string; expiresAt: number };
    try {
      storedChallenge = JSON.parse(challengeRaw);
    } catch {
      throw new UnauthorizedException('Malformed SEP-10 challenge stored');
    }

    const opValue = (manageDataOp as any).value?.toString();
    if (storedChallenge.nonce && opValue && opValue !== storedChallenge.nonce) {
      throw new UnauthorizedException('SEP-10 challenge nonce mismatch');
    }

    // Verify client signature
    const txHash = tx.hash();
    const clientVerified = tx.signatures.some((sig) => {
      try {
        const hint = Buffer.from(sig.hint as any).toString('hex');
        const clientKeypair = Keypair.fromPublicKey(clientPublicKey);
        const clientHint = Buffer.from(clientKeypair.signatureHint() as any).toString('hex');
        if (hint !== clientHint) return false;
        return clientKeypair.verify(txHash, Buffer.from(sig.signature as any));
      } catch {
        return false;
      }
    });
    if (!clientVerified) {
      throw new UnauthorizedException(
        'Transaction must be signed by the client wallet',
      );
    }

    // Clean up stored challenge from Redis (single-use challenge consumed)
    try {
      await redis.del(challengeKey);
    } catch (err: any) {
      this.loggerWarn('Failed to delete consumed SEP-10 challenge from Redis', err);
    }

    // Find or create user by wallet address
    let user = await this.userRepo.findOne({
      where: { walletAddress: clientPublicKey },
    });
    if (!user) {
      // Auto-register with wallet
      user = this.userRepo.create({
        email: `${clientPublicKey.slice(0, 8)}@stellar.agri-fi.com`,
        passwordHash: '',
        role: 'investor',
        country: 'XX',
        kycStatus: 'pending',
        walletAddress: clientPublicKey,
      });
      user = await this.userRepo.save(user);
    }

    // Issue JWT
    const { accessToken, refreshToken } = this.tokenService.issueTokenPair(user);

    return { accessToken, refreshToken, publicKey: clientPublicKey };
  }
}
