import { registerDecorator, ValidationOptions } from 'class-validator';
import { Keypair } from '@stellar/stellar-sdk';

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
