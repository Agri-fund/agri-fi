import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Sep10ResponseDto {
  @ApiProperty({
    description: 'Signed SEP-10 challenge transaction XDR (base64)',
    example: 'AAAAAgAAAAB...',
  })
  @IsString()
  signedXdr: string;
}
