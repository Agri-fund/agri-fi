import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { authenticator } from 'otplib';
import { User } from '../entities/user.entity';

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const reqUser = request.user;
    if (!reqUser || !reqUser.id) {
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.userRepo.findOne({ where: { id: reqUser.id } });
    if (!user || !user.isMfaEnabled || !user.mfaSecret) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'MFA is required for administrative actions.',
        code: 'MFA_REQUIRED',
      });
    }

    const mfaHeader =
      request.headers['x-mfa-token'] || request.headers['X-MFA-Token'];

    const mfaToken = Array.isArray(mfaHeader) ? mfaHeader[0] : mfaHeader;

    if (!mfaToken || typeof mfaToken !== 'string') {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'MFA token missing in X-MFA-Token header.',
        code: 'MFA_REQUIRED',
      });
    }

    let isValid = false;
    try {
      isValid = authenticator.verify({
        token: mfaToken.trim(),
        secret: user.mfaSecret,
      });
    } catch {
      isValid = false;
    }

    if (!isValid) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Invalid MFA token.',
        code: 'MFA_REQUIRED',
      });
    }

    return true;
  }
}
