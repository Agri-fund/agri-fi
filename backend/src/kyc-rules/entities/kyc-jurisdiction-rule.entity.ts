import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum KycCustomerType {
  INDIVIDUAL = 'individual',
  CORPORATE = 'corporate',
}

export type KycDocumentType =
  | 'government_id_front'
  | 'government_id_back'
  | 'proof_of_address'
  | 'selfie'
  | 'business_license'
  | 'articles_of_incorporation';

@Entity('kyc_jurisdiction_rules')
@Index(['countryCode', 'customerType', 'version'] as any, {
  unique: true,
  name: 'UQ_kyc_jurisdiction_country_type_version',
})
@Index(['countryCode'] as any, { name: 'IDX_kyc_jurisdiction_country' })
@Index(['isActive'] as any, { name: 'IDX_kyc_jurisdiction_active' })
export class KycJurisdictionRule {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ name: 'country_code', type: 'varchar', length: 2 })
  @ApiProperty({ example: 'NG', description: 'ISO 3166-1 alpha-2 country code' })
  countryCode: string;

  @Column({
    name: 'customer_type',
    type: 'enum',
    enum: KycCustomerType,
    default: KycCustomerType.INDIVIDUAL,
  })
  @ApiProperty({ enum: KycCustomerType })
  customerType: KycCustomerType;

  @Column({ name: 'required_documents', type: 'jsonb', default: [] })
  @ApiProperty({
    type: [String],
    example: ['government_id_front', 'proof_of_address', 'selfie'],
  })
  requiredDocuments: KycDocumentType[];

  @Column({ name: 'accepted_id_types', type: 'jsonb', default: [] })
  @ApiProperty({
    type: [String],
    example: ['national_id', 'passport'],
  })
  acceptedIdTypes: string[];

  @Column({ name: 'id_number_pattern', type: 'varchar', length: 128, nullable: true })
  @ApiPropertyOptional({ example: '^[A-Z0-9]{6,20}$' })
  idNumberPattern: string | null;

  @Column({ name: 'requires_proof_of_address', type: 'boolean', default: true })
  @ApiProperty()
  requiresProofOfAddress: boolean;

  @Column({ name: 'requires_selfie', type: 'boolean', default: true })
  @ApiProperty()
  requiresSelfie: boolean;

  @Column({ name: 'max_document_age_days', type: 'int', nullable: true })
  @ApiPropertyOptional()
  maxDocumentAgeDays: number | null;

  @Column({ name: 'document_expiry_required', type: 'boolean', default: true })
  @ApiProperty()
  documentExpiryRequired: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  @ApiProperty()
  isActive: boolean;

  @Column({ type: 'int', default: 1 })
  @ApiProperty()
  version: number;

  @Column({ name: 'change_reason', type: 'text', nullable: true })
  @ApiPropertyOptional()
  changeReason: string | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
