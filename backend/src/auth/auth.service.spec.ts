import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  hash: jest.fn().mockResolvedValue('hashed-password'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('argon2-hashed'),
  verify: jest.fn().mockResolvedValue(true),
}));
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';
import { QueueService } from '../queue/queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OfacSanctionsCheckService } from './utils/ofac-sanctions-check';
import { TokenBlocklistService } from './token-blocklist.service';
import { LoginLog } from '../database/entities/login-log.entity';
import { AdminAction } from '../database/entities/admin-action.entity';

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
  let notificationsService: { sendEmail: jest.Mock };

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
    };
    kycRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('token') };
    configService = {
      get: jest.fn((key: string, defaultVal?: string) => {
        if (key === 'STELLAR_NETWORK') return 'testnet';
        if (key === 'SEP10_SIGNING_SECRET') return '';
        if (key === 'SEP10_DOMAIN') return 'agri-fi.com';
        if (key === 'APP_BASE_URL') return 'http://localhost:3001';
        return defaultVal ?? '';
      }),
    };
    notificationsService = {
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        {
          provide: getRepositoryToken(LoginLog),
          useValue: { save: jest.fn() },
        },
        {
          provide: getRepositoryToken(AdminAction),
          useValue: {
            save: jest.fn(),
            create: jest.fn((value) => value),
          },
        },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: QueueService, useValue: { emit: jest.fn() } },
        { provide: NotificationsService, useValue: notificationsService },
        {
          provide: OfacSanctionsCheckService,
          useValue: { isAddressSanctioned: jest.fn().mockResolvedValue(false) },
        },
        {
          provide: TokenBlocklistService,
          useValue: { isBlocked: jest.fn(), block: jest.fn() },
        },
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
      configService.get.mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === 'KYC_AUTO_APPROVE') return 'false';
          if (key === 'STELLAR_NETWORK') return 'testnet';
          return defaultVal ?? '';
        },
      );

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
      configService.get.mockImplementation(
        (key: string, defaultVal?: string) => {
          if (key === 'KYC_AUTO_APPROVE') return 'true';
          if (key === 'STELLAR_NETWORK') return 'testnet';
          return defaultVal ?? '';
        },
      );

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

      const result = await service.approveKyc('uuid-1', 'admin-1');

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

      await expect(service.approveKyc('uuid-1', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
