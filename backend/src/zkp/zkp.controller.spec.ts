import { Test, TestingModule } from '@nestjs/testing';
import { ZkpController } from './zkp.controller';
import { ZkpService } from './zkp.service';
import {
  CredentialType,
  ProofStatus,
  ZkpStandard,
} from './entities/zkp-proof.entity';
import { NotFoundException } from '@nestjs/common';

describe('ZkpController', () => {
  let controller: ZkpController;
  let zkpService: any;

  const mockProof = {
    id: 'proof-1',
    ownerId: 'user-1',
    credentialType: CredentialType.CREDIT_SCORE,
    proofPayload: 'base64payload',
    publicInputs: { threshold: 600 },
    circuitId: 'credit_score_range_v1',
    standard: ZkpStandard.GROTH16,
    status: ProofStatus.ACTIVE,
    credentialCommitment: 'abc123',
    stellarTxId: null,
    expiresAt: new Date(),
    generationTimeMs: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    zkpService = {
      generateProof: jest.fn(),
      verifyProof: jest.fn(),
      revokeProof: jest.fn(),
      findProofs: jest.fn(),
      findOne: jest.fn(),
      anchorProofOnChain: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ZkpController],
      providers: [{ provide: ZkpService, useValue: zkpService }],
    }).compile();

    controller = module.get<ZkpController>(ZkpController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /zkp/proofs/generate', () => {
    it('generates a proof for the authenticated user', async () => {
      zkpService.generateProof.mockResolvedValue(mockProof);

      const result = await controller.generateProof(
        { user: { id: 'user-1' } },
        {
          credentialType: CredentialType.CREDIT_SCORE,
          credentialValue: '750',
          publicInputs: { threshold: 600 },
        },
      );

      expect(zkpService.generateProof).toHaveBeenCalledWith({
        ownerId: 'user-1',
        credentialType: CredentialType.CREDIT_SCORE,
        credentialValue: '750',
        publicInputs: { threshold: 600 },
        standard: undefined,
      });
      expect(result.id).toBe('proof-1');
      expect(result.credentialType).toBe(CredentialType.CREDIT_SCORE);
    });

    it('uses default groth16 standard when not specified', async () => {
      zkpService.generateProof.mockResolvedValue(mockProof);

      await controller.generateProof(
        { user: { id: 'user-1' } },
        {
          credentialType: CredentialType.CREDIT_SCORE,
          credentialValue: '750',
        },
      );

      expect(zkpService.generateProof).toHaveBeenCalledWith(
        expect.objectContaining({
          standard: undefined,
        }),
      );
    });
  });

  describe('POST /zkp/proofs/:id/verify', () => {
    it('verifies a proof', async () => {
      zkpService.verifyProof.mockResolvedValue({
        valid: true,
        proofId: 'proof-1',
        message: 'Proof verified successfully',
      });

      const result = await controller.verifyProof('proof-1', {
        proofId: 'proof-1',
      });

      expect(zkpService.verifyProof).toHaveBeenCalledWith('proof-1', undefined);
      expect(result.valid).toBe(true);
      expect(result.proofId).toBe('proof-1');
    });

    it('throws NotFoundException when path ID does not match body', async () => {
      await expect(
        controller.verifyProof('proof-1', { proofId: 'different' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('passes public inputs from body', async () => {
      zkpService.verifyProof.mockResolvedValue({
        valid: true,
        proofId: 'proof-1',
        message: 'ok',
      });

      await controller.verifyProof('proof-1', {
        proofId: 'proof-1',
        publicInputs: { threshold: 600 },
      });

      expect(zkpService.verifyProof).toHaveBeenCalledWith('proof-1', {
        threshold: 600,
      });
    });
  });

  describe('POST /zkp/proofs/:id/revoke', () => {
    it('revokes a proof', async () => {
      zkpService.revokeProof.mockResolvedValue({
        ...mockProof,
        status: ProofStatus.REVOKED,
        revocationReason: 'Credential changed',
      });

      const result = await controller.revokeProof(
        { user: { id: 'user-1' } },
        'proof-1',
        { reason: 'Credential changed' },
      );

      expect(zkpService.revokeProof).toHaveBeenCalledWith(
        'proof-1',
        'user-1',
        'Credential changed',
      );
      expect(result.status).toBe(ProofStatus.REVOKED);
    });
  });

  describe('GET /zkp/proofs', () => {
    it('lists proofs for the current user', async () => {
      zkpService.findProofs.mockResolvedValue([mockProof]);

      const result = await controller.listProofs({ user: { id: 'user-1' } });

      expect(zkpService.findProofs).toHaveBeenCalledWith({
        ownerId: 'user-1',
        credentialType: undefined,
        status: undefined,
        limit: undefined,
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('proof-1');
    });

    it('passes filter parameters', async () => {
      zkpService.findProofs.mockResolvedValue([mockProof]);

      await controller.listProofs(
        { user: { id: 'user-1' } },
        CredentialType.CREDIT_SCORE,
        ProofStatus.ACTIVE,
        10,
      );

      expect(zkpService.findProofs).toHaveBeenCalledWith({
        ownerId: 'user-1',
        credentialType: CredentialType.CREDIT_SCORE,
        status: ProofStatus.ACTIVE,
        limit: 10,
      });
    });

    it('caps limit at 100', async () => {
      zkpService.findProofs.mockResolvedValue([]);

      await controller.listProofs(
        { user: { id: 'user-1' } },
        undefined,
        undefined,
        200,
      );

      expect(zkpService.findProofs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 }),
      );
    });
  });

  describe('GET /zkp/proofs/:id', () => {
    it('returns a proof owned by the user', async () => {
      zkpService.findOne.mockResolvedValue(mockProof);

      const result = await controller.getProof(
        { user: { id: 'user-1' } },
        'proof-1',
      );

      expect(result.id).toBe('proof-1');
    });

    it('throws NotFoundException when proof belongs to another user', async () => {
      zkpService.findOne.mockResolvedValue({
        ...mockProof,
        ownerId: 'other-user',
      });

      await expect(
        controller.getProof({ user: { id: 'user-1' } }, 'proof-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /zkp/proofs/:id/anchor', () => {
    it('anchors a proof on-chain', async () => {
      zkpService.findOne.mockResolvedValue(mockProof);
      zkpService.anchorProofOnChain.mockResolvedValue('tx-hash-123');

      const result = await controller.anchorProof(
        { user: { id: 'user-1' } },
        'proof-1',
      );

      expect(result.proofId).toBe('proof-1');
      expect(result.stellarTxId).toBe('tx-hash-123');
    });

    it('throws NotFoundException for proof owned by another user', async () => {
      zkpService.findOne.mockResolvedValue({
        ...mockProof,
        ownerId: 'other-user',
      });

      await expect(
        controller.anchorProof({ user: { id: 'user-1' } }, 'proof-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
