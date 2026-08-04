import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { User } from './entities/user.entity';

@Injectable()
export class KycGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user: User }>();
    const user: User = request.user;
    if (!user || user.kycStatus !== 'verified') {
      const message =
        user?.kycStatus === 'expired'
          ? 'Your KYC documents have expired. Please update them to continue.'
          : 'KYC verification is required to perform this action.';
      throw new ForbiddenException({
        code: user?.kycStatus === 'expired' ? 'KYC_EXPIRED' : 'KYC_REQUIRED',
        message,
      });
    }
    return true;
  }
}
