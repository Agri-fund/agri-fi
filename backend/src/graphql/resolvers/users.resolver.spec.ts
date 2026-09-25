/**
 * Unit tests for UsersResolver.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersResolver } from './users.resolver';
import { User } from '../../auth/entities/user.entity';

const mockUserEntity = {
  id: 'user-uuid',
  email: 'farmer@test.com',
  role: 'farmer',
  country: 'KE',
  kycStatus: 'verified',
  walletAddress: null,
  isCompany: false,
  isEmailVerified: true,
  isMfaEnabled: false,
  creditScore: null,
  preferredLanguage: 'en',
  timezone: 'Africa/Nairobi',
  emailDigestEnabled: true,
  createdAt: new Date('2026-01-01'),
} as unknown as User;

const mockAdminUser = {
  ...mockUserEntity,
  id: 'admin-uuid',
  email: 'admin@test.com',
  role: 'admin',
} as unknown as User;

const userRepoMock = {
  findOne: jest.fn(),
};

describe('UsersResolver', () => {
  let resolver: UsersResolver;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersResolver,
        { provide: getRepositoryToken(User), useValue: userRepoMock },
      ],
    }).compile();

    resolver = module.get<UsersResolver>(UsersResolver);
    jest.clearAllMocks();
  });

  describe('user(id)', () => {
    it('should return own profile for non-admin user', async () => {
      userRepoMock.findOne.mockResolvedValue(mockUserEntity);

      const result = await resolver.user('user-uuid', mockUserEntity);

      expect(result.id).toBe('user-uuid');
      expect(result.email).toBe('farmer@test.com');
    });

    it('should allow admin to look up any user', async () => {
      userRepoMock.findOne.mockResolvedValue(mockUserEntity);

      const result = await resolver.user('user-uuid', mockAdminUser);

      expect(result.id).toBe('user-uuid');
    });

    it('should throw ForbiddenException when non-admin fetches another user', async () => {
      await expect(
        resolver.user('other-user-uuid', mockUserEntity),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      userRepoMock.findOne.mockResolvedValue(null);

      await expect(
        resolver.user('user-uuid', mockAdminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('should not expose sensitive fields (passwordHash, mfaSecret, etc.)', async () => {
      const entityWithSecrets = {
        ...mockUserEntity,
        passwordHash: 'hashed-password',
        mfaSecret: 'totp-secret',
        taxId: '123456789',
      } as any;
      userRepoMock.findOne.mockResolvedValue(entityWithSecrets);

      const result = await resolver.user('user-uuid', mockUserEntity);

      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).mfaSecret).toBeUndefined();
      expect((result as any).taxId).toBeUndefined();
    });
  });
});
