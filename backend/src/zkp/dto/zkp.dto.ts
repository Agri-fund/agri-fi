import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CredentialType, ZkpStandard } from '../entities/zkp-proof.entity';

export class GenerateProofDto {
  @ApiProperty({
    description: 'Type of credential to prove without revealing',
    enum: CredentialType,
    example: CredentialType.CREDIT_SCORE,
  })
  @IsEnum(CredentialType)
  credentialType: CredentialType;

  /**
   * Raw credential value hashed then discarded; never stored in plaintext.
   * Only the circuit-derived proof and commitment hash are persisted.
   */
  @ApiProperty({
    description:
      'Raw credential value — hashed then discarded; never stored in plaintext',
    example: '750',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  credentialValue: string;

  @ApiPropertyOptional({
    description:
      'Public inputs the verifier is allowed to see (e.g. threshold)',
    example: { threshold: 600 },
  })
  @IsOptional()
  @IsObject()
  publicInputs?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'ZKP standard to use',
    enum: ZkpStandard,
    default: ZkpStandard.GROTH16,
  })
  @IsOptional()
  @IsEnum(ZkpStandard)
  standard?: ZkpStandard;
}

export class VerifyProofDto {
  @ApiProperty({ description: 'UUID of the proof to verify' })
  @IsString()
  proofId: string;

  @ApiPropertyOptional({
    description: 'Public inputs the caller asserts (matched against stored)',
    example: { threshold: 600 },
  })
  @IsOptional()
  @IsObject()
  publicInputs?: Record<string, unknown>;
}

export class RevokeProofDto {
  @ApiProperty({ description: 'Human-readable revocation reason' })
  @IsString()
  @MinLength(5)
  @MaxLength(512)
  reason: string;
}

export class ProofResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() ownerId: string;
  @ApiProperty({ enum: CredentialType }) credentialType: CredentialType;
  @ApiProperty() circuitId: string;
  @ApiProperty({ enum: ZkpStandard }) standard: ZkpStandard;
  @ApiProperty() status: string;
  @ApiProperty() publicInputs: Record<string, unknown>;
  @ApiProperty() credentialCommitment: string;
  @ApiPropertyOptional() stellarTxId: string | null;
  @ApiPropertyOptional() expiresAt: Date | null;
  @ApiPropertyOptional() generationTimeMs: number | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class VerifyProofResponseDto {
  @ApiProperty({ description: 'Whether the proof is cryptographically valid' })
  valid: boolean;

  @ApiProperty() proofId: string;

  @ApiPropertyOptional({ description: 'Human-readable explanation' })
  message?: string;
}
