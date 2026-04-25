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

  async submitKyc(
    userId: string,
    dto: KycDto,
  ): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const isAutoApprove =
      this.configService.get<string>('KYC_AUTO_APPROVE') === 'true';

    let automatedApproval = isAutoApprove;

    // Automated Corporate Verification
    if (dto.isCorporate && dto.registrationNumber && dto.companyName) {
      console.log(`Triggering automated business verification for ${dto.companyName}...`);
      const isVerified = await this.verifyCorporateBusiness(
        dto.companyName,
        dto.registrationNumber,
      );
      if (isVerified) {
        console.log('Business verification SUCCESS.');
        automatedApproval = true;
      } else {
        console.warn('Business verification FAILED or returned inconclusive results.');
      }
    }

    const submission = this.kycRepo.create({
      userId,
      governmentIdUrl: dto.governmentIdUrl,
      proofOfAddressUrl: dto.proofOfAddressUrl,
      isCorporate: dto.isCorporate ?? false,
      companyName: dto.companyName,
      registrationNumber: dto.registrationNumber,
      businessLicenseUrl: dto.businessLicenseUrl,
      status: automatedApproval ? 'approved' : 'pending_review',
    });

    await this.kycRepo.save(submission);

    if (automatedApproval) {
      user.kycStatus = 'verified';
      await this.userRepo.save(user);
      console.log(`KYC auto-verified for user ${user.email} (Method: ${dto.isCorporate ? 'Automated Corporate' : 'System Config'}).`);
    } else {
      console.log(`KYC submission pending review for user ${user.email}.`);
    }

    return { kycStatus: user.kycStatus };
  }

  /**
   * Mock automated corporate verification.
   * In production, this would call an external API like Middesk, GDC, or a business registry.
   */
  private async verifyCorporateBusiness(
    companyName: string,
    regNumber: string,
  ): Promise<boolean> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Logic: Approved if regNumber starts with 'REG' or '123'
    // This is a placeholder for actual registry logic
    const isValid = regNumber.startsWith('REG') || regNumber.startsWith('123');
    return isValid;
  }

  async approveKyc(userId: string): Promise<{ kycStatus: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    const submission = await this.kycRepo.findOne({
      where: { userId, status: 'pending_review' },
      order: { createdAt: 'DESC' },
    });

    if (!submission) {
      throw new NotFoundException('No pending KYC submission found for this user.');
    }

    submission.status = 'approved';
    await this.kycRepo.save(submission);

    user.kycStatus = 'verified';
    await this.userRepo.save(user);

    // Email notification would be triggered here
    console.log(`KYC manually verified for user ${user.email} — notification queued.`);

    return { kycStatus: user.kycStatus };
  }
}
