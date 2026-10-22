import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ZkpProof,
  CredentialType,
  ProofStatus,
  ZkpStandard,
} from './entities/zkp-proof.entity';
import { ZkpCircuitService } from './zkp-circuit.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';

export interface GenerateProofOptions {
  ownerId: string;
  credentialType: CredentialType;
  credentialValue: string;
  publicInputs?: Record<string, unknown>;
  standard?: ZkpStandard;
}

export interface ProofListQuery {
  ownerId?: string;
  credentialType?: CredentialType;
  status?: ProofStatus;
  limit?: number;
}

/**
 * ZkpService — business logic for ZKP proof lifecycle.
 *
 * Responsibilities:
 *  - Generate proofs via ZkpCircuitService and persist to DB
 *  - Verify proofs cryptographically without revealing credentials
 *  - Revoke proofs when credentials change
 *  - List/retrieve proofs with filtering
 *  - Audit trail: log every generate/verify/revoke event to SystemAuditLog
 *  - Stellar on-chain anchoring: anchor proof commitment hash via memo transaction
 *  - Expiry enforcement: auto-expire proofs past their expiresAt timestamp
 */
@Injectable()
export class ZkpService {
  private readonly logger = new Logger(ZkpService.name);

  constructor(
    @InjectRepository(ZkpProof)
    private readonly proofRepo: Repository<ZkpProof>,
    private readonly circuitService: ZkpCircuitService,
    @Optional() private readonly auditService: AuditService,
    @Optional() private readonly configService: ConfigService,
  ) {}

  /**
   * Generates a ZKP proof for a credential.
   * The raw credential value is hashed to a commitment, then discarded.
   * Only the proof payload, commitment, and public inputs are persisted.
   */
  async generateProof(options: GenerateProofOptions): Promise<ZkpProof> {
    const {
      ownerId,
      credentialType,
      credentialValue,
      publicInputs = {},
      standard = ZkpStandard.GROTH16,
    } = options;

    // Generate proof via circuit service
    const result = this.circuitService.generateProof(
      credentialType,
      credentialValue,
      publicInputs,
      standard,
    );

    // Create proof record — never stores the raw credential value
    const proof = this.proofRepo.create({
      ownerId,
      credentialType,
      proofPayload: result.proofPayload,
      publicInputs: result.publicInputs,
      circuitId: result.circuitId,
      standard,
      status: ProofStatus.ACTIVE,
      credentialCommitment: result.credentialCommitment,
      stellarTxId: null,
      expiresAt: this.circuitService.getDefaultExpiry(),
      generationTimeMs: result.generationTimeMs,
    });

    const saved = await this.proofRepo.save(proof);

    // Audit trail
    await this.logAuditEvent('zkp:proof:generate', ownerId, {
      proofId: saved.id,
      credentialType,
      circuitId: result.circuitId,
      standard,
      generationTimeMs: result.generationTimeMs,
    });

    this.logger.log(
      `Proof generated: id=${saved.id}, type=${credentialType}, owner=${ownerId}, time=${result.generationTimeMs}ms`,
    );

    return saved;
  }

  /**
   * Verifies a ZKP proof without revealing the underlying credential.
   * Returns valid=false for revoked or expired proofs.
   */
  async verifyProof(
    proofId: string,
    callerPublicInputs?: Record<string, unknown>,
  ): Promise<{ valid: boolean; proofId: string; message: string }> {
    const proof = await this.findOne(proofId);

    // Check proof status — revoked or expired proofs are invalid
    if (proof.status === ProofStatus.REVOKED) {
      await this.logAuditEvent('zkp:proof:verify', proof.ownerId, {
        proofId,
        result: 'invalid_revoked',
      });
      return {
        valid: false,
        proofId,
        message: 'Proof has been revoked and is no longer valid',
      };
    }

    if (this.isExpired(proof)) {
      // Auto-expire
      await this.expireProof(proof);
      await this.logAuditEvent('zkp:proof:verify', proof.ownerId, {
        proofId,
        result: 'invalid_expired',
      });
      return {
        valid: false,
        proofId,
        message: 'Proof has expired',
      };
    }

    // Use caller-provided public inputs or fall back to stored public inputs
    const publicInputs = callerPublicInputs ?? proof.publicInputs;

    const result = this.circuitService.verifyProof(
      proof.proofPayload,
      publicInputs,
      proof.circuitId,
      proof.credentialCommitment,
    );

    await this.logAuditEvent('zkp:proof:verify', proof.ownerId, {
      proofId,
      result: result.valid ? 'valid' : 'invalid',
      message: result.message,
    });

    this.logger.log(`Proof verified: id=${proofId}, valid=${result.valid}`);

    return {
      valid: result.valid,
      proofId,
      message: result.message,
    };
  }

  /**
   * Revokes a proof. Used when the underlying credential changes
   * (e.g. credit score drops, compliance status revoked).
   */
  async revokeProof(
    proofId: string,
    ownerId: string,
    reason: string,
  ): Promise<ZkpProof> {
    const proof = await this.findOne(proofId);

    // Only the owner or an admin can revoke
    if (proof.ownerId !== ownerId) {
      throw new ForbiddenException('You can only revoke your own proofs');
    }

    if (proof.status === ProofStatus.REVOKED) {
      throw new BadRequestException('Proof is already revoked');
    }

    proof.status = ProofStatus.REVOKED;
    proof.revocationReason = reason;

    const saved = await this.proofRepo.save(proof);

    await this.logAuditEvent('zkp:proof:revoke', ownerId, {
      proofId,
      reason,
      credentialType: proof.credentialType,
    });

    this.logger.log(`Proof revoked: id=${proofId}, reason=${reason}`);

    return saved;
  }

  /**
   * Auto-expires proofs that have passed their expiry date.
   */
  async expireProof(proof: ZkpProof): Promise<void> {
    proof.status = ProofStatus.EXPIRED;
    await this.proofRepo.save(proof);
    this.logger.log(`Proof auto-expired: id=${proof.id}`);
  }

  /**
   * Finds proofs for a user with optional filtering.
   */
  async findProofs(query: ProofListQuery): Promise<ZkpProof[]> {
    const qb = this.proofRepo.createQueryBuilder('p');

    if (query.ownerId) {
      qb.andWhere('p.owner_id = :ownerId', { ownerId: query.ownerId });
    }
    if (query.credentialType) {
      qb.andWhere('p.credential_type = :ct', { ct: query.credentialType });
    }
    if (query.status) {
      qb.andWhere('p.status = :status', { status: query.status });
    }

    qb.orderBy('p.createdAt', 'DESC');

    if (query.limit) {
      qb.take(query.limit);
    }

    return qb.getMany();
  }

  /**
   * Finds a single proof by ID.
   */
  async findOne(id: string): Promise<ZkpProof> {
    const proof = await this.proofRepo.findOne({ where: { id } });
    if (!proof) {
      throw new NotFoundException(`ZKP proof with id ${id} not found`);
    }
    return proof;
  }

  /**
   * Checks if a proof has expired.
   */
  private isExpired(proof: ZkpProof): boolean {
    if (!proof.expiresAt) return false;
    return proof.expiresAt.getTime() < Date.now();
  }

  /**
   * Anchors a proof commitment hash on the Stellar network via a memo transaction.
   * This provides an immutable, publicly-verifiable timestamp of proof existence.
   *
   * In production this would call StellarService.recordMemo() with the commitment
   * hash. The actual Stellar integration is optional and degrades gracefully if
   * the stellar service or network is unavailable.
   */
  async anchorProofOnChain(proofId: string): Promise<string | null> {
    const proof = await this.findOne(proofId);

    try {
      // The commitment hash is anchored as a Stellar memo — this proves
      // the proof existed at a specific on-chain timestamp without
      // revealing any credential data.
      //
      // In production:
      //   const txId = await this.stellarService.recordMemo(
      //     proof.credentialCommitment,
      //   );
      //   proof.stellarTxId = txId;
      //
      // For now, we log the intent and return null — the proof is still
      // valid without on-chain anchoring, but anchoring adds trust.
      this.logger.log(
        `On-chain anchoring requested for proof ${proofId} (commitment: ${proof.credentialCommitment})`,
      );

      proof.stellarTxId = null; // Would be set to the Stellar tx hash
      await this.proofRepo.save(proof);

      await this.logAuditEvent('zkp:proof:anchor', proof.ownerId, {
        proofId,
        commitment: proof.credentialCommitment,
        anchored: false,
      });

      return null;
    } catch (err: any) {
      this.logger.warn(
        `Failed to anchor proof ${proofId} on-chain: ${err?.message}`,
      );
      return null;
    }
  }

  /**
   * Writes an audit log entry. Degrades gracefully if AuditService is not available.
   */
  private async logAuditEvent(
    route: string,
    actorId: string,
    requestDetails: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditService) return;
    try {
      await this.auditService.logEvent({
        route,
        actorId,
        requestDetails,
      });
    } catch (err: any) {
      this.logger.warn(`Failed to write audit log: ${err?.message}`);
    }
  }
}
