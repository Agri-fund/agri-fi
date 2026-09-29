import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { KycRulesService } from './kyc-rules.service';
import {
  KycCustomerType,
  KycJurisdictionRule,
} from './entities/kyc-jurisdiction-rule.entity';
import { AuditService } from '../audit/audit.service';

describe('KycRulesService (#1019 matrix validation)', () => {
  let service: KycRulesService;
  let ruleRepo: Record<string, jest.Mock>;
  let auditService: { logEvent: jest.Mock };

  const ngIndividual: KycJurisdictionRule = {
    id: 'rule-ng-1',
    countryCode: 'NG',
    customerType: KycCustomerType.INDIVIDUAL,
    requiredDocuments: [
      'government_id_front',
      'government_id_back',
      'proof_of_address',
      'selfie',
    ],
    acceptedIdTypes: ['national_id', 'passport', 'drivers_license'],
    idNumberPattern: '^[A-Z0-9]{6,20}$',
    requiresProofOfAddress: true,
    requiresSelfie: true,
    maxDocumentAgeDays: null,
    documentExpiryRequired: true,
    isActive: true,
    version: 1,
    changeReason: 'seed',
    createdBy: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const ngCorporate: KycJurisdictionRule = {
    ...ngIndividual,
    id: 'rule-ng-corp',
    customerType: KycCustomerType.CORPORATE,
    requiredDocuments: [
      'business_license',
      'articles_of_incorporation',
      'proof_of_address',
    ],
    acceptedIdTypes: ['cac_registration'],
    idNumberPattern: '^RC[0-9]{5,10}$',
    requiresSelfie: false,
  };

  beforeEach(async () => {
    ruleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'new-id', ...v })),
      createQueryBuilder: jest.fn(),
    };
    auditService = { logEvent: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycRulesService,
        { provide: getRepositoryToken(KycJurisdictionRule), useValue: ruleRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get(KycRulesService);
  });

  describe('validateSubmission', () => {
    it('accepts a complete individual NG submission', async () => {
      ruleRepo.findOne.mockResolvedValue(ngIndividual);

      const result = await service.validateSubmission({
        countryCode: 'NG',
        customerType: KycCustomerType.INDIVIDUAL,
        documentType: 'passport',
        idNumber: 'A1234567',
        documentExpiresAt: '2030-01-01',
        hasGovernmentIdFront: true,
        hasGovernmentIdBack: true,
        hasProofOfAddress: true,
        hasSelfie: true,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.ruleId).toBe('rule-ng-1');
    });

    it('rejects missing required documents', async () => {
      ruleRepo.findOne.mockResolvedValue(ngIndividual);

      const result = await service.validateSubmission({
        countryCode: 'NG',
        customerType: KycCustomerType.INDIVIDUAL,
        hasGovernmentIdFront: true,
        // missing back, poa, selfie
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          'Missing required document: government_id_back',
          'Missing required document: proof_of_address',
          'Missing required document: selfie',
          'Document expiry date is required for this jurisdiction',
        ]),
      );
    });

    it('rejects unsupported document types for the jurisdiction', async () => {
      ruleRepo.findOne.mockResolvedValue(ngIndividual);

      const result = await service.validateSubmission({
        countryCode: 'NG',
        customerType: KycCustomerType.INDIVIDUAL,
        documentType: 'military_id',
        documentExpiresAt: '2030-01-01',
        hasGovernmentIdFront: true,
        hasGovernmentIdBack: true,
        hasProofOfAddress: true,
        hasSelfie: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('military_id'))).toBe(true);
    });

    it('rejects ID numbers that fail the jurisdiction pattern', async () => {
      ruleRepo.findOne.mockResolvedValue(ngIndividual);

      const result = await service.validateSubmission({
        countryCode: 'NG',
        customerType: KycCustomerType.INDIVIDUAL,
        documentType: 'passport',
        idNumber: '!!!',
        documentExpiresAt: '2030-01-01',
        hasGovernmentIdFront: true,
        hasGovernmentIdBack: true,
        hasProofOfAddress: true,
        hasSelfie: true,
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('ID number does not match')),
      ).toBe(true);
    });

    it('enforces corporate document set for NG corporate', async () => {
      ruleRepo.findOne.mockResolvedValue(ngCorporate);

      const result = await service.validateSubmission({
        countryCode: 'NG',
        customerType: KycCustomerType.CORPORATE,
        documentType: 'cac_registration',
        idNumber: 'RC123456',
        documentExpiresAt: '2030-01-01',
        hasBusinessLicense: true,
        hasArticlesOfIncorporation: true,
        hasProofOfAddress: true,
      });

      expect(result.valid).toBe(true);
    });

    it('assertValidSubmission throws BadRequestException on failure', async () => {
      ruleRepo.findOne.mockResolvedValue(null);

      await expect(
        service.assertValidSubmission({
          countryCode: 'ZZ',
          customerType: KycCustomerType.INDIVIDUAL,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create', () => {
    it('versions a new rule and audits the change', async () => {
      ruleRepo.findOne.mockResolvedValue({ ...ngIndividual, version: 1 });

      const created = await service.create(
        {
          countryCode: 'NG',
          customerType: KycCustomerType.INDIVIDUAL,
          requiredDocuments: ['government_id_front', 'selfie'],
          acceptedIdTypes: ['passport'],
          changeReason: 'Simplify NG individual requirements',
        },
        'admin-1',
      );

      expect(ruleRepo.save).toHaveBeenCalled();
      expect(created.version).toBe(2);
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          requestDetails: expect.objectContaining({
            action: 'create_kyc_jurisdiction_rule',
          }),
        }),
      );
    });
  });
});
