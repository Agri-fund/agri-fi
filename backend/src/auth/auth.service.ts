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
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
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
import { SecurityThreatService } from './security-threat.service';
import { EmailSequenceService } from '../email-sequence/email-sequence.service';

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
export class AuthService {
  private readonly sep10SigningKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly challenges: Map<
    string,
    { nonce: string; expiresAt: number }
  >;
  private readonly sep10Domain: string;

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
    private readonly ofacSanctionsCheck: OfacSanctionsCheckService,
    private readonly tokenBlocklistService: TokenBlocklistService,
    private readonly securityThreat: SecurityThreatService,
    @Optional() private readonly emailSequenceService: EmailSequenceService,
    @Optional() private readonly auditService: AuditService,
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

    this.challenges = new Map();
    this.sep10Domain = this.configService.get<string>(
      'SEP10_DOMAIN',
      'agri-fi.com',
    );
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

  // ── token pair ─────────────────────────────────────────────────────────────

  private accessTokenExpiresIn(): string {
    return (
      this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      this.configService.get<string>('JWT_EXPIRES_IN', '7d')
    );
  }

  private refreshTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
  }

  /** Parses a JWT-style duration ('15m', '7d', '3600s', or a bare number of seconds). */
  private durationToSeconds(value: string): number {
    const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
    if (!match) return 0;
    const amount = parseInt(match[1], 10);
    const unit = (match[2] ?? 's').toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return amount * multipliers[unit];
  }

  /**
   * Issues a fresh access/refresh token pair. Every refresh token gets a new
   * unique jti; `familyId` is preserved across a rotation chain (or started
   * fresh on login) so replay of a rotated-out token can be detected (#786).
   */
  private issueTokenPair(
    user: User,
    familyId: string = randomUUID(),
  ): { accessToken: string; refreshToken: string } {
    const base: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    };

    return {
      accessToken: this.jwtService.sign(
        { ...base, typ: 'access' },
        { expiresIn: this.accessTokenExpiresIn() },
      ),
      refreshToken: this.jwtService.sign(
        { ...base, typ: 'refresh', jti: randomUUID(), familyId },
        // Sliding expiry: every rotation is granted a full fresh TTL.
        { expiresIn: this.refreshTokenExpiresIn() },
      ),
    };
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
    await this.userRepo.save(user);

    return { message: 'All sessions have been revoked. Please log in again.' };
  }

  private async findUserByRevokeToken(
    revokeToken: string,
  ): Promise<string | null> {
    try {
      const log = await this.loginLogRepo
        .createQueryBuilder('log')
        .innerJoin(
          (qb) => {
            qb.select('user_id')
              .from('login_logs', 'll')
              .orderBy('created_at', 'DESC')
              .limit(1);
          },
          'latest',
          'latest.user_id = log.user_id',
        )
        .where(`log.user_agent LIKE :token`, {
          token: `%revoke:${revokeToken}%`,
        })
        .getOne();
      return log?.userId ?? null;
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
          await this.tokenBlocklistService.revokeTokenFamily(
            familyId,
            this.durationToSeconds(this.refreshTokenExpiresIn()),
          );
        }
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        await this.userRepo.save(user);
        throw new UnauthorizedException(
          'Refresh token reuse detected. All sessions have been revoked.',
        );
      }

      const remainingSeconds =
        (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
      await this.tokenBlocklistService.markRefreshTokenRotated(
        jti,
        Math.max(remainingSeconds, 1),
      );
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
      try {
        const decoded: any = this.jwtService.decode(token);
        if (decoded && typeof decoded.exp === 'number') {
          const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
          if (remainingSeconds > 0) {
            await this.tokenBlocklistService.blocklistToken(token, remainingSeconds);
          }
        }
      } catch {
        // ignore decode errors — still proceed to invalidate sessions
      }
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

  // ── admin ──────────────────────────────────────────────────────────────────

  async updateUserRole(
    userId: string,
    role: User['role'],
    adminId?: string,
    reason?: string,
  ): Promise<{ id: string; role: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const previousRole = user.role;
    user.role = role;
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



  // ── account unlock ────────────────────────────────────────────────────────

  /**
   * Generates a signed JWT unlock token with 15-minute expiry.
   * Token contains userId and is used in the unlock link sent via email.
   */
  private generateUnlockToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, typ: 'account_unlock' },
      { expiresIn: '15m' } as any,
    );
  }

  /**
   * Validates an unlock token and resets the account lockout.
   * Logs the unlock attempt to login_logs table.
   */
  async unlockAccount(
    token: string,
    meta?: LoginMeta,
  ): Promise<{ message: string }> {
    let payload: any;
    try {
      payload = this.jwtService.verify(token) as any;
    } catch (err) {
      throw new BadRequestException({ code: 'INVALID_UNLOCK_TOKEN', message: 'Invalid unlock token.' });
    }

    if (!payload || payload.typ !== 'account_unlock' || !payload.sub) {
      throw new BadRequestException({ code: 'INVALID_UNLOCK_TOKEN', message: 'Invalid unlock token.' });
    }

    const userId = payload.sub as string;
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
   */
  async generateSep10Challenge(
    clientPublicKey: string,
  ): Promise<{ transactionXdr: string; networkPassphrase: string }> {
    if (!clientPublicKey || !clientPublicKey.startsWith('G')) {
      throw new BadRequestException('Invalid Stellar public key');
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
      .setTimeout(300)
      .build();

    tx.sign(this.sep10SigningKeypair);

    // Store challenge for later validation
    this.challenges.set(clientPublicKey, { nonce, expiresAt: expiry });

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

    // Verify client signature
    const txHash = tx.hash();
    const clientVerified = tx.signatures.some((sig) => {
      try {
        const hint = sig.hint.toString('hex');
        const clientKeypair = Keypair.fromPublicKey(clientPublicKey);
        const clientHint = clientKeypair.signatureHint().toString('hex');
        if (hint !== clientHint) return false;
        return clientKeypair.verify(txHash, sig.signature);
      } catch {
        return false;
      }
    });
    if (!clientVerified) {
      throw new UnauthorizedException(
        'Transaction must be signed by the client wallet',
      );
    }

    // Clean up stored challenge
    this.challenges.delete(clientPublicKey);

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
    const base: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    };

    const accessToken = this.jwtService.sign(
      { ...base, typ: 'access' },
      { expiresIn: this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? this.configService.get<string>('JWT_EXPIRES_IN', '7d') } as any,
    );
    const refreshToken = this.jwtService.sign(
      { ...base, typ: 'refresh' },
      { expiresIn: '7d' } as any,
    );

    return { accessToken, refreshToken, publicKey: clientPublicKey };
  }
}
