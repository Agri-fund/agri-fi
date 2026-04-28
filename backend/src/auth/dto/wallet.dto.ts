import {
  IsString,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Keypair } from 'stellar-sdk';

export function IsStellarPublicKey(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarPublicKey',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          if (typeof value !== 'string') return false;
          try {
            Keypair.fromPublicKey(value);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage() {
          return 'walletAddress must be a valid Stellar public key (56-character G... address)';
        },
      },
    });
  };
}

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
