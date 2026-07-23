import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class SubmitTransactionDto {
  @ApiProperty({
    example: 'AAAAAgAAAAB...',
    description: 'Base64-encoded signed Stellar XDR transaction envelope',
  })
  @IsString()
  @IsNotEmpty()
  signedXdr: string;
}
