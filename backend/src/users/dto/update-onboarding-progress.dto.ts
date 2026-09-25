import { IsBoolean, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOnboardingProgressDto {
  @ApiPropertyOptional({
    description: 'Whether the farmer has completed their profile',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  profileComplete?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the farmer has submitted KYC documents',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  kycSubmitted?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the farmer has created their first trade deal',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  firstDealCreated?: boolean;

  @ApiPropertyOptional({
    description: 'Whether the farmer has connected a Stellar wallet',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  walletConnected?: boolean;
}
