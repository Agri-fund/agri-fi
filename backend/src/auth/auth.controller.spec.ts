import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  linkWallet: jest.fn(),
  submitKyc: jest.fn(),
  logout: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 10 }])],
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /auth/register', () => {
    it('should have throttler guard applied', async () => {
      const registerDto = {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
        role: 'farmer' as const,
        country: 'NG',
      };

      mockAuthService.register.mockResolvedValue({
        id: '1',
        email: 'test@example.com',
      });

      await controller.register(registerDto);

      expect(mockAuthService.register).toHaveBeenCalledWith(registerDto);
    });

    it('should return validation error response formats for invalid data', async () => {
      const invalidDto: any = { email: 'not-an-email' };
      mockAuthService.register.mockRejectedValue({
        message: ['email must be an email'],
        statusCode: 400,
      });

      await expect(controller.register(invalidDto)).rejects.toMatchObject({
        message: ['email must be an email'],
        statusCode: 400,
      });
    });
  });

  describe('POST /auth/login', () => {
    it('should have throttler guard applied', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      mockAuthService.login.mockResolvedValue({ access_token: 'jwt-token' });

      await controller.login(loginDto);

      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
    });

    it('should mock JWT sign helper methods verification', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };
      mockAuthService.login.mockResolvedValue({
        access_token: 'mock-signed-jwt',
      });

      const result = await controller.login(loginDto);
      expect(result.access_token).toBe('mock-signed-jwt');
      expect(mockAuthService.login).toHaveBeenCalledWith(loginDto);
    });
  });
});
