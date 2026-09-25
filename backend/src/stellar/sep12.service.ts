import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
    line1?: string;
  };
  id_type?: string;
  id_number?: string;
  id_country_code?: string;
  birth_date?: string;

  // Internal platform field names (#837) — mapped to SEP-12 equivalents.
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationalIdNumber?: string;
  nationalIdType?: string;
  addressLine1?: string;
  countryCode?: string;
}

export interface Sep12CustomerResponse {
  id: string;
  status: 'ACCEPTED' | 'PROCESSING' | 'VERIFIED' | 'REJECTED';
  first_name?: string;
  last_name?: string;
  email_address?: string;
  mobile_number?: string;
  birth_date?: string;
  address?: {
    city?: string;
    country_code?: string;
    line1?: string;
  };
  id_type?: string;
  id_number?: string;
  id_country_code?: string;
}

/** Internal KYC fields as captured by the platform forms (#837). */
export interface InternalKycFields {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  nationalIdNumber?: string;
  nationalIdType?: string;
  addressLine1?: string;
  countryCode?: string;
}

/**
 * Maps internal KYC field names to the standardised Stellar SEP-12
 * customer schema (#837).
 */
export function mapInternalKycToSep12(
  fields: InternalKycFields,
): Sep12PutCustomerRequest {
  const mapped: Sep12PutCustomerRequest = {};
  if (fields.firstName !== undefined) mapped.first_name = fields.firstName;
  if (fields.lastName !== undefined) mapped.last_name = fields.lastName;
  if (fields.dateOfBirth !== undefined) mapped.birth_date = fields.dateOfBirth;
  if (fields.nationalIdNumber !== undefined)
    mapped.id_number = fields.nationalIdNumber;
  if (fields.nationalIdType !== undefined)
    mapped.id_type = fields.nationalIdType;
  if (fields.addressLine1 !== undefined || fields.countryCode !== undefined) {
    mapped.address = {
      ...(fields.addressLine1 !== undefined
        ? { line1: fields.addressLine1 }
        : {}),
      ...(fields.countryCode !== undefined
        ? { country_code: fields.countryCode }
        : {}),
    };
  }
  return mapped;
}

const ISO_8601_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_3166_ALPHA2_PATTERN = /^[A-Za-z]{2}$/;

export function assertIso8601Date(value: string, field: string): void {
  if (!ISO_8601_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new BadRequestException({
      code: 'INVALID_DATE_FORMAT',
      message: `"${field}" must be an ISO 8601 date (YYYY-MM-DD).`,
    });
  }
}

export function assertIso3166Alpha2(value: string, field: string): void {
  if (!ISO_3166_ALPHA2_PATTERN.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_COUNTRY_CODE',
      message: `"${field}" must be an ISO 3166-1 alpha-2 country code.`,
    });
  }
}

/**
 * Merges internal-format aliases into their SEP-12 counterparts and
 * validates the SEP-12 field types (#837).
 */
export function normalizeSep12Fields(
  fields: Sep12PutCustomerRequest,
): Sep12PutCustomerRequest {
  const internal = mapInternalKycToSep12({
    firstName: fields.firstName,
    lastName: fields.lastName,
    dateOfBirth: fields.dateOfBirth,
    nationalIdNumber: fields.nationalIdNumber,
    nationalIdType: fields.nationalIdType,
    addressLine1: fields.addressLine1,
    countryCode: fields.countryCode,
  });

  const INTERNAL_KEYS = [
    'firstName',
    'lastName',
    'dateOfBirth',
    'nationalIdNumber',
    'nationalIdType',
    'addressLine1',
    'countryCode',
  ];

  const explicit = Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) => !INTERNAL_KEYS.includes(key) && value !== undefined,
    ),
  ) as Sep12PutCustomerRequest;

  const normalized: Sep12PutCustomerRequest = {
    ...internal,
    ...explicit,
    address: { ...internal.address, ...explicit.address },
  };

  if (normalized.birth_date !== undefined) {
    assertIso8601Date(normalized.birth_date, 'birth_date');
  }
  if (normalized.address?.country_code !== undefined) {
    assertIso3166Alpha2(
      normalized.address.country_code,
      'address.country_code',
    );
  }
  if (normalized.id_country_code !== undefined) {
    assertIso3166Alpha2(normalized.id_country_code, 'id_country_code');
  }

  return normalized;
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

    const sep12Fields = normalizeSep12Fields(fields);

    if (sep12Fields.first_name || sep12Fields.last_name) {
      user.fullName = [sep12Fields.first_name, sep12Fields.last_name]
        .filter(Boolean)
        .join(' ');
    }
    if (sep12Fields.birth_date) {
      user.birthdate = sep12Fields.birth_date;
    }
    if (sep12Fields.address?.line1) {
      user.physicalAddress = sep12Fields.address.line1;
    }
    if (sep12Fields.address?.country_code) {
      user.country = sep12Fields.address.country_code.toUpperCase();
    }
    if (sep12Fields.id_number) {
      user.taxId = sep12Fields.id_number;
    }

    await this.userRepo.save(user);

    const isAutoApprove =
      this.config.get<string>('KYC_AUTO_APPROVE') === 'true';

    const submission = this.kycRepo.create({
      userId,
      governmentIdUrl: sep12Fields.id_type
        ? `sep12:${sep12Fields.id_type}`
        : undefined,
      status: isAutoApprove ? 'approved' : 'pending_review',
      // Store both the internal user-field updates and the SEP-12 payload (#837)
      sep12Data: sep12Fields as Record<string, unknown>,
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
    const latestSubmission = await this.kycRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    const stored = (latestSubmission?.sep12Data ??
      {}) as Partial<Sep12CustomerResponse>;

    return {
      id: user.id,
      status: KYC_STATUS_MAP[user.kycStatus] ?? 'PROCESSING',
      first_name: stored.first_name ?? (nameParts[0] || undefined),
      last_name:
        (stored.last_name ?? nameParts.slice(1).join(' ')) || undefined,
      email_address: user.email,
      birth_date: stored.birth_date ?? user.birthdate ?? undefined,
      address: {
        city: stored.address?.city,
        country_code: stored.address?.country_code ?? user.country ?? undefined,
        line1: stored.address?.line1 ?? user.physicalAddress ?? undefined,
      },
      id_type: stored.id_type,
      id_number: stored.id_number ?? user.taxId ?? undefined,
      id_country_code: stored.id_country_code,
    };
  }

  /**
   * Fetch a SEP-12 customer by id (#837). Admins can view any customer;
   * other callers may only view themselves.
   */
  async getCustomerById(
    requester: User,
    customerId: string,
  ): Promise<Sep12CustomerResponse> {
    if (requester.role !== 'admin' && requester.id !== customerId) {
      throw new ForbiddenException({
        code: 'SEP12_CUSTOMER_FORBIDDEN',
        message: 'Only admins can view other customers.',
      });
    }
    return this.getCustomer(customerId);
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
