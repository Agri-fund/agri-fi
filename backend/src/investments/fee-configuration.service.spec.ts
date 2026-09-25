import { FeeConfigurationService } from './fee-configuration.service';
import { FeeType, InvestorTier } from '../database/entities/fee-configuration.entity';

describe('FeeConfigurationService', () => {
  let service: FeeConfigurationService;
  let feeConfigRepo: any;

  beforeEach(() => {
    feeConfigRepo = {
      find: jest.fn(),
    };
    service = new FeeConfigurationService(feeConfigRepo);
  });

  it('converts the active platform origination percentage to bps', async () => {
    feeConfigRepo.find.mockResolvedValue([
      {
        ratePercent: 2.5,
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        feeType: FeeType.PLATFORM_ORIGINATION,
      },
    ]);

    await expect(service.getPlatformOriginationFeeBps('Cocoa')).resolves.toBe(250);
    expect(feeConfigRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.arrayContaining([
          expect.objectContaining({
            dealType: 'Cocoa',
            investorTier: InvestorTier.RETAIL,
            feeType: FeeType.PLATFORM_ORIGINATION,
          }),
        ]),
        take: 1,
      }),
    );
  });

  it('rejects a missing active platform origination configuration', async () => {
    feeConfigRepo.find.mockResolvedValue([]);

    await expect(service.getPlatformOriginationFeeBps('Cocoa')).rejects.toThrow(
      'No active platform origination fee configuration found for Cocoa',
    );
  });

  it('rejects a converted fee above the shared cap', async () => {
    feeConfigRepo.find.mockResolvedValue([{ ratePercent: 101 }]);

    await expect(service.getPlatformOriginationFeeBps('Cocoa')).rejects.toThrow(
      'Platform origination fee must be between 0 and 10000 bps',
    );
  });
});
