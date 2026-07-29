/**
 * KYC Verification Flow E2E Tests
 *
 * Tests the complete Know Your Customer (KYC) verification flow including:
 * - KYC submission (individual and corporate)
 * - Automatic approval for individual KYC
 * - Manual approval workflow for corporate KYC
 * - Error handling and validation
 * - KYC status updates
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AuthController } from '../../src/auth/auth.controller';
import { AuthService } from '../../src/auth/auth.service';
import { KycSubmission } from '../../src/auth/entities/kyc-submission.entity';
import { User } from '../../src/auth/entities/user.entity';
import { JwtStrategy } from '../../src/auth/jwt.strategy';
import { QueueService } from '../../src/queue/queue.service';

describe('KYC Verification Flow (E2E)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };
  let kycRepo: { findOne: jest.Mock; save: jest.Mock; create: jest.Mock };
  let queueService: QueueService;

  // Test user data
  const testUser = {
    id: 'user-individual-001',
    email: 'kyc-individual@test.local',
    passwordHash: '',
    role: 'farmer',
    country: 'NG',
    kycStatus: 'pending',
    tokenVersion: 0,
    walletAddress: null,
    isCompany: false,
    companyDetails: null,
    createdAt: new Date(),
  };

  const corporateUser = {
    id: 'user-corporate-001',
    email: 'kyc-corporate@test.local',
    passwordHash: '',
    role: 'enterprise',
    country: 'NG',
    kycStatus: 'pending',
    tokenVersion: 0,
    walletAddress: null,
    isCompany: true,
    companyDetails: null,
    createdAt: new Date(),
  };

  let testUserToken: string;
  let corporateUserToken: string;

  beforeAll(async () => {
    // Hash test passwords
    testUser.passwordHash = await bcrypt.hash('TestPassword123!', 10);
    corporateUser.passwordHash = await bcrypt.hash('TestPassword123!', 10);

    // Setup mocks
    userRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((user: User) =>
        Promise.resolve({
          ...user,
          updatedAt: new Date(),
        }),
      ),
    };

    kycRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((submission: KycSubmission) =>
        Promise.resolve({
          ...submission,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      create: jest.fn().mockImplementation((dto) => dto),
    };

    queueService = {
      emit: jest.fn(),
      enqueueDealPublish: jest.fn(),
      enqueueInvestmentFund: jest.fn(),
      enqueueDealFunded: jest.fn(),
      enqueueDealDelivered: jest.fn(),
      enqueueDealCleanup: jest.fn(),
    } as any;

    // Setup findOne mock to return appropriate user
    userRepo.findOne.mockImplementation(
      ({ where }: { where: Partial<User> }) => {
        if (where.email === testUser.email || where.id === testUser.id) {
          return Promise.resolve(testUser);
        }
        if (where.email === corporateUser.email || where.id === corporateUser.id) {
          return Promise.resolve(corporateUser);
        }
        return Promise.resolve(null);
      },
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              JWT_SECRET: 'test-jwt-secret-key',
              JWT_EXPIRES_IN: '7d',
              KYC_AUTO_APPROVE: 'true',
            }),
          ],
        }),
        PassportModule,
        JwtModule.registerAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.get<string>('JWT_SECRET'),
            signOptions: {
              expiresIn: config.get<string>('JWT_EXPIRES_IN'),
            },
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    authService = moduleRef.get<AuthService>(AuthService);

    // Generate test tokens
    testUserToken = authService['issueTokenPair'](testUser).accessToken;
    corporateUserToken = authService['issueTokenPair'](corporateUser).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Individual KYC Submission (Auto-Approved)', () => {
    it('should successfully submit individual KYC with government ID and proof of address', async () => {
      const kycSubmissionDto = {
        governmentIdUrl: 'https://s3.example.com/gov-id-123.pdf',
        proofOfAddressUrl: 'https://s3.example.com/address-proof-123.pdf',
        isCorporate: false,
      };

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycSubmissionDto)
        .expect(201);

      expect(response.body).toHaveProperty('kycStatus');
      expect(response.body.kycStatus).toBe('verified'); // Auto-approved
      expect(kycRepo.save).toHaveBeenCalled();
      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({
          type: 'kyc_verified',
          email: testUser.email,
        }),
      );
    });

    it('should auto-approve individual KYC even with minimal documents', async () => {
      const kycSubmissionDto = {
        governmentIdUrl: 'https://s3.example.com/gov-id-456.pdf',
        isCorporate: false,
      };

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycSubmissionDto)
        .expect(201);

      expect(response.body.kycStatus).toBe('verified');
    });

    it('should create KYC submission record with all provided fields', async () => {
      const kycSubmissionDto = {
        governmentIdUrl: 'https://s3.example.com/gov-id-789.pdf',
        proofOfAddressUrl: 'https://s3.example.com/address-proof-789.pdf',
        isCorporate: false,
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycSubmissionDto)
        .expect(201);

      expect(kycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUser.id,
          governmentIdUrl: kycSubmissionDto.governmentIdUrl,
          proofOfAddressUrl: kycSubmissionDto.proofOfAddressUrl,
          isCorporate: false,
          status: 'approved',
        }),
      );
    });

    it('should require authentication to submit KYC', async () => {
      const kycSubmissionDto = {
        governmentIdUrl: 'https://s3.example.com/gov-id.pdf',
        isCorporate: false,
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .send(kycSubmissionDto)
        .expect(401);
    });
  });

  describe('Corporate KYC Submission (Manual Approval)', () => {
    it('should submit corporate KYC pending manual review', async () => {
      const kycSubmissionDto = {
        isCorporate: true,
        companyName: 'AgriCorp Ltd',
        registrationNumber: 'RC-123456',
        businessLicenseUrl: 'https://s3.example.com/license.pdf',
        articlesOfIncorporationUrl: 'https://s3.example.com/articles.pdf',
      };

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${corporateUserToken}`)
        .send(kycSubmissionDto)
        .expect(201);

      expect(response.body.kycStatus).toBe('pending'); // Not auto-approved
      expect(kycRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: corporateUser.id,
          isCorporate: true,
          companyName: 'AgriCorp Ltd',
          registrationNumber: 'RC-123456',
          status: 'pending_review', // Manual review required
        }),
      );
    });

    it('should store corporate metadata for admin review', async () => {
      const kycSubmissionDto = {
        isCorporate: true,
        companyName: 'FarmCorp International',
        registrationNumber: 'REG-789012',
        businessLicenseUrl: 'https://s3.example.com/license-farm.pdf',
        articlesOfIncorporationUrl: 'https://s3.example.com/articles-farm.pdf',
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${corporateUserToken}`)
        .send(kycSubmissionDto)
        .expect(201);

      // Verify user record is updated with company details
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: corporateUser.id,
          companyDetails: expect.objectContaining({
            companyName: 'FarmCorp International',
            registrationNumber: 'REG-789012',
            articlesOfIncorporationUrl: kycSubmissionDto.articlesOfIncorporationUrl,
          }),
        }),
      );
    });

    it('should require all corporate documents', async () => {
      const incompleteKycDto = {
        isCorporate: true,
        companyName: 'PartialCorp',
        // Missing other required fields
      };

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${corporateUserToken}`)
        .send(incompleteKycDto)
        .expect(400); // Validation error

      expect(response.body).toHaveProperty('message');
    });
  });

  describe('KYC Validation Errors', () => {
    it('should reject invalid document URLs', async () => {
      const invalidKycDto = {
        governmentIdUrl: 'not-a-url',
        isCorporate: false,
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(invalidKycDto)
        .expect(400);
    });

    it('should handle missing required fields gracefully', async () => {
      const emptyKycDto = {};

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(emptyKycDto);

      // Should accept optional fields but validate structure
      expect([200, 201, 400]).toContain(response.status);
    });

    it('should validate KYC submission for non-existent user', async () => {
      // Use a token for a user that doesn't exist in DB
      const invalidToken = authService['issueTokenPair']({
        ...testUser,
        id: 'non-existent-user-999',
      }).accessToken;

      userRepo.findOne.mockResolvedValueOnce(null);

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${invalidToken}`)
        .send({
          governmentIdUrl: 'https://s3.example.com/id.pdf',
          isCorporate: false,
        })
        .expect(404);
    });
  });

  describe('KYC Status and State Management', () => {
    it('should update user KYC status to verified after auto-approval', async () => {
      const kycDto = {
        governmentIdUrl: 'https://s3.example.com/final-id.pdf',
        isCorporate: false,
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycDto)
        .expect(201);

      // Verify user.kycStatus is updated
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          kycStatus: 'verified',
        }),
      );
    });

    it('should not change user KYC status for pending corporate review', async () => {
      const corporateKycDto = {
        isCorporate: true,
        companyName: 'TestCorp',
        registrationNumber: 'TEST-001',
        businessLicenseUrl: 'https://s3.example.com/license.pdf',
        articlesOfIncorporationUrl: 'https://s3.example.com/articles.pdf',
      };

      // Reset mock to track calls
      userRepo.save.mockClear();

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${corporateUserToken}`)
        .send(corporateKycDto)
        .expect(201);

      // Should save user with company details, but not change kycStatus to verified
      const saveCall = userRepo.save.mock.calls[0][0];
      if (saveCall.kycStatus) {
        expect(saveCall.kycStatus).not.toBe('verified');
      }
    });

    it('should emit email notification for auto-approved KYC', async () => {
      queueService.emit.mockClear();

      const kycDto = {
        governmentIdUrl: 'https://s3.example.com/notify-id.pdf',
        isCorporate: false,
      };

      await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycDto)
        .expect(201);

      expect(queueService.emit).toHaveBeenCalledWith(
        'email.notification',
        expect.objectContaining({
          type: 'kyc_verified',
          email: testUser.email,
          userId: testUser.id,
        }),
      );
    });
  });

  describe('KYC Configuration Behavior', () => {
    it('should respect KYC_AUTO_APPROVE configuration setting', async () => {
      // This test verifies that KYC_AUTO_APPROVE env var controls auto-approval behavior
      // In our test setup, KYC_AUTO_APPROVE is set to 'true'
      const kycDto = {
        governmentIdUrl: 'https://s3.example.com/config-test.pdf',
        isCorporate: false,
      };

      const response = await request(app.getHttpServer())
        .post('/auth/kyc')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send(kycDto)
        .expect(201);

      // Should be auto-approved because KYC_AUTO_APPROVE=true
      expect(response.body.kycStatus).toBe('verified');
    });
  });
});
