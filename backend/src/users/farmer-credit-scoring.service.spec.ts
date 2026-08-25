import { FarmerCreditScoringService } from './farmer-credit-scoring.service';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';

describe('FarmerCreditScoringService', () => {
  let service: FarmerCreditScoringService;
  let userRepo: Partial<Repository<User>>;
  let historyRepo: Partial<Repository<FarmerCreditScoreHistory>>;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-uuid', creditScore: null } as User),
      save: jest.fn().mockImplementation((u) => Promise.resolve(u)),
    };
    historyRepo = {
      create: jest.fn().mockImplementation((dto) => dto as FarmerCreditScoreHistory),
      save: jest.fn().mockImplementation((h) => Promise.resolve(h)),
    };

    service = new FarmerCreditScoringService(
      userRepo as Repository<User>,
      historyRepo as Repository<FarmerCreditScoreHistory>,
    );
  });

  it('calculates minimum score 300 for zero factors', () => {
    const score = service.calculateScoreFromFactors({
      onTimeRepaymentRate: 0,
      dealCompletionRate: 0,
      dealDefaultRate: 1.0, // 100% default
      shipmentMilestoneComplianceRate: 0,
      kycVerificationAgeDays: 0,
    });
    expect(score).toBe(300);
  });

  it('calculates maximum score 850 for perfect performance', () => {
    const score = service.calculateScoreFromFactors({
      onTimeRepaymentRate: 1.0,
      dealCompletionRate: 1.0,
      dealDefaultRate: 0,
      shipmentMilestoneComplianceRate: 1.0,
      kycVerificationAgeDays: 365,
    });
    expect(score).toBe(850);
  });

  it('derives correct max deal sizes based on score tiers', () => {
    expect(service.deriveMaxDealSize(450)).toBe(10000);
    expect(service.deriveMaxDealSize(650)).toBe(50000);
    expect(service.deriveMaxDealSize(750)).toBe(200000);
  });
});
