import {
  dealMatchesFilters,
  pickDealFilters,
  validateDealFilters,
} from './deal-filters';

const deal = {
  commodity: 'Cocoa',
  country: 'Ghana',
  region: 'Ashanti',
  title: 'Premium cocoa lot',
  minInvestmentLot: 250,
  expectedRoi: 18,
  durationDays: 120,
  riskRating: 'Low',
  totalInvested: 20,
  totalValue: 100,
};

describe('validateDealFilters', () => {
  it('accepts a coherent combination', () => {
    expect(
      validateDealFilters({ minRoi: 5, maxRoi: 20, sortBy: 'largest_amount' }),
    ).toEqual([]);
  });

  it('rejects impossible ranges, bad enums and unknown sort', () => {
    const errors = validateDealFilters({
      minRoi: 30,
      maxRoi: 10,
      minAmount: 500,
      maxAmount: 100,
      duration: 'forever' as any,
      sortBy: 'created_at' as any,
    });
    expect(errors).toHaveLength(4);
  });

  it('rejects negative and non-finite numbers', () => {
    expect(validateDealFilters({ minAmount: -1 })).toHaveLength(1);
    expect(validateDealFilters({ maxRoi: NaN })).toHaveLength(1);
  });
});

describe('dealMatchesFilters', () => {
  it('matches on all six marketplace criteria', () => {
    expect(
      dealMatchesFilters(deal, {
        commodity: 'cocoa,coffee',
        region: 'ashanti',
        status: 'open',
        minRoi: 10,
        maxRoi: 25,
        minAmount: 100,
        duration: '3-6 months',
      }),
    ).toBe(true);
  });

  it.each([
    [{ commodity: 'wheat' }],
    [{ region: 'Volta' }],
    [{ status: 'fully funded' }],
    [{ minRoi: 20 }],
    [{ maxAmount: 100 }],
    [{ duration: '<3 months' }],
    [{ q: 'coffee' }],
  ])('rejects %j', (filters) => {
    expect(dealMatchesFilters(deal, filters as any)).toBe(false);
  });
});

describe('pickDealFilters', () => {
  it('drops unknown and empty keys', () => {
    expect(
      pickDealFilters({ commodity: 'cocoa', evil: 1, region: '', q: null }),
    ).toEqual({
      commodity: 'cocoa',
    });
  });
});
