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
import * as bcrypt from 'bcrypt';
import { User } from '../entities/user.entity';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

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
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // ── #806: role-based MFA enforcement ────────────────────────────────────
    // Admin and company_admin accounts MUST have MFA enabled and provide a
    // valid token on every guarded request — there is no bypass.
    // Non-admin roles (farmer, trader, investor) are permitted through if MFA
    // is not set up; once enabled they are subject to the same TOTP/backup-code
    // checks as admins.
    const isAdminRole = user.role === 'admin' || user.role === 'company_admin';

    if (!user.isMfaEnabled || !user.mfaSecret) {
      if (isAdminRole) {
        // Admin without MFA must enroll first — block with an actionable error.
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          message: 'MFA setup required for admin accounts',
          code: 'MFA_ENROLLMENT_REQUIRED',
        });
      }
      // Non-admin users without MFA configured are allowed through.
      return true;
    }

    // Check lockout
    if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: `MFA locked due to too many failed attempts. Try again after ${user.mfaLockedUntil.toISOString()}.`,
        code: 'MFA_LOCKED_OUT',
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

    // Try TOTP first
    let isValid = false;
    try {
      isValid = authenticator.verify({
        token: mfaToken.trim(),
        secret: user.mfaSecret,
      });
    } catch {
      isValid = false;
    }

    // If TOTP fails, try backup codes
    if (!isValid && user.mfaBackupCodes?.length) {
      for (let i = 0; i < user.mfaBackupCodes.length; i++) {
        const codeMatch = await bcrypt.compare(
          mfaToken.trim(),
          user.mfaBackupCodes[i],
        );
        if (codeMatch) {
          isValid = true;
          // Remove used backup code (single-use)
          user.mfaBackupCodes.splice(i, 1);
          break;
        }
      }
    }

    if (!isValid) {
      // Track failed attempts
      user.mfaFailedAttempts = (user.mfaFailedAttempts || 0) + 1;
      if (user.mfaFailedAttempts >= MAX_ATTEMPTS) {
        user.mfaLockedUntil = new Date(Date.now() + LOCKOUT_MS);
        user.mfaFailedAttempts = 0;
      }
      await this.userRepo.save(user);

      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Invalid MFA token.',
        code: 'MFA_REQUIRED',
      });
    }

    // Success — reset failed attempts
    user.mfaFailedAttempts = 0;
    user.mfaLockedUntil = null;
    await this.userRepo.save(user);

    return true;
  }
}
