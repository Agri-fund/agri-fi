import { reconcileEscrowDeal } from '../../scripts/reconcile-onchain-db';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { PaymentDistribution } from './entities/payment-distribution.entity';
import { StellarService } from '../stellar/stellar.service';

describe('Escrow Reconciliation (#1306)', () => {
  let mockDataSource: any;
  let mockStellarService: any;
  let savedDistributions: any[];
  let dealUpdatePayload: any;

  const sampleDeal: Partial<TradeDeal> = {
    id: 'deal-uuid-1306',
    status: 'open',
    totalValue: 1000,
    farmer: {
      id: 'farmer-1',
      walletAddress: 'GFARMER11111111111111111111111111111111111111111111111111',
    } as any,
  };

  const sampleInvestments: Partial<Investment>[] = [
    {
      id: 'inv-1',
      tradeDealId: 'deal-uuid-1306',
      investorId: 'user-investor-1',
      tokenAmount: 60,
      investor: {
        id: 'user-investor-1',
        walletAddress: 'GINVESTOR111111111111111111111111111111111111111111111111',
      } as any,
    },
    {
      id: 'inv-2',
      tradeDealId: 'deal-uuid-1306',
      investorId: 'user-investor-2',
      tokenAmount: 40,
      investor: {
        id: 'user-investor-2',
        walletAddress: 'GINVESTOR222222222222222222222222222222222222222222222222',
      } as any,
    },
  ];

  beforeEach(() => {
    savedDistributions = [];
    dealUpdatePayload = null;

    mockStellarService = {
      getTransactionStatus: jest.fn().mockResolvedValue('success'),
    };

    const mockDistributionRepo = {
      find: jest.fn().mockResolvedValue([]), // Simulating 0 DB writes occurred post-Stellar
      create: jest.fn().call((_, entity) => entity),
      save: jest.fn().mockImplementation(async (entities) => {
        savedDistributions.push(...entities);
        return entities;
      }),
    };

    const mockDealRepo = {
      findOne: jest.fn().mockResolvedValue({ ...sampleDeal }),
      update: jest.fn().mockImplementation(async (_, update) => {
        dealUpdatePayload = update;
        return { affected: 1 };
      }),
    };

    const mockInvestmentRepo = {
      find: jest.fn().mockResolvedValue([...sampleInvestments]),
    };

    mockDataSource = {
      getRepository: jest.fn().mockImplementation((entity) => {
        if (entity === TradeDeal) return mockDealRepo;
        if (entity === Investment) return mockInvestmentRepo;
        if (entity === PaymentDistribution) return mockDistributionRepo;
        return {};
      }),
    };
  });

  it('restores consistent DB state and inserts missing PaymentDistribution rows post-Stellar failure', async () => {
    const stellarTxId = 'tx-stellar-hash-abc-123';

    const result = await reconcileEscrowDeal(
      mockDataSource as any,
      mockStellarService as any,
      'deal-uuid-1306',
      stellarTxId,
    );

    expect(result.reconciled).toBe(true);
    expect(result.tradeDealId).toBe('deal-uuid-1306');
    expect(result.dealStatus).toBe('completed');
    expect(dealUpdatePayload).toEqual({ status: 'completed' });

    // 1 platform + 1 farmer + 2 investors = 4 distribution rows
    expect(savedDistributions.length).toBe(4);

    const platformRow = savedDistributions.find(
      (d) => d.recipientType === 'platform',
    );
    expect(platformRow).toBeDefined();
    expect(platformRow.amountUsd).toBe(20); // 2% of 1000
    expect(platformRow.stellarTxId).toBe(stellarTxId);

    const farmerRow = savedDistributions.find(
      (d) => d.recipientType === 'farmer',
    );
    expect(farmerRow).toBeDefined();
    expect(farmerRow.amountUsd).toBe(980); // 98% of 1000
    expect(farmerRow.walletAddress).toBe(sampleDeal.farmer!.walletAddress);

    const investor1Row = savedDistributions.find(
      (d) => d.recipientId === 'user-investor-1',
    );
    expect(investor1Row).toBeDefined();
    // 60% of investorPool ($980) = $588
    expect(investor1Row.amountUsd).toBe(588);

    const investor2Row = savedDistributions.find(
      (d) => d.recipientId === 'user-investor-2',
    );
    expect(investor2Row).toBeDefined();
    // 40% of investorPool ($980) = $392
    expect(investor2Row.amountUsd).toBe(392);
  });
});
