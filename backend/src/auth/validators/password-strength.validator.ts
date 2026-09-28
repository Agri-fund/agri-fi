import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import zxcvbn from 'zxcvbn';

@ValidatorConstraint({ name: 'isStrongPassword', async: false })
export class IsStrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(password: string) {
    return zxcvbn(password).score >= 3;
  }
  defaultMessage() {
    return 'Password is too weak. Use a mix of letters, numbers, and symbols.';
  }
}

export function IsStrongPassword(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      validator: IsStrongPasswordConstraint,
    });
}
