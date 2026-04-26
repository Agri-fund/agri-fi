import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { KycDto } from './dto/kyc.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(KycSubmission)
    private readonly kycRepo: Repository<KycSubmission>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = this.userRepo.create({
      email: dto.email,
      passwordHash,
      role: dto.role,
      country: dto.country,
      kycStatus: 'pending',
    });

    const saved = await this.userRepo.save(user);
    return {
      id: saved.id,
      email: saved.email,
      role: saved.role,
      kycStatus: saved.kycStatus,
    };
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.userRepo.findOne({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials.');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials.');

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion ?? 0,
    });
    return { accessToken: token };
  }

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
}
