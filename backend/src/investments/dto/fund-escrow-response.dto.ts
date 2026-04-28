import { ApiProperty } from '@nestjs/swagger';

export class FundEscrowResponseDto {
  @ApiProperty({
    description: 'Investment status after funding request',
    enum: ['queued', 'confirmed'],
    example: 'queued',
  })
  status: 'queued' | 'confirmed';

  @ApiProperty({
    description: 'Investment ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  investmentId: string;

  @ApiProperty({
    description: 'Stellar transaction ID (only present when status is "confirmed")',
    example: 'c9b8a7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8',
    required: false,
  })
  stellarTxId?: string;
}