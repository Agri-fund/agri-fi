import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { KycSubmission } from './entities/kyc-submission.entity';

const mockUser = (): User => ({
  id: 'uuid-1',
  email: 'farmer@example.com',
  passwordHash: '',
  role: 'farmer',
  country: 'NG',
  kycStatus: 'pending',
  walletAddress: null,
  createdAt: new Date(),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let kycRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let jwtService: { sign: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
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
});
