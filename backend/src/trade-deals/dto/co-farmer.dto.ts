import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class InviteCoFarmerDto {
  @ApiProperty({
    description: 'Email of an existing farmer user to invite',
    example: 'copartner@example.com',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'Stellar wallet address of an existing farmer user to invite',
    required: false,
  })
  @IsString()
  @IsOptional()
  walletAddress?: string;

  @ApiProperty({
    description:
      'Share of the delivery and net payout (percent). All portions on a deal must total at most 100.',
    example: 25,
    minimum: 0.01,
    maximum: 100,
  })
  @IsNumber()
  @Min(0.01)
  @Max(100)
  portionPercent: number;
}

export class AcceptCoFarmerInvitationDto {
  @ApiProperty({ description: 'Token received in the invitation email' })
  @IsString()
  token: string;
}
