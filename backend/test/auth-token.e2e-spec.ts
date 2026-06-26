import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { KycSubmission } from '../src/auth/entities/kyc-submission.entity';
import { User } from '../src/auth/entities/user.entity';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { QueueService } from '../src/queue/queue.service';

const TEST_EMAIL = 'token-e2e@agri-fi.test';
const TEST_PASSWORD = 'Passw0rd!';

describe('Auth token expiration and renewal (E2E)', () => {
  let app: INestApplication;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };
  let testUser: User;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    testUser = {
      id: 'e0000000-0000-0000-0000-000000000001',
      email: TEST_EMAIL,
      passwordHash,
      role: 'investor',
      country: 'NG',
      kycStatus: 'verified',
      tokenVersion: 0,
      walletAddress: null,
      isCompany: false,
      companyDetails: null,
      createdAt: new Date(),
      fullName: null,
      birthdate: null,
      taxId: null,
    };

    userRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((user: User) => Promise.resolve(user)),
    };

    userRepo.findOne.mockImplementation(
      ({ where }: { where: Partial<User> }) => {
        if (where.email === testUser.email || where.id === testUser.id) {
          return Promise.resolve(testUser);
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
              JWT_SECRET: 'auth-token-e2e-secret',
              JWT_ACCESS_EXPIRES_IN: '1s',
              JWT_REFRESH_EXPIRES_IN: '1h',
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            secret: config.get<string>('JWT_SECRET', 'auth-token-e2e-secret'),
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: QueueService, useValue: { emit: jest.fn() } },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(KycSubmission),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  const login = async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    return response;
  };

  it('returns 401 when a protected endpoint is called with an expired access token', async () => {
    const { body } = await login();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 1500));

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(401);
  });

  it('returns a new access token when a valid refresh token is submitted', async () => {
    const { body: loginBody } = await login();

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: loginBody.refreshToken });

    expect(refreshResponse.status).toBeGreaterThanOrEqual(200);
    expect(refreshResponse.status).toBeLessThan(300);

    const { body: refreshBody } = refreshResponse;
    expect(refreshBody.accessToken).toBeDefined();
    expect(refreshBody.refreshToken).toBeDefined();

    const logoutResponse = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${refreshBody.accessToken}`);

    expect(logoutResponse.status).toBeGreaterThanOrEqual(200);
    expect(logoutResponse.status).toBeLessThan(300);
  });
});
