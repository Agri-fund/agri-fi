import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Sep10ChallengeDto {
  @ApiProperty({
    description: 'Stellar public key (G...) to authenticate',
    example: 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37',
  })
  @IsString()
  @Matches(/^G[A-Z0-9]{55}$/, {
    message: 'wallet must be a valid Stellar public key starting with G',
  })
  wallet: string;
}
