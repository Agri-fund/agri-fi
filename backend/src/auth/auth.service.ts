import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { KycDto } from './dto/kyc.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JwtPayload } from './jwt.strategy';

const LOCKOUT_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(KycSubmission)
    private readonly kycRepo: Repository<KycSubmission>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────────────

  private isBcryptHash(hash: string): boolean {
    return hash.startsWith('$2b$') || hash.startsWith('$2a$');
  }

  private async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  private async verifyPassword(hash: string, password: string): Promise<boolean> {
    if (this.isBcryptHash(hash)) {
      return bcrypt.compare(password, hash);
    }
    return argon2.verify(hash, password);
  }

  private generateVerificationToken(): string {
    return randomBytes(32).toString('hex');
  }

  private appBaseUrl(): string {
    return this.configService.get<string>('APP_BASE_URL', 'http://localhost:3001');
  }

  private async sendVerificationEmail(email: string, token: string): Promise<void> {
    const link = `${this.appBaseUrl()}/auth/verify-email?token=${token}`;
    await this.notificationsService.sendEmail(
      email,
      'Verify your Agri-Fi email address',
      `Please verify your email by visiting: ${link}`,
      `<p>Click <a href="${link}">here</a> to verify your email address. This link is valid for 24 hours.</p>`,
    );
  }

  // ── register ───────────────────────────────────────────────────────────────

  async register(
    dto: RegisterDto,
  ): Promise<{ id: string; email: string; role: string; kycStatus: string }> {
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

    const saved = await this.userRepo.save(user);

    await this.sendVerificationEmail(saved.email, emailVerificationToken);

    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      kycStatus: saved.kycStatus,
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

  private issueTokenPair(user: User): {
    accessToken: string;
    refreshToken: string;
  } {
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
        { ...base, typ: 'refresh' },
        { expiresIn: this.refreshTokenExpiresIn() },
      ),
    };
  }

  // ── login ──────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials.');

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

      if (user.failedLoginAttempts >= LOCKOUT_MAX_ATTEMPTS) {
        user.lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
        user.failedLoginAttempts = 0;
        await this.userRepo.save(user);

        // Send lockout notification email
        const unlockAt = user.lockoutUntil.toUTCString();
        await this.notificationsService.sendEmail(
          user.email,
          'Your Agri-Fi account has been locked',
          `Your account has been temporarily locked due to 5 consecutive failed login attempts. It will unlock at ${unlockAt}.`,
          `<p>Your account has been temporarily locked due to 5 consecutive failed login attempts.</p><p>It will unlock automatically at <strong>${unlockAt}</strong>.</p><p>If this wasn't you, please reset your password immediately.</p>`,
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

    await this.userRepo.save(user);

    return this.issueTokenPair(user);
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

    return this.issueTokenPair(user);
  }

  // ── wallet ─────────────────────────────────────────────────────────────────

  async linkWallet(
    userId: string,
    walletAddress: string,
  ): Promise<{ walletAddress: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    user.walletAddress = walletAddress;
    await this.userRepo.save(user);
    return { walletAddress };
  }

  // ── KYC ───────────────────────────────────────────────────────────────────

  async submitKyc(userId: string, dto: KycDto): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const isAutoApprove =
      this.configService.get<string>('KYC_AUTO_APPROVE') === 'true';

    const automatedApproval = dto.isCorporate ? false : isAutoApprove;

    const submission = this.kycRepo.create({
      userId,
      governmentIdUrl: dto.governmentIdUrl,
      proofOfAddressUrl: dto.proofOfAddressUrl,
      isCorporate: dto.isCorporate ?? false,
      companyName: dto.companyName,
      registrationNumber: dto.registrationNumber,
      businessLicenseUrl: dto.businessLicenseUrl,
      articlesOfIncorporationUrl: dto.articlesOfIncorporationUrl,
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

  async approveCorporateKycSubmission(
    submissionId: string,
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

    return { kycStatus: user.kycStatus };
  }

  async approveKyc(userId: string): Promise<{ kycStatus: string }> {
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
  ): Promise<{ id: string; role: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    user.role = role;
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    const saved = await this.userRepo.save(user);
    return { id: saved.id, role: saved.role };
  }

  // ── password ───────────────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const valid = await this.verifyPassword(user.passwordHash, dto.currentPassword);
    if (!valid) throw new BadRequestException('Current password is incorrect.');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current password.',
      );
    }

    user.passwordHash = await this.hashPassword(dto.newPassword);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);

    return { message: 'Password updated. All active sessions have been invalidated.' };
  }

  async logout(userId: string): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await this.userRepo.save(user);
    return { message: 'Logged out successfully.' };
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
}
