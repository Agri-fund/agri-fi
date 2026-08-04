import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class SubmitKycDto {
  @ApiProperty({
    example: false,
    description: 'Whether this is a corporate KYC submission',
  })
  @IsBoolean()
  @IsOptional()
  isCorporate?: boolean;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/gov-id.pdf',
    description:
      'URL of the uploaded government ID document (required for individual KYC)',
  })
  @ValidateIf((dto) => !dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  governmentIdUrl?: string;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/proof-of-address.pdf',
    description:
      'URL of the uploaded proof of address document (required for individual KYC)',
  })
  @ValidateIf((dto) => !dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  proofOfAddressUrl?: string;

  @ApiPropertyOptional({
    example: 'AgriCorp Ltd',
    description: 'Company name (required for corporate KYC)',
  })
  @ValidateIf((dto) => dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  companyName?: string;

  @ApiPropertyOptional({
    example: '12345678',
    description: 'Company registration number (required for corporate KYC)',
  })
  @ValidateIf((dto) => dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  registrationNumber?: string;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/license.pdf',
    description: 'Business license URL (required for corporate KYC)',
  })
  @ValidateIf((dto) => dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  businessLicenseUrl?: string;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/articles.pdf',
    description: 'Articles of incorporation URL (required for corporate KYC)',
  })
  @ValidateIf((dto) => dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  articlesOfIncorporationUrl?: string;

  @ApiPropertyOptional({
    example: '2027-12-31',
    description: 'Optional expiry date of the identity document (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  documentExpiresAt?: string;
}
