import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Keypair, Transaction, Networks } from '@stellar/stellar-sdk';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { LoginLog } from '../database/entities/login-log.entity';
import { AdminAction } from '../database/entities/admin-action.entity';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';
import { TokenBlocklistService } from './token-blocklist.service';
import { SecurityThreatService } from './security-threat.service';

const mockUser = (): User => ({
  id: 'uuid-1',
  email: 'farmer@example.com',
  passwordHash: '',
  googleSubject: null,
  role: 'farmer',
  country: 'NG',
  kycStatus: 'pending',
  tokenVersion: 0,
  walletAddress: null,
  isCompany: false,
  companyDetails: null,
  createdAt: new Date(),
  fullName: null,
  birthdate: null,
  taxId: null,
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findAndCount: jest.Mock;
  };
  let kycRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let loginLogRepo: { find: jest.Mock; save: jest.Mock; create: jest.Mock };
  let adminActionRepo: { save: jest.Mock; create: jest.Mock };
  let jwtService: { sign: jest.Mock; verify: jest.Mock; decode: jest.Mock };
  let configService: { get: jest.Mock };
  let notificationsService: { sendEmail: jest.Mock };
  let ofacSanctionsCheck: { isAddressSanctioned: jest.Mock };
  let tokenBlocklistService: any;
  let securityThreat: any;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };
    kycRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    loginLogRepo = { find: jest.fn(), save: jest.fn(), create: jest.fn() };
    adminActionRepo = { save: jest.fn(), create: jest.fn() };
    jwtService = {
      sign: jest.fn().mockReturnValue('token'),
      verify: jest.fn(),
      decode: jest.fn(),
    };
    configService = { get: jest.fn() };
    notificationsService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    ofacSanctionsCheck = { isAddressSanctioned: jest.fn().mockResolvedValue(false) };
    tokenBlocklistService = {
      isTokenFamilyRevoked: jest.fn().mockResolvedValue(false),
      isRefreshTokenRotated: jest.fn().mockResolvedValue(false),
      markRefreshTokenRotated: jest.fn().mockResolvedValue(undefined),
      revokeTokenFamily: jest.fn().mockResolvedValue(undefined),
      blocklistToken: jest.fn().mockResolvedValue(undefined),
    };
    securityThreat = {
      checkLogin: jest.fn().mockResolvedValue({ action: 'allow' }),
      verifyCaptcha: jest.fn().mockResolvedValue(true),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: getRepositoryToken(LoginLog), useValue: loginLogRepo },
        { provide: getRepositoryToken(AdminAction), useValue: adminActionRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: QueueService, useValue: { emit: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: OfacSanctionsCheckService, useValue: ofacSanctionsCheck },
        { provide: TokenBlocklistService, useValue: tokenBlocklistService },
        { provide: SecurityThreatService, useValue: securityThreat },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates a user with pending KYC', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const user = {
        ...mockUser(),
        passwordHash: await bcrypt.hash('password1', 10),
      };
      userRepo.create.mockReturnValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.register({
        name: 'Test Farmer',
        email: 'farmer@example.com',
        password: 'password1',
        role: 'farmer',
        country: 'NG',
      });

      expect(result.kycStatus).toBe('pending');
      expect(result.email).toBe('farmer@example.com');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  describe('loginWithGoogle', () => {
    it('links Google to an existing investor account', async () => {
      const user = { ...mockUser(), role: 'investor' as const, googleSubject: null };
      userRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
      userRepo.save.mockResolvedValue(user);

      await service.loginWithGoogle({
        subject: 'google-subject',
        email: user.email,
        emailVerified: true,
      });

      expect(user.googleSubject).toBe('google-subject');
      expect(userRepo.save).toHaveBeenCalledWith(user);
    });

    it('creates a verified investor account when no email exists', async () => {
      const user = { ...mockUser(), role: 'investor' as const };
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockReturnValue(user);
      userRepo.save.mockResolvedValue(user);

      await service.loginWithGoogle({
        subject: 'new-google-subject',
        email: 'investor@example.com',
        emailVerified: true,
      });

      expect(userRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'investor@example.com',
          googleSubject: 'new-google-subject',
          role: 'investor',
          isEmailVerified: true,
        }),
      );
    });

    it('rejects an existing non-investor account', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser(), role: 'farmer' });

      await expect(
        service.loginWithGoogle({
          subject: 'google-subject',
          email: 'farmer@example.com',
          emailVerified: true,
        }),
      ).rejects.toThrow('investor accounts only');
    });
  });

  describe('listUsers', () => {
    it('does not return passwordHash in user records', async () => {
      userRepo.findAndCount.mockResolvedValue([
        [
          {
            id: 'uuid-1',
            email: 'farmer@example.com',
            role: 'farmer',
            kycStatus: 'verified',
            country: 'NG',
            createdAt: new Date(),
            walletAddress: null,
            isCompany: false,
          },
        ],
        1,
      ]);

      const result = await service.listUsers();

      expect(userRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.arrayContaining(['passwordHash']),
        }),
      );
      expect(result.users[0]).not.toHaveProperty('passwordHash');
      expect(result.users[0]).not.toHaveProperty('password_hash');
    });
  });

  describe('submitKyc', () => {
    const kycDto = {
      governmentIdUrl: 'http://s3.com/id.pdf',
      proofOfAddressUrl: 'http://s3.com/address.pdf',
    };

    it('stores documents and sets status to pending_review in production', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      configService.get.mockReturnValue('false'); // KYC_AUTO_APPROVE=false

      kycRepo.create.mockReturnValue({ ...kycDto, status: 'pending_review' });
      kycRepo.save.mockResolvedValue({ ...kycDto, status: 'pending_review' });

      const result = await service.submitKyc('uuid-1', kycDto);

      expect(kycRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending_review',
        }),
      );
      expect(userRepo.save).not.toHaveBeenCalled(); // No status change for user
      expect(result.kycStatus).toBe('pending');
    });

    it('auto-approves KYC when flag is set', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      configService.get.mockReturnValue('true'); // KYC_AUTO_APPROVE=true

      kycRepo.create.mockReturnValue({ ...kycDto, status: 'approved' });
      kycRepo.save.mockResolvedValue({ ...kycDto, status: 'approved' });
      userRepo.save.mockResolvedValue({ ...user, kycStatus: 'verified' });

      const result = await service.submitKyc('uuid-1', kycDto);

      expect(kycRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
        }),
      );
      expect(userRepo.save).toHaveBeenCalled();
      expect(result.kycStatus).toBe('verified');
    });
  });

  describe('approveKyc', () => {
    it('sets kycStatus to verified and updates submission', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      kycRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'pending_review',
      });
      userRepo.save.mockResolvedValue({ ...user, kycStatus: 'verified' });

      const result = await service.approveKyc('uuid-1');

      expect(kycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'approved',
        }),
      );
      expect(userRepo.save).toHaveBeenCalled();
      expect(result.kycStatus).toBe('verified');
    });

    it('throws NotFoundException if no pending submission', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      kycRepo.findOne.mockResolvedValue(null);

      await expect(service.approveKyc('uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('unlockAccount', () => {
    describe('generateUnlockToken', () => {
      it('generates a valid JWT token with account_unlock type', () => {
        const userId = 'user-123';
        const token = (service as any).generateUnlockToken(userId);

        expect(jwtService.sign).toHaveBeenCalledWith(
          { sub: userId, typ: 'account_unlock' },
          { expiresIn: '15m' },
        );
        expect(token).toBe('token');
      });
    });

    describe('unlockAccount method', () => {
      it('successfully unlocks a locked account and resets lockout fields', async () => {
        const lockedUser = {
          ...mockUser(),
          lockoutUntil: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes in future
          failedLoginAttempts: 5,
        };

        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'user-123',
          typ: 'account_unlock',
        });
        userRepo.findOne.mockResolvedValue(lockedUser);
        userRepo.save.mockResolvedValue({
          ...lockedUser,
          lockoutUntil: null,
          failedLoginAttempts: 0,
        });
        loginLogRepo.create.mockReturnValue({
          userId: 'user-123',
          ipAddress: '192.168.1.1',
          userAgent: 'unlock_attempt|Mozilla/5.0',
          country: 'US',
          countryCode: 'US',
          deviceFingerprint: 'abc123',
        });
        loginLogRepo.save.mockResolvedValue({});

        const result = await service.unlockAccount('valid-token', {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          country: 'US',
          acceptLanguage: 'en-US',
        });

        expect(userRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            lockoutUntil: null,
            failedLoginAttempts: 0,
          }),
        );
        expect(loginLogRepo.save).toHaveBeenCalled();
        expect(result.message).toContain('unlocked successfully');
      });

      it('throws BadRequestException for invalid token', async () => {
        jwtService.verify = jest.fn().mockImplementation(() => {
          throw new Error('Invalid token');
        });

        await expect(service.unlockAccount('invalid-token')).rejects.toThrow(
          'Invalid or expired unlock token',
        );
      });

      it('throws BadRequestException if token type is not account_unlock', async () => {
        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'user-123',
          typ: 'access', // Wrong type
        });

        await expect(service.unlockAccount('wrong-type-token')).rejects.toThrow(
          'Invalid unlock token',
        );
      });

      it('throws NotFoundException if user not found', async () => {
        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'nonexistent-user',
          typ: 'account_unlock',
        });
        userRepo.findOne.mockResolvedValue(null);

        await expect(service.unlockAccount('valid-token')).rejects.toThrow(
          'User not found',
        );
      });

      it('logs unlock attempt to login_logs table with request metadata', async () => {
        const user = mockUser();
        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'user-123',
          typ: 'account_unlock',
        });
        userRepo.findOne.mockResolvedValue(user);
        userRepo.save.mockResolvedValue(user);
        loginLogRepo.create.mockReturnValue({});
        loginLogRepo.save.mockResolvedValue({});

        await service.unlockAccount('valid-token', {
          ip: '192.168.1.100',
          userAgent: 'Chrome/96.0',
          country: 'NG',
          acceptLanguage: 'en',
        });

        expect(loginLogRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'uuid-1',
            ipAddress: '192.168.1.100',
            userAgent: expect.stringContaining('unlock_attempt'),
            country: 'NG',
            countryCode: 'NG',
          }),
        );
        expect(loginLogRepo.save).toHaveBeenCalled();
      });

      it('returns appropriate message when account was already unlocked', async () => {
        const unlockedUser = {
          ...mockUser(),
          lockoutUntil: null, // Already unlocked
          failedLoginAttempts: 0,
        };

        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'user-123',
          typ: 'account_unlock',
        });
        userRepo.findOne.mockResolvedValue(unlockedUser);
        userRepo.save.mockResolvedValue(unlockedUser);
        loginLogRepo.create.mockReturnValue({});
        loginLogRepo.save.mockResolvedValue({});

        const result = await service.unlockAccount('valid-token');

        expect(result.message).toContain('unlock token validated');
      });

      it('handles missing IP address gracefully', async () => {
        const user = mockUser();
        jwtService.verify = jest.fn().mockReturnValue({
          sub: 'user-123',
          typ: 'account_unlock',
        });
        userRepo.findOne.mockResolvedValue(user);
        userRepo.save.mockResolvedValue(user);

        const result = await service.unlockAccount('valid-token', {
          userAgent: 'Chrome/96.0',
          // No IP provided
        });

        expect(loginLogRepo.save).not.toHaveBeenCalled();
        expect(userRepo.save).toHaveBeenCalled();
        expect(result).toBeDefined();
      });
    });
  });

  describe('refresh', () => {
    let tokenBlocklistService: {
      isTokenFamilyRevoked: jest.Mock;
      isRefreshTokenRotated: jest.Mock;
      markRefreshTokenRotated: jest.Mock;
      revokeTokenFamily: jest.Mock;
    };

    const basePayload = {
      sub: 'uuid-1',
      email: 'farmer@example.com',
      role: 'farmer',
      tokenVersion: 0,
      typ: 'refresh' as const,
      jti: 'jti-1',
      familyId: 'family-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };

    beforeEach(() => {
      tokenBlocklistService = {
        isTokenFamilyRevoked: jest.fn().mockResolvedValue(false),
        isRefreshTokenRotated: jest.fn().mockResolvedValue(false),
        markRefreshTokenRotated: jest.fn().mockResolvedValue(undefined),
        revokeTokenFamily: jest.fn().mockResolvedValue(undefined),
      };
      (service as any).tokenBlocklistService = tokenBlocklistService;
      jwtService.verify = jest.fn().mockReturnValue(basePayload);
      // Mimic ConfigService's real fallback-to-default behavior.
      configService.get.mockImplementation(
        (_key: string, def?: unknown) => def,
      );
    });

    it('rotates the refresh token: marks the old jti used and keeps the family id', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());

      await service.refresh('old-refresh-token');

      expect(tokenBlocklistService.isRefreshTokenRotated).toHaveBeenCalledWith(
        'jti-1',
      );
      expect(
        tokenBlocklistService.markRefreshTokenRotated,
      ).toHaveBeenCalledWith('jti-1', expect.any(Number));
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ typ: 'refresh', familyId: 'family-1' }),
        expect.objectContaining({ expiresIn: '7d' }),
      );
    });

    it('detects replay of an already-rotated token, revokes the family, and bumps tokenVersion', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      tokenBlocklistService.isRefreshTokenRotated.mockResolvedValue(true);

      await expect(service.refresh('replayed-refresh-token')).rejects.toThrow(
        'Refresh token reuse detected',
      );

      expect(tokenBlocklistService.revokeTokenFamily).toHaveBeenCalledWith(
        'family-1',
        expect.any(Number),
      );
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tokenVersion: 1 }),
      );
    });

    it('rejects refresh when the token family has been revoked', async () => {
      userRepo.findOne.mockResolvedValue(mockUser());
      tokenBlocklistService.isTokenFamilyRevoked.mockResolvedValue(true);

      await expect(service.refresh('revoked-family-token')).rejects.toThrow(
        'Token no longer valid',
      );
    });

    it('rejects refresh when tokenVersion no longer matches (e.g. after logout)', async () => {
      userRepo.findOne.mockResolvedValue({ ...mockUser(), tokenVersion: 1 });

      await expect(service.refresh('stale-refresh-token')).rejects.toThrow(
        'Token no longer valid',
      );
    });

    it('rejects refresh when token type is not refresh', async () => {
      jwtService.verify = jest.fn().mockReturnValue({ ...basePayload, typ: 'access' });
      userRepo.findOne.mockResolvedValue(mockUser());

      await expect(service.refresh('access-token')).rejects.toThrow(
        'Invalid refresh token.',
      );
    });

    it('rejects refresh when user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.refresh('orphan-token')).rejects.toThrow(
        'Invalid or expired refresh token.',
      );
    });

    it('rejects refresh when jwt verify throws', async () => {
      jwtService.verify = jest.fn().mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(
        'Invalid or expired refresh token.',
      );
    });
  });

  describe('verifyEmail', () => {
    it('verifies email when token is valid', async () => {
      const user = { ...mockUser(), isEmailVerified: false, emailVerificationToken: 'tok' };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, isEmailVerified: true, emailVerificationToken: null });

      const result = await service.verifyEmail('tok');

      expect(result.message).toBe('Email verified successfully.');
      expect(user.isEmailVerified).toBe(true);
      expect(user.emailVerificationToken).toBeNull();
    });

    it('throws BadRequestException for invalid token', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.verifyEmail('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('login', () => {
    it('throws UnauthorizedException when user is not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@example.com', password: 'pw' }),
      ).rejects.toThrow('Invalid credentials.');
    });

    it('throws UnauthorizedException when account is locked', async () => {
      const user = {
        ...mockUser(),
        isEmailVerified: true,
        lockoutUntil: new Date(Date.now() + 10 * 60 * 1000),
      };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'pw' }),
      ).rejects.toThrow('Account locked');
    });

    it('throws UnauthorizedException when email is not verified', async () => {
      const user = { ...mockUser(), isEmailVerified: false };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'pw' }),
      ).rejects.toThrow('verify your email');
    });

    it('throws UnauthorizedException for wrong password and increments failed attempts', async () => {
      const user = {
        ...mockUser(),
        isEmailVerified: true,
        passwordHash: await bcrypt.hash('correctpw', 10),
        failedLoginAttempts: 0,
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'wrongpw' }),
      ).rejects.toThrow('Invalid credentials.');

      expect(user.failedLoginAttempts).toBe(1);
    });

    it('locks the account after 5 failed attempts and sends unlock email', async () => {
      const user = {
        ...mockUser(),
        isEmailVerified: true,
        passwordHash: await bcrypt.hash('correctpw', 10),
        failedLoginAttempts: 4,
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      await expect(
        service.login({ email: user.email, password: 'wrongpw' }),
      ).rejects.toThrow('Account locked for 15 minutes');

      expect(user.lockoutUntil).toBeDefined();
      expect(user.failedLoginAttempts).toBe(0);
      expect(notificationsService.sendEmail).toHaveBeenCalled();
    });

    it('returns tokens on successful login', async () => {
      const user = {
        ...mockUser(),
        isEmailVerified: true,
        passwordHash: await bcrypt.hash('correctpw', 10),
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.login({ email: user.email, password: 'correctpw' });

      expect(result.accessToken).toBe('token');
      expect(result.refreshToken).toBe('token');
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockoutUntil).toBeNull();
    });

    it('blocks login when security threat detects blocked action', async () => {
      securityThreat.checkLogin.mockResolvedValue({ action: 'blocked' });

      await expect(
        service.login({ email: 'blocked@example.com', password: 'pw' }),
      ).rejects.toThrow();
    });

    it('requires captcha when security threat flags captchaRequired', async () => {
      securityThreat.checkLogin.mockResolvedValue({ action: 'allow', captchaRequired: true });

      await expect(
        service.login({ email: 'captcha@example.com', password: 'pw' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('changePassword', () => {
    it('updates password and bumps tokenVersion', async () => {
      const user = {
        ...mockUser(),
        passwordHash: await bcrypt.hash('oldpw', 10),
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.changePassword('uuid-1', {
        currentPassword: 'oldpw',
        newPassword: 'newpassword1',
      });

      expect(result.message).toContain('Password updated');
      expect(user.tokenVersion).toBe(1);
    });

    it('throws BadRequestException when current password is incorrect', async () => {
      const user = {
        ...mockUser(),
        passwordHash: await bcrypt.hash('oldpw', 10),
      };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.changePassword('uuid-1', {
          currentPassword: 'wrongpw',
          newPassword: 'newpassword1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when new password equals current', async () => {
      const user = {
        ...mockUser(),
        passwordHash: await bcrypt.hash('samepw', 10),
      };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.changePassword('uuid-1', {
          currentPassword: 'samepw',
          newPassword: 'samepw',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.changePassword('nope', {
          currentPassword: 'a',
          newPassword: 'b',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('logout', () => {
    it('bumps tokenVersion and blocklists token', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);
      jwtService.decode.mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 100 });

      const result = await service.logout('uuid-1', 'some-token');

      expect(result.message).toBe('Logged out successfully.');
      expect(user.tokenVersion).toBe(1);
      expect(tokenBlocklistService.blocklistToken).toHaveBeenCalledWith(
        'some-token',
        expect.any(Number),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.logout('nope', 'token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('works without a token argument', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.logout('uuid-1');

      expect(result.message).toBe('Logged out successfully.');
    });
  });

  describe('linkWallet', () => {
    it('links a wallet address to the user', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.linkWallet('uuid-1', 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37');

      expect(result.walletAddress).toBe('GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37');
    });

    it('throws BadRequestException for sanctioned address', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      ofacSanctionsCheck.isAddressSanctioned.mockResolvedValue(true);

      await expect(
        service.linkWallet('uuid-1', 'BADADDRESS'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.linkWallet('nope', 'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('handleKycWebhook', () => {
    it('returns updated:false when no user reference in payload', async () => {
      const result = await service.handleKycWebhook({ foo: 'bar' });

      expect(result.updated).toBe(false);
    });

    it('returns updated:false when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const result = await service.handleKycWebhook({ externalUserId: 'nope' });

      expect(result.updated).toBe(false);
    });

    it('updates kycStatus to verified and emits notification', async () => {
      const user = { ...mockUser(), kycStatus: 'pending' };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, kycStatus: 'verified' });

      const result = await service.handleKycWebhook({
        externalUserId: 'uuid-1',
        status: 'approved',
      });

      expect(result.updated).toBe(true);
      expect(result.kycStatus).toBe('verified');
    });

    it('returns updated:false when status is same as current', async () => {
      const user = { ...mockUser(), kycStatus: 'verified' };
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.handleKycWebhook({
        externalUserId: 'uuid-1',
        status: 'approved',
      });

      expect(result.updated).toBe(false);
    });

    it('maps rejected status from reviewResult', async () => {
      const user = { ...mockUser(), kycStatus: 'pending' };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, kycStatus: 'rejected' });

      const result = await service.handleKycWebhook({
        email: 'farmer@example.com',
        reviewResult: { reviewAnswer: 'red' },
      });

      expect(result.updated).toBe(true);
      expect(result.kycStatus).toBe('rejected');
    });
  });

  describe('setupMfa', () => {
    it('generates secret, backup codes, and QR code', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.setupMfa('uuid-1');

      expect(result.secret).toBeDefined();
      expect(result.backupCodes).toHaveLength(8);
      expect(result.qrCodeUrl).toBeDefined();
      expect(user.mfaSecret).toBe(result.secret);
      expect(user.mfaBackupCodes).toHaveLength(8);
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.setupMfa('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('enableMfa', () => {
    it('throws BadRequestException when no mfa secret is set', async () => {
      const user = { ...mockUser(), mfaSecret: null };
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.enableMfa('uuid-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('disableMfa', () => {
    it('throws BadRequestException when MFA is not enabled', async () => {
      const user = { ...mockUser(), isMfaEnabled: false };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.disableMfa('uuid-1', 'token', 'password'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid password', async () => {
      const user = {
        ...mockUser(),
        isMfaEnabled: true,
        mfaSecret: 'secret',
        passwordHash: await bcrypt.hash('correctpw', 10),
      };
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.disableMfa('uuid-1', '123456', 'wrongpw'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifyMfa', () => {
    it('throws BadRequestException when MFA not enabled', async () => {
      const user = { ...mockUser(), isMfaEnabled: false, mfaSecret: null };
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.verifyMfa('uuid-1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ForbiddenException when MFA is locked out', async () => {
      const user = {
        ...mockUser(),
        isMfaEnabled: true,
        mfaSecret: 'secret',
        mfaLockedUntil: new Date(Date.now() + 5 * 60 * 1000),
      };
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.verifyMfa('uuid-1', '123456')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('accepts a valid backup code and removes it (single-use)', async () => {
      const backupCode = 'ABCD1234';
      const hashedCode = await bcrypt.hash(backupCode, 10);
      const user = {
        ...mockUser(),
        isMfaEnabled: true,
        mfaSecret: 'secret',
        mfaBackupCodes: [hashedCode, await bcrypt.hash('EEEE5678', 10)],
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      const result = await service.verifyMfa('uuid-1', backupCode);

      expect(result.valid).toBe(true);
      expect(user.mfaBackupCodes).toHaveLength(1);
    });

    it('increments failed attempts and locks after max attempts', async () => {
      const user = {
        ...mockUser(),
        isMfaEnabled: true,
        mfaSecret: 'secret',
        mfaBackupCodes: null,
        mfaFailedAttempts: 4,
      };
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      await expect(service.verifyMfa('uuid-1', 'wrongcode')).rejects.toThrow(
        BadRequestException,
      );

      expect(user.mfaLockedUntil).toBeDefined();
      expect(user.mfaFailedAttempts).toBe(0);
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.verifyMfa('nope', '123456')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateUserRole', () => {
    it('updates role and bumps tokenVersion', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue({ ...user, role: 'trader', tokenVersion: 1 });

      const result = await service.updateUserRole('uuid-1', 'trader');

      expect(result.role).toBe('trader');
      expect(user.tokenVersion).toBe(1);
    });

    it('records admin action when adminId provided', async () => {
      const user = mockUser();
      userRepo.findOne.mockResolvedValue(user);
      userRepo.save.mockResolvedValue(user);

      await service.updateUserRole('uuid-1', 'trader', 'admin-id', 'reason');

      expect(adminActionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-id',
          action: 'update_user_role',
        }),
      );
    });

    it('throws NotFoundException when user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.updateUserRole('nope', 'trader')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generateSep10Challenge', () => {
    it('throws BadRequestException for invalid public key', async () => {
      await expect(
        service.generateSep10Challenge('invalid-key'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ServiceUnavailableException when Redis is unavailable (fail-closed)', async () => {
      service.setRedisClient(null);
      const clientKeypair = Keypair.random();
      await expect(
        service.generateSep10Challenge(clientKeypair.publicKey()),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('stores challenge in Redis with 300s TTL and expected payload', async () => {
      const redisStore = new Map<string, string>();
      const mockRedis: any = {
        isOpen: true,
        connect: jest.fn().mockResolvedValue(undefined),
        setEx: jest.fn(async (key: string, ttl: number, val: string) => {
          expect(ttl).toBe(300);
          redisStore.set(key, val);
          return 'OK';
        }),
        get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
        del: jest.fn(async (key: string) => {
          redisStore.delete(key);
          return 1;
        }),
      };

      service.setRedisClient(mockRedis);
      const clientKeypair = Keypair.random();
      const res = await service.generateSep10Challenge(clientKeypair.publicKey());

      expect(res.transactionXdr).toBeDefined();
      expect(mockRedis.setEx).toHaveBeenCalledWith(
        `sep10:challenge:${clientKeypair.publicKey()}`,
        300,
        expect.any(String),
      );

      const savedData = JSON.parse(
        redisStore.get(`sep10:challenge:${clientKeypair.publicKey()}`)!,
      );
      expect(savedData.nonce).toBeDefined();
      expect(savedData.transactionXdr).toBe(res.transactionXdr);
    });
  });

  describe('validateSep10Response', () => {
    it('throws UnauthorizedException for invalid XDR', async () => {
      await expect(
        service.validateSep10Response('invalid-xdr'),
      ).rejects.toThrow('Invalid SEP-10 response XDR');
    });

    it('throws ServiceUnavailableException when Redis is down during validation', async () => {
      service.setRedisClient(null);
      const clientKeypair = Keypair.random();
      const serverKeypair = Keypair.random();

      // Build a valid envelope structure
      const tx = new Transaction(
        'AAAAAgAAAAAAAAAAAAAAACAAAAAAAAAAAQAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAALAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAA',
        Networks.TESTNET,
      );

      // When Redis is down, validation must fail closed
      await expect(service.validateSep10Response(tx.toEnvelope().toXDR('base64'))).rejects.toThrow();
    });

    it('throws UnauthorizedException if challenge not in Redis or expired', async () => {
      const mockRedis: any = {
        isOpen: true,
        connect: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue(null),
        del: jest.fn().mockResolvedValue(0),
      };
      service.setRedisClient(mockRedis);

      const clientKeypair = Keypair.random();
      const res = await (async () => {
        const memStore = new Map<string, string>();
        const genRedis: any = {
          isOpen: true,
          connect: jest.fn().mockResolvedValue(undefined),
          setEx: jest.fn(async (k: string, ttl: number, v: string) => {
            memStore.set(k, v);
          }),
        };
        service.setRedisClient(genRedis);
        return service.generateSep10Challenge(clientKeypair.publicKey());
      })();

      const clientTx = new Transaction(res.transactionXdr, Networks.TESTNET);
      clientTx.sign(clientKeypair);

      // Switch back to Redis mock with missing key
      service.setRedisClient(mockRedis);
      await expect(
        service.validateSep10Response(clientTx.toEnvelope().toXDR('base64')),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('validates across independent service instances sharing Redis (multi-instance support)', async () => {
      const sharedRedisStore = new Map<string, string>();
      const sharedRedisClient: any = {
        isOpen: true,
        connect: jest.fn().mockResolvedValue(undefined),
        setEx: jest.fn(async (key: string, ttl: number, val: string) => {
          sharedRedisStore.set(key, val);
          return 'OK';
        }),
        get: jest.fn(async (key: string) => sharedRedisStore.get(key) ?? null),
        del: jest.fn(async (key: string) => {
          sharedRedisStore.delete(key);
          return 1;
        }),
      };

      // Instance 1 generates the challenge
      service.setRedisClient(sharedRedisClient);
      const clientKeypair = Keypair.random();
      const challenge = await service.generateSep10Challenge(clientKeypair.publicKey());
      expect(sharedRedisStore.has(`sep10:challenge:${clientKeypair.publicKey()}`)).toBe(true);

      // Client signs the challenge
      const clientTx = new Transaction(challenge.transactionXdr, Networks.TESTNET);
      clientTx.sign(clientKeypair);

      // Instance 2 (simulate by another service or resetting internal state)
      // verifies with the same shared Redis
      userRepo.findOne.mockResolvedValue(mockUser());
      jwtService.sign.mockReturnValue('jwt-token-123');

      const result = await service.validateSep10Response(
        clientTx.toEnvelope().toXDR('base64'),
      );
      expect(result).toBeDefined();
      expect(result.publicKey).toBe(clientKeypair.publicKey());

      // Challenge is deleted from Redis (single-use)
      expect(sharedRedisStore.has(`sep10:challenge:${clientKeypair.publicKey()}`)).toBe(false);
    });
  });

  describe('revokeSession', () => {
    it('throws BadRequestException for invalid revoke token', async () => {
      // findUserByRevokeToken returns null via loginLogRepo query builder mock
      const qb: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      (loginLogRepo as any).createQueryBuilder = jest.fn().mockReturnValue(qb);

      await expect(service.revokeSession('bad-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
