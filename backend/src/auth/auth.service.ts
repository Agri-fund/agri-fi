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
import { KycDto } from './dto/kyc.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueueService } from '../queue/queue.service';
import { JwtPayload } from './jwt.strategy';
import { sanitizeRedirectUrl } from './utils/redirect-sanitizer';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';

@Injectable()
export class AuthService {
  private readonly sep10SigningKeypair: Keypair;
  private readonly networkPassphrase: string;
  private readonly challenges: Map<string, { nonce: string; expiresAt: number }>;
  private readonly sep10Domain: string;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(KycSubmission)
    private readonly kycRepo: Repository<KycSubmission>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly queueService: QueueService,
    private readonly ofacSanctionsCheck: OfacSanctionsCheckService,
  ) {
    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const sep10Secret = this.configService.get<string>('SEP10_SIGNING_SECRET', '');
    this.sep10SigningKeypair = sep10Secret
      ? Keypair.fromSecret(sep10Secret)
      : Keypair.random();

    this.challenges = new Map();
    this.sep10Domain =
      this.configService.get<string>('SEP10_DOMAIN', 'agri-fi.com');
  }

  async register(
    dto: RegisterDto,
  ): Promise<{
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

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      country: dto.country,
      kycStatus: 'pending',
    });

    const saved = await this.userRepo.save(user);
    const safeRedirect = sanitizeRedirectUrl(dto.redirect);
    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      kycStatus: saved.kycStatus,
      redirect: safeRedirect || undefined,
    };
  }

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
  ): Promise<{ accessToken: string; refreshToken: string; redirect?: string }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials.');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials.');

    const tokens = this.issueTokenPair(user);
    const safeRedirect = sanitizeRedirectUrl(dto.redirect);
    return {
      ...tokens,
      redirect: safeRedirect || undefined,
    };
  }

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

  async linkWallet(
    userId: string,
    walletAddress: string,
  ): Promise<{ walletAddress: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    // Check if the wallet address is sanctioned
    const isSanctioned = await this.ofacSanctionsCheck.isAddressSanctioned(
      walletAddress,
    );
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

  async submitKyc(userId: string, dto: KycDto): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const isAutoApprove =
      this.configService.get<string>('KYC_AUTO_APPROVE') === 'true';

    // Dev-only flag: allow auto-approving non-corporate submissions when explicitly enabled.
    // Corporate verification is always manual review.
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

    // Persist corporate metadata for review, but don't mark verified until admin approval.
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

    // Email notification would be triggered here
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

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Current password is incorrect.');

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must differ from the current password.',
      );
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
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
      throw new BadRequestException(
        'Invalid Stellar public key',
      );
    }

    const nonce = crypto.randomBytes(32).toString('hex');
    const manageDataKey = `${this.sep10Domain} SEP-10 Web Auth`;
    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 300; // 5 minutes

    const tx = new TransactionBuilder(
      { sequence: '0', accountId: () => this.sep10SigningKeypair.publicKey() } as any,
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
        const clientHint = clientKeypair
          .signatureHint()
          .toString('hex');
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
      {
        expiresIn:
          this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
          this.configService.get<string>('JWT_EXPIRES_IN', '7d'),
      },
    );
    const refreshToken = this.jwtService.sign(
      { ...base, typ: 'refresh' },
      { expiresIn: '7d' },
    );

    return { accessToken, refreshToken, publicKey: clientPublicKey };
  }
}
