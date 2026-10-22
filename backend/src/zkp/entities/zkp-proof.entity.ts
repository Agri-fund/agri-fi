import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum CredentialType {
  CREDIT_SCORE = 'credit_score',
  COMPLIANCE = 'compliance',
  FINANCIAL_HEALTH = 'financial_health',
  KYC = 'kyc',
}

export enum ProofStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum ZkpStandard {
  GROTH16 = 'groth16',
  PLONK = 'plonk',
}

@Entity('zkp_proofs')
@Index('idx_zkp_proofs_owner_type', ['ownerId', 'credentialType'])
@Index('idx_zkp_proofs_status', ['status'])
export class ZkpProof {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id' })
  @Index()
  ownerId: string;

  @Column({ name: 'credential_type', type: 'varchar', length: 64 })
  credentialType: CredentialType;

  /**
   * The zk-SNARK or zk-STARK proof payload (Base64-encoded).
   * This never contains the raw credential value — only the proof.
   */
  @Column({ name: 'proof_payload', type: 'text' })
  proofPayload: string;

  /**
   * Public inputs to the circuit (e.g. claimed lower-bound for credit score).
   * Safe to store and share — reveals only what the prover claims, not the secret.
   */
  @Column({ name: 'public_inputs', type: 'jsonb', default: '{}' })
  publicInputs: Record<string, unknown>;

  /**
   * Circuit/verification key identifier so verifiers know which circuit to use.
   */
  @Column({ name: 'circuit_id', type: 'varchar', length: 128 })
  circuitId: string;

  @Column({ type: 'varchar', length: 32, default: ZkpStandard.GROTH16 })
  standard: ZkpStandard;

  @Column({ type: 'varchar', length: 32, default: ProofStatus.PENDING })
  @Index()
  status: ProofStatus;

  /**
   * SHA-256 commitment hash of the original credential value.
   * Used to detect stale proofs when the credential changes.
   */
  @Column({ name: 'credential_commitment', type: 'varchar', length: 64 })
  credentialCommitment: string;

  /**
   * Optional Stellar transaction ID anchoring this proof on-chain.
   */
  @Column({
    name: 'stellar_tx_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  stellarTxId: string | null;

  /**
   * ISO timestamp when this proof expires (default: +1 year from creation).
   */
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  /**
   * Reason for revocation, populated when status = REVOKED.
   */
  @Column({ name: 'revocation_reason', type: 'text', nullable: true })
  revocationReason: string | null;

  /** Milliseconds taken to generate the proof — used for performance tracking. */
  @Column({ name: 'generation_time_ms', type: 'integer', nullable: true })
  generationTimeMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
