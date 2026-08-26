import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { AnnualCapService } from './annual-cap.service';
import { AnnualInvestmentCap } from './entities/annual-investment-cap.entity';
import { AccreditationTier } from './entities/user.entity';

const mockCapRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
});

const mockLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('AnnualCapService', () => {
  let service: AnnualCapService;
  let capRepo: jest.Mocked<Repository<AnnualInvestmentCap>>;

  const currentYear = new Date().getFullYear();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualCapService,
        { provide: getRepositoryToken(AnnualInvestmentCap), useFactory: mockCapRepo },
        { provide: PinoLogger, useFactory: mockLogger },
      ],
    }).compile();

    service = module.get<AnnualCapService>(AnnualCapService);
    capRepo = module.get(getRepositoryToken(AnnualInvestmentCap));
  });

  afterEach(() => jest.clearAllMocks());

  // ── getOrCreateCap ───────────────────────────────────────────────────────

  describe('getOrCreateCap', () => {
    it('returns existing cap if found', async () => {
      const existingCap: Partial<AnnualInvestmentCap> = {
        id: 'cap-1',
        userId: 'user-1',
        year: currentYear,
        totalInvested: 500,
      };
      capRepo.findOne.mockResolvedValue(existingCap as AnnualInvestmentCap);

      const result = await service.getOrCreateCap('user-1', currentYear);

      expect(capRepo.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-1', year: currentYear },
      });
      expect(capRepo.create).not.toHaveBeenCalled();
      expect(result.totalInvested).toBe(500);
    });

    it('creates a new cap with totalInvested=0 when none exists', async () => {
      const newCap: Partial<AnnualInvestmentCap> = {
        id: 'cap-2',
        userId: 'user-2',
        year: currentYear,
        totalInvested: 0,
      };
      capRepo.findOne.mockResolvedValue(null);
      capRepo.create.mockReturnValue(newCap as AnnualInvestmentCap);
      capRepo.save.mockResolvedValue(newCap as AnnualInvestmentCap);

      const result = await service.getOrCreateCap('user-2', currentYear);

      expect(capRepo.create).toHaveBeenCalledWith({
        userId: 'user-2',
        year: currentYear,
        totalInvested: 0,
      });
      expect(capRepo.save).toHaveBeenCalledWith(newCap);
      expect(result.totalInvested).toBe(0);
    });
  });

  // ── addInvestment ────────────────────────────────────────────────────────

  describe('addInvestment', () => {
    it('accumulates totalInvested correctly', async () => {
      const existingCap: Partial<AnnualInvestmentCap> = {
        id: 'cap-3',
        userId: 'user-3',
        year: currentYear,
        totalInvested: 1000,
      };
      capRepo.findOne.mockResolvedValue(existingCap as AnnualInvestmentCap);
      capRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.addInvestment('user-3', 500);

      expect(capRepo.update).toHaveBeenCalledWith('cap-3', {
        totalInvested: 1500, // 1000 + 500
      });
    });

    it('creates a new cap if none exists and adds investment amount', async () => {
      const newCap: Partial<AnnualInvestmentCap> = {
        id: 'cap-4',
        userId: 'user-4',
        year: currentYear,
        totalInvested: 0,
      };
      capRepo.findOne.mockResolvedValue(null);
      capRepo.create.mockReturnValue(newCap as AnnualInvestmentCap);
      capRepo.save.mockResolvedValue(newCap as AnnualInvestmentCap);
      capRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.addInvestment('user-4', 300);

      expect(capRepo.update).toHaveBeenCalledWith('cap-4', {
        totalInvested: 300, // 0 + 300
      });
    });
  });

  // ── checkCap ─────────────────────────────────────────────────────────────

  describe('checkCap', () => {
    it('allows investment within retail limit', async () => {
      const cap: Partial<AnnualInvestmentCap> = {
        id: 'cap-5',
        userId: 'user-5',
        year: currentYear,
        totalInvested: 3000,
      };
      capRepo.findOne.mockResolvedValue(cap as AnnualInvestmentCap);

      const result = await service.checkCap('user-5', 1000, 'retail');

      expect(result.allowed).toBe(true);
      expect(result.remainingUsd).toBe(2000); // 5000 - 3000
    });

    it('blocks retail user who would exceed $5000 annual cap', async () => {
      const cap: Partial<AnnualInvestmentCap> = {
        id: 'cap-6',
        userId: 'user-6',
        year: currentYear,
        totalInvested: 4500,
      };
      capRepo.findOne.mockResolvedValue(cap as AnnualInvestmentCap);

      const result = await service.checkCap('user-6', 1000, 'retail'); // 4500 + 1000 > 5000

      expect(result.allowed).toBe(false);
      expect(result.remainingUsd).toBe(500); // 5000 - 4500
    });

    it('returns allowed=true and remainingUsd=Infinity for institutional tier', async () => {
      const cap: Partial<AnnualInvestmentCap> = {
        id: 'cap-7',
        userId: 'user-7',
        year: currentYear,
        totalInvested: 999999,
      };
      capRepo.findOne.mockResolvedValue(cap as AnnualInvestmentCap);

      const result = await service.checkCap('user-7', 1000000, 'institutional');

      expect(result.allowed).toBe(true);
      expect(result.remainingUsd).toBe(Infinity);
    });

    it('allows accredited investor up to $250,000', async () => {
      const cap: Partial<AnnualInvestmentCap> = {
        id: 'cap-8',
        userId: 'user-8',
        year: currentYear,
        totalInvested: 100000,
      };
      capRepo.findOne.mockResolvedValue(cap as AnnualInvestmentCap);

      const result = await service.checkCap('user-8', 100000, 'accredited');

      expect(result.allowed).toBe(true);
      expect(result.remainingUsd).toBe(150000); // 250000 - 100000
    });
  });

  // ── resetAnnualCaps ──────────────────────────────────────────────────────

  describe('resetAnnualCaps', () => {
    it('creates new records with totalInvested=0 for new year', async () => {
      const previousYear = currentYear - 1;
      const prevCaps: Partial<AnnualInvestmentCap>[] = [
        { id: 'cap-9', userId: 'user-9', year: previousYear, totalInvested: 3000 },
        { id: 'cap-10', userId: 'user-10', year: previousYear, totalInvested: 50000 },
      ];

      capRepo.find.mockResolvedValue(prevCaps as AnnualInvestmentCap[]);
      // No existing caps for the new year
      capRepo.findOne.mockResolvedValue(null);
      capRepo.create.mockImplementation((data: any) => data as AnnualInvestmentCap);
      capRepo.save.mockImplementation((data: any) => Promise.resolve(data));

      await service.resetAnnualCaps();

      expect(capRepo.find).toHaveBeenCalledWith({ where: { year: previousYear } });
      expect(capRepo.save).toHaveBeenCalledTimes(2);
      expect(capRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-9', year: currentYear, totalInvested: 0 }),
      );
      expect(capRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-10', year: currentYear, totalInvested: 0 }),
      );
    });

    it('resets existing cap records to 0 when they already exist for new year', async () => {
      const previousYear = currentYear - 1;
      const prevCaps: Partial<AnnualInvestmentCap>[] = [
        { id: 'cap-11', userId: 'user-11', year: previousYear, totalInvested: 1000 },
      ];
      const existingNewYearCap: Partial<AnnualInvestmentCap> = {
        id: 'cap-12',
        userId: 'user-11',
        year: currentYear,
        totalInvested: 200,
      };

      capRepo.find.mockResolvedValue(prevCaps as AnnualInvestmentCap[]);
      capRepo.findOne.mockResolvedValue(existingNewYearCap as AnnualInvestmentCap);
      capRepo.update.mockResolvedValue({ affected: 1 } as any);

      await service.resetAnnualCaps();

      expect(capRepo.update).toHaveBeenCalledWith('cap-12', { totalInvested: 0 });
      expect(capRepo.save).not.toHaveBeenCalled();
    });
  });

  // ── CAPS constant ────────────────────────────────────────────────────────

  describe('CAPS constant', () => {
    it('has correct values for all tiers', () => {
      expect(AnnualCapService.CAPS.retail).toBe(5000);
      expect(AnnualCapService.CAPS.accredited).toBe(250000);
      expect(AnnualCapService.CAPS.institutional).toBe(Infinity);
    });
  });
});
