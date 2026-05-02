import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ApproveCampaignDto {
  @ApiProperty({ example: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4' })
  @IsString()
  @IsNotEmpty()
  contractId: string;
}
