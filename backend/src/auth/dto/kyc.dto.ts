import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class KycDto {
  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/gov-id.pdf',
    description: 'URL of the uploaded government ID document',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  governmentIdUrl?: string;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/proof-of-address.pdf',
    description: 'URL of the uploaded proof of address document',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  proofOfAddressUrl?: string;

  @ApiProperty({ example: false, description: 'Whether this is a corporate KYC' })
  @IsBoolean()
  @IsOptional()
  isCorporate?: boolean;

  @ApiPropertyOptional({ example: 'AgriCorp Ltd', description: 'Company Name' })
  @IsString()
  @IsOptional()
  companyName?: string;

  @ApiPropertyOptional({ example: '12345678', description: 'Company Registration Number' })
  @IsString()
  @IsOptional()
  registrationNumber?: string;

  @ApiPropertyOptional({
    example: 'https://s3.amazonaws.com/bucket/license.pdf',
    description: 'Business License URL',
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  businessLicenseUrl?: string;
}
