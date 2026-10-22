import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ZkpService } from './zkp.service';
import { ZkpCircuitService } from './zkp-circuit.service';
import { AuditService } from '../audit/audit.service';
import {
  ZkpProof,
  CredentialType,
  ProofStatus,
  ZkpStandard,
} from './entities/zkp-proof.entity';

describe('ZkpService', () => {
  let service: ZkpService;
  let proofRepo: any;
  let auditService: any;

  // Generate a real proof payload for test mocks
  const circuitServiceForMock = new ZkpCircuitService();
  const genResult = circuitServiceForMock.generateProof(
    CredentialType.CREDIT_SCORE,
    '750',
    { threshold: 600 },
  );

  const mockProof: Partial<ZkpProof> = {
    id: 'proof-1',
    ownerId: 'user-1',
    credentialType: CredentialType.CREDIT_SCORE,
    proofPayload: genResult.proofPayload,
    publicInputs: genResult.publicInputs,
    circuitId: genResult.circuitId,
    standard: ZkpStandard.GROTH16,
    status: ProofStatus.ACTIVE,
    credentialCommitment: genResult.credentialCommitment,
    stellarTxId: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
    revocationReason: null,
    generationTimeMs: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    proofRepo = {
      create: jest.fn((val) => ({ ...mockProof, ...val })),
      save: jest.fn((val) =>
        Promise.resolve({ ...val, id: val.id ?? 'proof-1' }),
      ),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockProof]),
      })),
    };

    auditService = {
      logEvent: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZkpService,
        ZkpCircuitService,
        { provide: getRepositoryToken(ZkpProof), useValue: proofRepo },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ZkpService>(ZkpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateProof', () => {
    it('generates a proof for credit score credential', async () => {
      const result = await service.generateProof({
        ownerId: 'user-1',
        credentialType: CredentialType.CREDIT_SCORE,
        credentialValue: '750',
        publicInputs: { threshold: 600 },
      });

      expect(result).toBeDefined();
      expect(result.ownerId).toBe('user-1');
      expect(result.credentialType).toBe(CredentialType.CREDIT_SCORE);
      expect(result.status).toBe(ProofStatus.ACTIVE);
      expect(result.proofPayload).toBeDefined();
      expect(result.credentialCommitment).toBeDefined();
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.expiresAt).toBeInstanceOf(Date);
      // Audit event should be logged
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'zkp:proof:generate',
          actorId: 'user-1',
        }),
      );
    });

    it('generates a proof for compliance credential', async () => {
      const result = await service.generateProof({
        ownerId: 'user-2',
        credentialType: CredentialType.COMPLIANCE,
        credentialValue: 'verified',
        publicInputs: {},
      });

      expect(result.credentialType).toBe(CredentialType.COMPLIANCE);
      expect(result.status).toBe(ProofStatus.ACTIVE);
    });

    it('generates a proof for KYC credential', async () => {
      const result = await service.generateProof({
        ownerId: 'user-3',
        credentialType: CredentialType.KYC,
        credentialValue: 'verified',
      });

      expect(result.credentialType).toBe(CredentialType.KYC);
    });

    it('generates a proof for financial health credential', async () => {
      const result = await service.generateProof({
        ownerId: 'user-4',
        credentialType: CredentialType.FINANCIAL_HEALTH,
        credentialValue: '80',
        publicInputs: { threshold: 50 },
      });

      expect(result.credentialType).toBe(CredentialType.FINANCIAL_HEALTH);
    });

    it('throws BadRequestException for invalid credit score', async () => {
      await expect(
        service.generateProof({
          ownerId: 'user-1',
          credentialType: CredentialType.CREDIT_SCORE,
          credentialValue: '999',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when credit score does not meet threshold', async () => {
      await expect(
        service.generateProof({
          ownerId: 'user-1',
          credentialType: CredentialType.CREDIT_SCORE,
          credentialValue: '500',
          publicInputs: { threshold: 600 },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid compliance status', async () => {
      await expect(
        service.generateProof({
          ownerId: 'user-1',
          credentialType: CredentialType.COMPLIANCE,
          credentialValue: 'unknown',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unverified KYC', async () => {
      await expect(
        service.generateProof({
          ownerId: 'user-1',
          credentialType: CredentialType.KYC,
          credentialValue: 'pending',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyProof', () => {
    it('verifies a valid active proof', async () => {
      proofRepo.findOne.mockResolvedValue({ ...mockProof });

      const result = await service.verifyProof('proof-1');

      expect(result.valid).toBe(true);
      expect(result.proofId).toBe('proof-1');
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'zkp:proof:verify',
        }),
      );
    });

    it('returns invalid for revoked proof', async () => {
      proofRepo.findOne.mockResolvedValue({
        ...mockProof,
        status: ProofStatus.REVOKED,
      });

      const result = await service.verifyProof('proof-1');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('revoked');
    });

    it('returns invalid for expired proof and auto-expires it', async () => {
      proofRepo.findOne.mockResolvedValue({
        ...mockProof,
        expiresAt: new Date(Date.now() - 1_000),
      });

      const result = await service.verifyProof('proof-1');

      expect(result.valid).toBe(false);
      expect(result.message).toContain('expired');
      expect(proofRepo.save).toHaveBeenCalled();
    });

    it('throws NotFoundException for missing proof', async () => {
      proofRepo.findOne.mockResolvedValue(null);

      await expect(service.verifyProof('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revokeProof', () => {
    it('revokes an active proof', async () => {
      proofRepo.findOne.mockResolvedValue({ ...mockProof });

      const result = await service.revokeProof(
        'proof-1',
        'user-1',
        'Credential changed',
      );

      expect(result.status).toBe(ProofStatus.REVOKED);
      expect(result.revocationReason).toBe('Credential changed');
      expect(auditService.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          route: 'zkp:proof:revoke',
        }),
      );
    });

    it('throws ForbiddenException when non-owner tries to revoke', async () => {
      proofRepo.findOne.mockResolvedValue({ ...mockProof });

      await expect(
        service.revokeProof('proof-1', 'other-user', 'reason'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for already-revoked proof', async () => {
      proofRepo.findOne.mockResolvedValue({
        ...mockProof,
        status: ProofStatus.REVOKED,
      });

      await expect(
        service.revokeProof('proof-1', 'user-1', 'reason'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findProofs', () => {
    it('returns proofs filtered by owner', async () => {
      const results = await service.findProofs({ ownerId: 'user-1' });

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(proofRepo.createQueryBuilder).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns a proof by ID', async () => {
      proofRepo.findOne.mockResolvedValue({ ...mockProof });

      const result = await service.findOne('proof-1');

      expect(result.id).toBe('proof-1');
    });

    it('throws NotFoundException for missing proof', async () => {
      proofRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});

describe('ZkpCircuitService', () => {
  let service: ZkpCircuitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ZkpCircuitService],
    }).compile();

    service = module.get<ZkpCircuitService>(ZkpCircuitService);
  });

  describe('generateProof', () => {
    it('generates a proof with valid inputs', () => {
      const result = service.generateProof(CredentialType.CREDIT_SCORE, '750', {
        threshold: 600,
      });

      expect(result.proofPayload).toBeDefined();
      expect(result.credentialCommitment).toHaveLength(64); // SHA-256 hex
      expect(result.circuitId).toBe('credit_score_range_v1');
      expect(result.generationTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('generates a proof without threshold', () => {
      const result = service.generateProof(
        CredentialType.CREDIT_SCORE,
        '700',
        {},
      );

      expect(result.proofPayload).toBeDefined();
    });

    it('generates different proofs for different credentials', () => {
      const r1 = service.generateProof(CredentialType.CREDIT_SCORE, '750', {});
      const r2 = service.generateProof(CredentialType.CREDIT_SCORE, '800', {});

      expect(r1.proofPayload).not.toBe(r2.proofPayload);
      expect(r1.credentialCommitment).not.toBe(r2.credentialCommitment);
    });
  });

  describe('verifyProof', () => {
    it('verifies a proof it generated', () => {
      const gen = service.generateProof(CredentialType.CREDIT_SCORE, '750', {
        threshold: 600,
      });

      const result = service.verifyProof(
        gen.proofPayload,
        gen.publicInputs,
        gen.circuitId,
        gen.credentialCommitment,
      );

      expect(result.valid).toBe(true);
    });

    it('fails verification with tampered public inputs', () => {
      const gen = service.generateProof(CredentialType.CREDIT_SCORE, '750', {
        threshold: 600,
      });

      const result = service.verifyProof(
        gen.proofPayload,
        { threshold: 700 }, // Different threshold
        gen.circuitId,
        gen.credentialCommitment,
      );

      expect(result.valid).toBe(false);
    });

    it('fails verification with mismatched circuit ID', () => {
      const gen = service.generateProof(CredentialType.CREDIT_SCORE, '750', {
        threshold: 600,
      });

      const result = service.verifyProof(
        gen.proofPayload,
        gen.publicInputs,
        'wrong_circuit',
        gen.credentialCommitment,
      );

      expect(result.valid).toBe(false);
      expect(result.message).toContain('Circuit mismatch');
    });

    it('fails verification with mismatched commitment', () => {
      const gen = service.generateProof(CredentialType.CREDIT_SCORE, '750', {
        threshold: 600,
      });

      const result = service.verifyProof(
        gen.proofPayload,
        gen.publicInputs,
        gen.circuitId,
        'wronghash',
      );

      expect(result.valid).toBe(false);
      expect(result.message).toContain('commitment');
    });
  });

  describe('computeCommitment', () => {
    it('produces a SHA-256 hex hash', () => {
      const hash = service.computeCommitment('test-value');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });

    it('produces the same hash for the same input', () => {
      expect(service.computeCommitment('test')).toBe(
        service.computeCommitment('test'),
      );
    });

    it('produces different hashes for different inputs', () => {
      expect(service.computeCommitment('a')).not.toBe(
        service.computeCommitment('b'),
      );
    });
  });

  describe('getDefaultExpiry', () => {
    it('returns a date approximately 1 year in the future', () => {
      const expiry = service.getDefaultExpiry();
      const now = new Date();
      const diffMs = expiry.getTime() - now.getTime();
      const days = diffMs / (1000 * 60 * 60 * 24);

      expect(days).toBeGreaterThan(364);
      expect(days).toBeLessThan(366);
    });
  });
});
