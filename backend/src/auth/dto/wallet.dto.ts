import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStellarPublicKey } from '../../common/validators/is-stellar-public-key';

export class WalletDto {
  @ApiProperty({
    description:
      'Stellar public key (56-character base32 address starting with G)',
    example: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  })
  @IsString()
  @IsStellarPublicKey()
  walletAddress: string;
}
