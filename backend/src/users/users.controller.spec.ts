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

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(usersServiceMock as unknown as UsersService);
  });

  describe('getUserDeals', () => {
    it('returns deals for farmer when role is farmer', async () => {
      const expected = [{ id: 'deal-f-1' }];
      usersServiceMock.getUserDeals.mockResolvedValue(expected);
      const req = { user: { id: 'farmer-1', role: 'farmer' } };

      const result = await controller.getUserDeals(req as any, 'farmer');

      expect(result).toEqual(expected);
      expect(usersServiceMock.getUserDeals).toHaveBeenCalledWith(
        'farmer-1',
        'farmer',
      );
    });

    it('returns deals for trader when role is trader and no query role is provided', async () => {
      const expected = [{ id: 'deal-t-1' }];
      usersServiceMock.getUserDeals.mockResolvedValue(expected);
      const req = { user: { id: 'trader-1', role: 'trader' } };

      const result = await controller.getUserDeals(req as any);

      expect(result).toEqual(expected);
      expect(usersServiceMock.getUserDeals).toHaveBeenCalledWith(
        'trader-1',
        'trader',
      );
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

      await expect(controller.getUserDeals(req as any, 'admin')).rejects.toThrow(
        BadRequestException,
      );
      expect(usersServiceMock.getUserDeals).not.toHaveBeenCalled();
    });

    it('rejects role query when it does not match authenticated role', async () => {
      const req = { user: { id: 'farmer-1', role: 'farmer' } };

      await expect(controller.getUserDeals(req as any, 'trader')).rejects.toThrow(
        ForbiddenException,
      );
      expect(usersServiceMock.getUserDeals).not.toHaveBeenCalled();
    });
  });
});
