import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeeCalculatorService } from './fee-calculator.service';
import {
  FeeConfiguration,
  FeeType,
  InvestorTier,
} from '../database/entities/fee-configuration.entity';
import { User } from '../auth/entities/user.entity';

describe('FeeCalculatorService', () => {
  let service: FeeCalculatorService;
  let feeConfigRepo: Repository<FeeConfiguration>;

  const mockFeeConfigurations = (): FeeConfiguration[] => [
    {
      id: 'fee-1',
      dealType: 'Cocoa',
      investorTier: InvestorTier.RETAIL,
      feeType: FeeType.PLATFORM_ORIGINATION,
      ratePercent: 2.0,
      description: 'Platform origination fee',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'fee-2',
      dealType: 'Cocoa',
      investorTier: InvestorTier.RETAIL,
      feeType: FeeType.PLATFORM_SUCCESS,
      ratePercent: 0.5,
      description: 'Platform success fee',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'fee-3',
      dealType: 'Cocoa',
      investorTier: InvestorTier.RETAIL,
      feeType: FeeType.INVESTOR_ENTRY,
      ratePercent: 1.0,
      description: 'Investor entry fee (retail)',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    {
      id: 'fee-4',
      dealType: 'Cocoa',
      investorTier: InvestorTier.RETAIL,
      feeType: FeeType.EARLY_EXIT,
      ratePercent: 2.0,
      description: 'Early exit penalty',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    // VIP tier (lower fees)
    {
      id: 'fee-5',
      dealType: 'Cocoa',
      investorTier: InvestorTier.VIP,
      feeType: FeeType.INVESTOR_ENTRY,
      ratePercent: 0.5,
      description: 'Investor entry fee (VIP)',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
    // Institutional tier (no entry fee)
    {
      id: 'fee-6',
      dealType: 'Cocoa',
      investorTier: InvestorTier.INSTITUTIONAL,
      feeType: FeeType.INVESTOR_ENTRY,
      ratePercent: 0.0,
      description: 'Investor entry fee (institutional)',
      effectiveFrom: new Date('2024-01-01'),
      effectiveTo: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCalculatorService,
        {
          provide: getRepositoryToken(FeeConfiguration),
          useValue: {
            find: jest.fn(),
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FeeCalculatorService>(FeeCalculatorService);
    feeConfigRepo = module.get<Repository<FeeConfiguration>>(
      getRepositoryToken(FeeConfiguration),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateFeeBreakdown', () => {
    it('should calculate complete fee breakdown for retail investor', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      expect(result.grossAmount).toBe(10000);
      expect(result.breakdown.length).toBe(3); // 3 active non-early-exit fee types
      expect(result.platformOriginationFee?.amount).toBe(200); // 2% of 10000
      expect(result.investorEntryFee?.amount).toBe(100); // 1% of 10000
      expect(result.platformSuccessFee?.amount).toBe(50); // 0.5% of 10000
      expect(result.totalFees).toBe(350);
      expect(result.netInvestmentAmount).toBe(9900); // 10000 - 100 entry fee
    });

    it('should apply lower fees for VIP tier', async () => {
      const configs = [
        mockFeeConfigurations()[0], // Platform origination 2%
        mockFeeConfigurations()[1], // Platform success 0.5%
        mockFeeConfigurations()[4], // VIP entry 0.5%
        mockFeeConfigurations()[3], // Early exit 2%
      ];
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.VIP,
        grossAmount: 10000,
      });

      expect(result.investorEntryFee?.amount).toBe(50); // 0.5% vs 1% for retail
      expect(result.totalFees).toBe(300); // 200 + 50 + 50 (no early exit)
    });

    it('should apply zero entry fee for institutional tier', async () => {
      const configs = [
        mockFeeConfigurations()[0], // Platform origination 2%
        mockFeeConfigurations()[1], // Platform success 0.5%
        mockFeeConfigurations()[5], // Institutional entry 0%
      ];
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.INSTITUTIONAL,
        grossAmount: 10000,
      });

      expect(result.investorEntryFee?.amount).toBe(0);
      expect(result.netInvestmentAmount).toBe(10000); // No entry fee deduction
    });

    it('should calculate early exit fee when isEarlyExit is true', async () => {
      const configs = [mockFeeConfigurations()[3]]; // Only early exit fee
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 5000,
        isEarlyExit: true,
      });

      expect(result.breakdown.length).toBe(1);
      expect(result.earlyExitFee?.amount).toBe(100); // 2% of 5000
      expect(result.totalFees).toBe(100);
    });

    it('should skip early exit fee when not early exit scenario', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
        isEarlyExit: false,
      });

      expect(result.earlyExitFee).toBeNull();
      expect(result.breakdown.every((f) => f.type !== FeeType.EARLY_EXIT)).toBe(
        true,
      );
    });

    it('should round fees to 2 decimal places', async () => {
      const configs = [
        {
          ...mockFeeConfigurations()[0],
          ratePercent: 2.333, // Should produce fractional cent
        },
      ];
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      const expectedAmount = Math.round(((10000 * 2.333) / 100) * 100) / 100;
      expect(result.platformOriginationFee?.amount).toBe(expectedAmount);
      // Verify no floating point errors
      expect(
        result.platformOriginationFee?.amount.toString().split('.')[1]?.length,
      ).toBeLessThanOrEqual(2);
    });

    it('should throw error when no fee configuration found', async () => {
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue([]);

      await expect(
        service.calculateFeeBreakdown({
          dealType: 'UnknownCommodity',
          investorTier: InvestorTier.RETAIL,
          grossAmount: 10000,
        }),
      ).rejects.toThrow('No fee configuration found');
    });

    it('should handle reference date parameter', async () => {
      const futureDate = new Date('2025-06-01');
      const configs = mockFeeConfigurations();
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
        referenceDate: futureDate,
      });

      expect(feeConfigRepo.find).toHaveBeenCalled();
    });

    it('should handle zero investment amount', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 0,
      });

      expect(result.grossAmount).toBe(0);
      expect(result.totalFees).toBe(0);
      expect(result.netInvestmentAmount).toBe(0);
    });

    it('should handle large investment amounts', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const largeAmount = 1000000;
      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: largeAmount,
      });

      expect(result.platformOriginationFee?.amount).toBe(20000); // 2% of 1M
      expect(result.investorEntryFee?.amount).toBe(10000); // 1% of 1M
      expect(result.netInvestmentAmount).toBe(990000);
    });
  });

  describe('getInvestorTierFromUser', () => {
    it('should return institutional for admin users', () => {
      const adminUser = { role: 'admin' } as User;
      const tier = service.getInvestorTierFromUser(adminUser);
      expect(tier).toBe(InvestorTier.INSTITUTIONAL);
    });

    it('should return institutional for company_admin users', () => {
      const companyAdminUser = { role: 'company_admin' } as User;
      const tier = service.getInvestorTierFromUser(companyAdminUser);
      expect(tier).toBe(InvestorTier.INSTITUTIONAL);
    });

    it('should return retail for investor users', () => {
      const investorUser = { role: 'investor' } as User;
      const tier = service.getInvestorTierFromUser(investorUser);
      expect(tier).toBe(InvestorTier.RETAIL);
    });

    it('should return retail for farmer users', () => {
      const farmerUser = { role: 'farmer' } as User;
      const tier = service.getInvestorTierFromUser(farmerUser);
      expect(tier).toBe(InvestorTier.RETAIL);
    });
  });

  describe('validateDealTypeHasConfigurations', () => {
    it('should return true when deal type has configurations', async () => {
      jest.spyOn(feeConfigRepo, 'count').mockResolvedValue(3);

      const result = await service.validateDealTypeHasConfigurations('Cocoa');
      expect(result).toBe(true);
    });

    it('should return false when deal type has no configurations', async () => {
      jest.spyOn(feeConfigRepo, 'count').mockResolvedValue(0);

      const result =
        await service.validateDealTypeHasConfigurations('UnknownCommodity');
      expect(result).toBe(false);
    });
  });

  describe('fee breakdown composition', () => {
    it('should include all fee types in breakdown array', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      const feeTypes = result.breakdown.map((f) => f.type);
      expect(feeTypes).toContain(FeeType.PLATFORM_ORIGINATION);
      expect(feeTypes).toContain(FeeType.PLATFORM_SUCCESS);
      expect(feeTypes).toContain(FeeType.INVESTOR_ENTRY);
    });

    it('should ensure total fees equal sum of breakdown items', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      const sumOfBreakdown = result.breakdown.reduce(
        (sum, item) => sum + item.amount,
        0,
      );
      expect(result.totalFees).toBe(sumOfBreakdown);
    });

    it('should ensure net investment = gross - entry fee', async () => {
      const configs = mockFeeConfigurations().filter(
        (f) => f.investorTier === InvestorTier.RETAIL,
      );
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(configs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      const entryFeeAmount = result.investorEntryFee?.amount || 0;
      expect(result.netInvestmentAmount).toBe(
        result.grossAmount - entryFeeAmount,
      );
    });
  });

  describe('multiple deal types', () => {
    it('should apply different fees for different commodities', async () => {
      const coffeeConfigs = [
        {
          ...mockFeeConfigurations()[0],
          dealType: 'Coffee',
          ratePercent: 1.5, // Different from Cocoa's 2%
        },
      ];
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue(coffeeConfigs);

      const result = await service.calculateFeeBreakdown({
        dealType: 'Coffee',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
      });

      expect(result.platformOriginationFee?.amount).toBe(150); // 1.5% of 10000
    });
  });

  describe('effective date transitions', () => {
    it('should respect effective date ranges', async () => {
      const pastConfig: FeeConfiguration = {
        ...mockFeeConfigurations()[0],
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: new Date('2024-06-30'),
      };

      const futureConfig: FeeConfiguration = {
        ...mockFeeConfigurations()[0],
        id: 'fee-future',
        ratePercent: 3.0, // Higher rate in future
        effectiveFrom: new Date('2024-07-01'),
        effectiveTo: null,
      };

      // Test date in past period
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue([pastConfig]);
      const pastResult = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
        referenceDate: new Date('2024-05-15'),
      });
      expect(pastResult.platformOriginationFee?.ratePercent).toBe(2.0);

      // Test date in future period
      jest.clearAllMocks();
      jest.spyOn(feeConfigRepo, 'find').mockResolvedValue([futureConfig]);
      const futureResult = await service.calculateFeeBreakdown({
        dealType: 'Cocoa',
        investorTier: InvestorTier.RETAIL,
        grossAmount: 10000,
        referenceDate: new Date('2024-08-15'),
      });
      expect(futureResult.platformOriginationFee?.ratePercent).toBe(3.0);
    });
  });
});
