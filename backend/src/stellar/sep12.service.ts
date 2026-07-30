import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';

export interface Sep12PutCustomerRequest {
  id?: string;
  first_name?: string;
  last_name?: string;
  email_address?: string;
  mobile_number?: string;
  address?: {
    city?: string;
    country_code?: string;
  };
  id_type?: string;
  id_number?: string;
  id_country_code?: string;
}

export interface Sep12CustomerResponse {
  id: string;
  status: 'ACCEPTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
  first_name?: string;
  last_name?: string;
  email_address?: string;
  mobile_number?: string;
  address?: {
    city?: string;
    country_code?: string;
  };
  id_type?: string;
  id_number?: string;
  id_country_code?: string;
}

const KYC_STATUS_MAP: Record<
  string,
  'ACCEPTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED'
> = {
  pending: 'PROCESSING',
  verified: 'VERIFIED',
  rejected: 'REJECTED',
};

@Injectable()
export class Sep12Service {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(KycSubmission)
    private readonly kycRepo: Repository<KycSubmission>,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(Sep12Service.name);
  }

  async putCustomer(
    userId: string,
    fields: Sep12PutCustomerRequest,
  ): Promise<{ id: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    if (fields.first_name || fields.last_name) {
      user.fullName = [fields.first_name, fields.last_name]
        .filter(Boolean)
        .join(' ');
    }
    if (fields.address?.country_code) {
      user.country = fields.address.country_code;
    }
    if (fields.id_number) {
      user.taxId = fields.id_number;
    }

    await this.userRepo.save(user);

    const isAutoApprove =
      this.config.get<string>('KYC_AUTO_APPROVE') === 'true';

    const submission = this.kycRepo.create({
      userId,
      governmentIdUrl: fields.id_type ? `sep12:${fields.id_type}` : undefined,
      status: isAutoApprove ? 'approved' : 'pending_review',
    });
    await this.kycRepo.save(submission);

    if (isAutoApprove) {
      user.kycStatus = 'verified';
      await this.userRepo.save(user);
    }

    this.logger.info(
      { userId, status: user.kycStatus, autoApproved: isAutoApprove },
      'SEP-12 customer record updated',
    );

    return { id: userId };
  }

  async getCustomer(userId: string): Promise<Sep12CustomerResponse> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found.');
    }

    const nameParts = (user.fullName ?? '').split(' ');

    return {
      id: user.id,
      status: KYC_STATUS_MAP[user.kycStatus] ?? 'PROCESSING',
      first_name: nameParts[0] || undefined,
      last_name: nameParts.slice(1).join(' ') || undefined,
      email_address: user.email,
      address: {
        country_code: user.country,
      },
      id_number: user.taxId ?? undefined,
    };
  }

  assertCustomerApproved(user: User): void {
    if (user.kycStatus !== 'verified') {
      throw new ForbiddenException({
        code: 'SEP12_CUSTOMER_NOT_APPROVED',
        message: `Customer KYC status is "${user.kycStatus}", expected "VERIFIED". Complete SEP-12 KYC before making transfers.`,
      });
    }
  }
}
