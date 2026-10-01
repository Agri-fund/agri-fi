import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { KycCustomerType } from '../entities/kyc-jurisdiction-rule.entity';

export class CreateKycJurisdictionRuleDto {
  @ApiProperty({ example: 'NG' })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/)
  countryCode: string;

  @ApiProperty({ enum: KycCustomerType })
  @IsEnum(KycCustomerType)
  customerType: KycCustomerType;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  requiredDocuments: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  acceptedIdTypes: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idNumberPattern?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresProofOfAddress?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requiresSelfie?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  maxDocumentAgeDays?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  documentExpiryRequired?: boolean;

  @ApiProperty({ description: 'Reason recorded in the audit trail' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  changeReason: string;
}

export class UpdateKycJurisdictionRuleDto extends PartialType(
  CreateKycJurisdictionRuleDto,
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ValidateKycSubmissionDto {
  @ApiProperty({ example: 'NG' })
  @IsString()
  @Length(2, 2)
  countryCode: string;

  @ApiProperty({ enum: KycCustomerType })
  @IsEnum(KycCustomerType)
  customerType: KycCustomerType;

  @ApiPropertyOptional({ example: 'passport' })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiPropertyOptional({ example: 'A1234567' })
  @IsOptional()
  @IsString()
  idNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  documentExpiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasGovernmentIdFront?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasGovernmentIdBack?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasProofOfAddress?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasSelfie?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasBusinessLicense?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasArticlesOfIncorporation?: boolean;
}
