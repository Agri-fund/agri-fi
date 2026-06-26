import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  const usersServiceMock = {
    getProfile: jest.fn(),
    getUserDeals: jest.fn(),
    getUserInvestments: jest.fn(),
  };
  const tradeDealsServiceMock = {
    findByUser: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tradeDealsServiceMock.findByUser.mockReset();
    controller = new UsersController(
      usersServiceMock as unknown as UsersService,
      tradeDealsServiceMock as any,
    );
  });

  describe('getCurrentUser', () => {
    it('returns profile without passwordHash', async () => {
      const safeProfile = {
        id: 'user-1',
        email: 'farmer@example.com',
        role: 'farmer',
        kycStatus: 'verified',
        walletAddress: 'GTESTWALLET',
        isCompany: false,
        companyDetails: null,
        country: 'GH',
        createdAt: new Date('2026-01-01'),
      };
      usersServiceMock.getProfile.mockResolvedValue(safeProfile);

      const result = await controller.getCurrentUser({
        user: { id: 'user-1' },
      } as any);

      expect(usersServiceMock.getProfile).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(safeProfile);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('password_hash');
    });
  });

  describe('getUserDeals', () => {
    it('returns deals for farmer when role is farmer', async () => {
      const expected = [{ id: 'deal-f-1' }];
      usersServiceMock.getUserDeals.mockResolvedValue(expected);
      tradeDealsServiceMock.findByUser.mockResolvedValue(expected);
    });

    it('returns deals for trader when role is trader and no query role is provided', async () => {
      const expected = [{ id: 'deal-t-1' }];
      usersServiceMock.getUserDeals.mockResolvedValue(expected);
      tradeDealsServiceMock.findByUser.mockResolvedValue(expected);
    });

    it('rejects users who are not farmer/trader', async () => {
      const req = { user: { id: 'investor-1', role: 'investor' } };

      await expect(controller.getUserDeals(req as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersServiceMock.getUserDeals).not.toHaveBeenCalled();
    });

    it('rejects invalid role query values', async () => {
      const req = { user: { id: 'farmer-1', role: 'farmer' } };

      await expect(
        controller.getUserDeals(req as any, 'admin'),
      ).rejects.toThrow(BadRequestException);
      expect(usersServiceMock.getUserDeals).not.toHaveBeenCalled();
    });

    it('rejects role query when it does not match authenticated role', async () => {
      const req = { user: { id: 'farmer-1', role: 'farmer' } };

      await expect(
        controller.getUserDeals(req as any, 'trader'),
      ).rejects.toThrow(ForbiddenException);
      expect(usersServiceMock.getUserDeals).not.toHaveBeenCalled();
    });
  });
});
