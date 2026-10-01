import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KycCustomerType,
  KycJurisdictionRule,
} from './entities/kyc-jurisdiction-rule.entity';
import {
  CreateKycJurisdictionRuleDto,
  UpdateKycJurisdictionRuleDto,
  ValidateKycSubmissionDto,
} from './dto/kyc-jurisdiction-rule.dto';
import { AuditService } from '../audit/audit.service';

export interface KycValidationResult {
  valid: boolean;
  ruleId: string | null;
  ruleVersion: number | null;
  errors: string[];
  requiredDocuments: string[];
  acceptedIdTypes: string[];
}

export interface KycFormMetadata {
  countryCode: string;
  customerType: KycCustomerType;
  requiredDocuments: string[];
  acceptedIdTypes: string[];
  idNumberPattern: string | null;
  requiresProofOfAddress: boolean;
  requiresSelfie: boolean;
  documentExpiryRequired: boolean;
  maxDocumentAgeDays: number | null;
  ruleVersion: number;
}

/**
 * Country-level KYC rules matrix (#1019).
 * Resolves jurisdiction rules, validates submissions, and supports admin CRUD
 * with immutable audit trail entries.
 */
@Injectable()
export class KycRulesService {
  constructor(
    @InjectRepository(KycJurisdictionRule)
    private readonly ruleRepo: Repository<KycJurisdictionRule>,
    private readonly auditService: AuditService,
  ) {}

  async getActiveRule(
    countryCode: string,
    customerType: KycCustomerType,
  ): Promise<KycJurisdictionRule | null> {
    const code = countryCode.trim().toUpperCase();
    return this.ruleRepo.findOne({
      where: { countryCode: code, customerType, isActive: true },
      order: { version: 'DESC' },
    });
  }

  async getFormMetadata(
    countryCode: string,
    customerType: KycCustomerType = KycCustomerType.INDIVIDUAL,
  ): Promise<KycFormMetadata> {
    const rule = await this.getActiveRule(countryCode, customerType);
    if (!rule) {
      throw new NotFoundException(
        `No active KYC rules for ${countryCode.toUpperCase()} (${customerType})`,
      );
    }

    return {
      countryCode: rule.countryCode,
      customerType: rule.customerType,
      requiredDocuments: rule.requiredDocuments,
      acceptedIdTypes: rule.acceptedIdTypes,
      idNumberPattern: rule.idNumberPattern,
      requiresProofOfAddress: rule.requiresProofOfAddress,
      requiresSelfie: rule.requiresSelfie,
      documentExpiryRequired: rule.documentExpiryRequired,
      maxDocumentAgeDays: rule.maxDocumentAgeDays,
      ruleVersion: rule.version,
    };
  }

  async validateSubmission(
    dto: ValidateKycSubmissionDto,
  ): Promise<KycValidationResult> {
    const rule = await this.getActiveRule(dto.countryCode, dto.customerType);
    if (!rule) {
      return {
        valid: false,
        ruleId: null,
        ruleVersion: null,
        errors: [
          `No active KYC jurisdiction rule for ${dto.countryCode} / ${dto.customerType}`,
        ],
        requiredDocuments: [],
        acceptedIdTypes: [],
      };
    }

    const errors: string[] = [];
    const present = new Set<string>();

    if (dto.hasGovernmentIdFront) present.add('government_id_front');
    if (dto.hasGovernmentIdBack) present.add('government_id_back');
    if (dto.hasProofOfAddress) present.add('proof_of_address');
    if (dto.hasSelfie) present.add('selfie');
    if (dto.hasBusinessLicense) present.add('business_license');
    if (dto.hasArticlesOfIncorporation)
      present.add('articles_of_incorporation');

    for (const doc of rule.requiredDocuments) {
      if (!present.has(doc)) {
        errors.push(`Missing required document: ${doc}`);
      }
    }

    if (
      dto.documentType &&
      rule.acceptedIdTypes.length > 0 &&
      !rule.acceptedIdTypes.includes(dto.documentType)
    ) {
      errors.push(
        `Document type "${dto.documentType}" is not accepted for ${rule.countryCode}. Accepted: ${rule.acceptedIdTypes.join(', ')}`,
      );
    }

    if (dto.idNumber && rule.idNumberPattern) {
      try {
        const re = new RegExp(rule.idNumberPattern);
        if (!re.test(dto.idNumber)) {
          errors.push(
            `ID number does not match required format for ${rule.countryCode}`,
          );
        }
      } catch {
        // Invalid pattern stored in DB — skip rather than crash
      }
    }

    if (rule.documentExpiryRequired && !dto.documentExpiresAt) {
      errors.push('Document expiry date is required for this jurisdiction');
    }

    if (dto.documentExpiresAt) {
      const expiry = new Date(dto.documentExpiresAt);
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        errors.push('Document expiry date must be a valid future date');
      }
    }

    return {
      valid: errors.length === 0,
      ruleId: rule.id,
      ruleVersion: rule.version,
      errors,
      requiredDocuments: rule.requiredDocuments,
      acceptedIdTypes: rule.acceptedIdTypes,
    };
  }

  /** Throws BadRequestException when validation fails. */
  async assertValidSubmission(dto: ValidateKycSubmissionDto): Promise<void> {
    const result = await this.validateSubmission(dto);
    if (!result.valid) {
      throw new BadRequestException({
        message: 'KYC submission does not meet jurisdiction requirements',
        errors: result.errors,
        ruleId: result.ruleId,
        ruleVersion: result.ruleVersion,
      });
    }
  }

  async list(filters?: {
    countryCode?: string;
    customerType?: KycCustomerType;
    activeOnly?: boolean;
  }): Promise<KycJurisdictionRule[]> {
    const qb = this.ruleRepo.createQueryBuilder('rule');
    if (filters?.countryCode) {
      qb.andWhere('rule.country_code = :code', {
        code: filters.countryCode.toUpperCase(),
      });
    }
    if (filters?.customerType) {
      qb.andWhere('rule.customer_type = :type', {
        type: filters.customerType,
      });
    }
    if (filters?.activeOnly !== false) {
      qb.andWhere('rule.is_active = true');
    }
    qb.orderBy('rule.country_code', 'ASC')
      .addOrderBy('rule.customer_type', 'ASC')
      .addOrderBy('rule.version', 'DESC');
    return qb.getMany();
  }

  async getMatrix(): Promise<
    Record<string, Partial<Record<KycCustomerType, KycJurisdictionRule>>>
  > {
    const rules = await this.list({ activeOnly: true });
    const matrix: Record<
      string,
      Partial<Record<KycCustomerType, KycJurisdictionRule>>
    > = {};
    for (const rule of rules) {
      if (!matrix[rule.countryCode]) matrix[rule.countryCode] = {};
      // Keep highest version only (list is DESC by version)
      if (!matrix[rule.countryCode][rule.customerType]) {
        matrix[rule.countryCode][rule.customerType] = rule;
      }
    }
    return matrix;
  }

  async create(
    dto: CreateKycJurisdictionRuleDto,
    actorId?: string,
  ): Promise<KycJurisdictionRule> {
    const countryCode = dto.countryCode.toUpperCase();
    const latest = await this.ruleRepo.findOne({
      where: { countryCode, customerType: dto.customerType },
      order: { version: 'DESC' },
    });

    if (latest?.isActive) {
      // Deactivate previous active version before creating a new one
      latest.isActive = false;
      await this.ruleRepo.save(latest);
    }

    const version = (latest?.version ?? 0) + 1;
    const rule = this.ruleRepo.create({
      countryCode,
      customerType: dto.customerType,
      requiredDocuments: dto.requiredDocuments as any,
      acceptedIdTypes: dto.acceptedIdTypes,
      idNumberPattern: dto.idNumberPattern ?? null,
      requiresProofOfAddress: dto.requiresProofOfAddress ?? true,
      requiresSelfie: dto.requiresSelfie ?? true,
      maxDocumentAgeDays: dto.maxDocumentAgeDays ?? null,
      documentExpiryRequired: dto.documentExpiryRequired ?? true,
      isActive: true,
      version,
      changeReason: dto.changeReason,
      createdBy: actorId ?? null,
      updatedBy: actorId ?? null,
    });

    const saved = await this.ruleRepo.save(rule);
    await this.auditService.logEvent({
      actorId: actorId ?? null,
      actorRole: 'admin',
      route: 'POST /admin/kyc-rules',
      statusCode: 201,
      requestDetails: {
        action: 'create_kyc_jurisdiction_rule',
        countryCode,
        customerType: dto.customerType,
        version,
        changeReason: dto.changeReason,
        newValue: saved,
      },
    });
    return saved;
  }

  async update(
    id: string,
    dto: UpdateKycJurisdictionRuleDto,
    actorId?: string,
  ): Promise<KycJurisdictionRule> {
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('KYC jurisdiction rule not found');

    if (!dto.changeReason) {
      throw new BadRequestException('changeReason is required for updates');
    }

    const oldValue = { ...rule };

    if (dto.requiredDocuments !== undefined)
      rule.requiredDocuments = dto.requiredDocuments as any;
    if (dto.acceptedIdTypes !== undefined)
      rule.acceptedIdTypes = dto.acceptedIdTypes;
    if (dto.idNumberPattern !== undefined)
      rule.idNumberPattern = dto.idNumberPattern;
    if (dto.requiresProofOfAddress !== undefined)
      rule.requiresProofOfAddress = dto.requiresProofOfAddress;
    if (dto.requiresSelfie !== undefined)
      rule.requiresSelfie = dto.requiresSelfie;
    if (dto.maxDocumentAgeDays !== undefined)
      rule.maxDocumentAgeDays = dto.maxDocumentAgeDays;
    if (dto.documentExpiryRequired !== undefined)
      rule.documentExpiryRequired = dto.documentExpiryRequired;
    if (dto.isActive !== undefined) rule.isActive = dto.isActive;
    rule.changeReason = dto.changeReason;
    rule.updatedBy = actorId ?? null;

    const saved = await this.ruleRepo.save(rule);
    await this.auditService.logEvent({
      actorId: actorId ?? null,
      actorRole: 'admin',
      route: `PATCH /admin/kyc-rules/${id}`,
      statusCode: 200,
      requestDetails: {
        action: 'update_kyc_jurisdiction_rule',
        ruleId: id,
        changeReason: dto.changeReason,
        oldValue,
        newValue: saved,
      },
    });
    return saved;
  }

  async deactivate(id: string, reason: string, actorId?: string) {
    if (!reason?.trim()) {
      throw new BadRequestException('changeReason is required');
    }
    const rule = await this.ruleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('KYC jurisdiction rule not found');
    if (!rule.isActive) {
      throw new ConflictException('Rule is already inactive');
    }

    const oldValue = { ...rule };
    rule.isActive = false;
    rule.changeReason = reason;
    rule.updatedBy = actorId ?? null;
    const saved = await this.ruleRepo.save(rule);

    await this.auditService.logEvent({
      actorId: actorId ?? null,
      actorRole: 'admin',
      route: `DELETE /admin/kyc-rules/${id}`,
      statusCode: 200,
      requestDetails: {
        action: 'deactivate_kyc_jurisdiction_rule',
        ruleId: id,
        changeReason: reason,
        oldValue,
        newValue: saved,
      },
    });
    return saved;
  }
}
