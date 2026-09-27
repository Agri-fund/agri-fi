import { IsString, IsUUID, IsEnum, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SignatureMethod, SignatureRequestStatus } from '../entities/signature-request.entity';

export class CreateSignatureRequestDto {
  @ApiProperty({
    description: 'Document UUID to request a signature for',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsUUID()
  documentId: string;

  @ApiProperty({
    description: 'Co-farmer user UUID who must sign the document',
    example: 'b2c3d4e5-f6a7-890a-bcde-f12345678901',
  })
  @IsUUID()
  coSignerId: string;

  @ApiProperty({
    description: 'Optional custom TTL in seconds (1–86400). Falls back to SIGNING_LINK_TTL_SECONDS.',
    required: false,
    example: 3600,
  })
  @IsOptional()
  @IsString()
  ttlSeconds?: string;
}

export class SignDocumentDto {
  @ApiProperty({
    description: 'Document UUID the signature applies to',
  })
  @IsUUID()
  documentId: string;

  @ApiProperty({
    description: 'JWT signing token issued to the co-signer',
  })
  @IsString()
  @MaxLength(4096)
  signingToken: string;

  @ApiProperty({
    description: 'Signature method used by the co-signer',
    enum: ['sep10', 'openpgp'],
  })
  @IsEnum(SignatureMethod)
  signatureMethod: SignatureMethod;

  @ApiProperty({
    description:
      'Armored OpenPGP signature (required when signatureMethod is "openpgp")',
    required: false,
  })
  @IsOptional()
  @IsString()
  signatureAsc?: string;

  @ApiProperty({
    description:
      'Stellar unsigned+signed transaction envelope (required when signatureMethod is "sep10")',
    required: false,
  })
  @IsOptional()
  @IsString()
  stellarEnvelope?: string;
}

export class SignatureRequestResponseDto {
  @ApiProperty({ description: 'Signature request UUID' })
  id: string;

  @ApiProperty({ description: 'Document UUID' })
  documentId: string;

  @ApiProperty({ description: 'Co-signer user UUID' })
  coSignerId: string;

  @ApiProperty({ description: 'Requester user UUID' })
  requesterId: string;

  @ApiProperty({ enum: ['pending', 'signed', 'expired', 'revoked'] })
  status: SignatureRequestStatus;

  @ApiProperty({ description: 'JWT-scoped signing link (single use)' })
  signingLink: string;

  @ApiProperty({ description: 'Absolute expiry timestamp of the signing link' })
  expiresAt: string;

  @ApiProperty({ description: 'POE hash anchored on Stellar after signing' })
  pfpHash: string | null;

  @ApiProperty({
    description: 'Stellar transaction ID that anchors the POE hash',
  })
  stellarTxId: string | null;

  @ApiProperty({ description: 'Signature method used', enum: ['sep10', 'openpgp'] })
  signatureMethod: SignatureMethod | null;

  @ApiProperty({ description: 'When the document was signed' })
  signedAt: string | null;

  @ApiProperty({ description: 'Created timestamp' })
  createdAt: string;
}
