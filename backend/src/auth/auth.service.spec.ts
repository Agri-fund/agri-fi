import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { QueueService } from '../queue/queue.service';

const mockUser = (): User => ({
  id: 'uuid-1',
  email: 'farmer@example.com',
  passwordHash: '',
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
  let jwtService: { sign: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };
    kycRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('token') };
    configService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: QueueService, useValue: { emit: jest.fn() } },
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
    let loginLogRepo: { create: jest.Mock; save: jest.Mock };

    beforeEach(() => {
      loginLogRepo = { create: jest.fn(), save: jest.fn() };
      // Update the service to use the mock loginLogRepo
      (service as any).loginLogRepo = loginLogRepo;
    });

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
});
