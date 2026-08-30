import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class SubmitKycDto {
  @ApiPropertyOptional({ example: 'Amina Yusuf', description: 'Full legal name' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @ApiPropertyOptional({ example: '1992-04-13', description: 'Date of birth' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'Nigeria', description: 'Nationality' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nationality?: string;

  @ApiPropertyOptional({ example: '12 Cocoa Street, Lagos', description: 'Residential address' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;

  @ApiPropertyOptional({
    example: '2027-08-26',
    description: 'Expiry date for the submitted document set',
  })
  @IsOptional()
  @IsDateString()
  documentExpiresAt?: string;

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
    example: 'https://s3.amazonaws.com/bucket/id-back.jpg',
    description: 'Back side of the identity document',
  })
  @ValidateIf((dto) => !dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  identityDocumentBackUrl?: string;

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
    example: 'https://s3.amazonaws.com/bucket/selfie.jpg',
    description: 'Selfie with document URL',
  })
  @ValidateIf((dto) => !dto.isCorporate)
  @IsString()
  @IsNotEmpty()
  @IsUrl()
  selfieUrl?: string;

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
}
