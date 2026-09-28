import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import type { AccreditationTier, AccreditationStatus } from '../auth/entities/user.entity';

export interface SelfCertificationDto {
  /** The investor's signed declaration text. */
  declaration: string;
  /** Optional URL of a supporting document (e.g. broker letter, net-worth statement). */
  documentUrl?: string;
  /** Target tier: 'accredited' or 'institutional'. */
  targetTier: 'accredited' | 'institutional';
}

export interface AccreditationReviewDto {
  approved: boolean;
  rejectionReason?: string;
}

/** Two-year TTL for accreditation approvals. */
const ACCREDITATION_TTL_YEARS = 2;

@Injectable()
export class AccreditationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Submit a self-certification accreditation application.
   * Investors can apply for 'accredited' or 'institutional' tier.
   * Institutional applications go to an admin review queue.
   * Accredited applications are auto-approved on self-certification.
   */
  async submitSelfCertification(
    userId: string,
    dto: SelfCertificationDto,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.role !== 'investor') {
      throw new ForbiddenException({
        code: 'NOT_INVESTOR',
        message: 'Only investors can apply for accreditation.',
      });
    }

    if (user.accreditationStatus === 'pending') {
      throw new ConflictException({
        code: 'APPLICATION_PENDING',
        message: 'An accreditation application is already pending review.',
      });
    }

    if (
      user.accreditationStatus === 'approved' &&
      user.accreditationTier === dto.targetTier
    ) {
      throw new ConflictException({
        code: 'ALREADY_ACCREDITED',
        message: `You already have ${dto.targetTier} accreditation.`,
      });
    }

    if (!dto.declaration || dto.declaration.trim().length < 20) {
      throw new BadRequestException({
        code: 'DECLARATION_REQUIRED',
        message: 'A signed declaration of at least 20 characters is required.',
      });
    }

    const now = new Date();

    // Accredited tier: auto-approve on self-certification.
    // Institutional tier: place in pending queue for admin review.
    if (dto.targetTier === 'accredited') {
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + ACCREDITATION_TTL_YEARS);

      Object.assign(user, {
        accreditationTier: 'accredited' as AccreditationTier,
        accreditationStatus: 'approved' as AccreditationStatus,
        accreditationSubmittedAt: now,
        accreditationApprovedAt: now,
        accreditationExpiresAt: expiresAt,
        accreditationDeclaration: dto.declaration.trim(),
        accreditationDocumentUrl: dto.documentUrl ?? null,
        accreditationRejectionReason: null,
      });
    } else {
      // institutional — queue for admin review
      Object.assign(user, {
        accreditationTier: user.accreditationTier, // keep existing until approved
        accreditationStatus: 'pending' as AccreditationStatus,
        accreditationSubmittedAt: now,
        accreditationDeclaration: dto.declaration.trim(),
        accreditationDocumentUrl: dto.documentUrl ?? null,
        accreditationRejectionReason: null,
      });
    }

    return this.userRepo.save(user);
  }

  /**
   * Admin: approve or reject a pending accreditation application.
   */
  async reviewApplication(
    userId: string,
    dto: AccreditationReviewDto,
  ): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');

    if (user.accreditationStatus !== 'pending') {
      throw new BadRequestException({
        code: 'NOT_PENDING',
        message: 'This user does not have a pending accreditation application.',
      });
    }

    const now = new Date();

    if (dto.approved) {
      const expiresAt = new Date(now);
      expiresAt.setFullYear(expiresAt.getFullYear() + ACCREDITATION_TTL_YEARS);

      Object.assign(user, {
        accreditationTier: 'institutional' as AccreditationTier,
        accreditationStatus: 'approved' as AccreditationStatus,
        accreditationApprovedAt: now,
        accreditationExpiresAt: expiresAt,
        accreditationRejectionReason: null,
      });
    } else {
      Object.assign(user, {
        accreditationStatus: 'rejected' as AccreditationStatus,
        accreditationRejectionReason: dto.rejectionReason ?? null,
      });
    }

    return this.userRepo.save(user);
  }

  /**
   * Returns all users with a pending accreditation application (admin review queue).
   */
  async getPendingApplications(): Promise<User[]> {
    return this.userRepo.find({
      where: { accreditationStatus: 'pending' },
      order: { accreditationSubmittedAt: 'ASC' },
    });
  }

  /**
   * Get the accreditation status for a single user.
   */
  async getAccreditationStatus(userId: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  /**
   * Expire accreditations that have passed their expiry date.
   * Called by the cron job.
   */
  async expireStaleAccreditations(): Promise<number> {
    const now = new Date();

    const expiredUsers = await this.userRepo
      .createQueryBuilder('u')
      .where('u.accreditation_status = :status', { status: 'approved' })
      .andWhere('u.accreditation_expires_at <= :now', { now })
      .getMany();

    if (expiredUsers.length === 0) return 0;

    for (const user of expiredUsers) {
      user.accreditationStatus = 'expired';
      user.accreditationTier = 'retail'; // downgrade to retail on expiry
    }

    await this.userRepo.save(expiredUsers);
    return expiredUsers.length;
  }
}
