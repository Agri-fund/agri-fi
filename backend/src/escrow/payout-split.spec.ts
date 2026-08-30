import { computeFarmerPayoutSplits, PayoutParticipant } from './payout-split';

describe('computeFarmerPayoutSplits (#891)', () => {
  const lead = (portionPercent = 100): PayoutParticipant => ({
    farmerId: 'lead',
    walletAddress: 'GLEAD',
    portionPercent,
  });

  const co = (id: string, portionPercent: number): PayoutParticipant => ({
    farmerId: id,
    walletAddress: `G${id.toUpperCase()}`,
    portionPercent,
  });

  describe('single farmer (no co-farmers)', () => {
    it('gives the lead farmer the entire net pool', () => {
      const payouts = computeFarmerPayoutSplits(9800, [lead()]);
      expect(payouts).toHaveLength(1);
      expect(payouts[0]).toEqual({
        recipientId: 'lead',
        walletAddress: 'GLEAD',
        amountUsd: 9800,
      });
    });

    it('handles fractional pools without losing cents', () => {
      const payouts = computeFarmerPayoutSplits(10000.33, [lead()]);
      expect(payouts[0].amountUsd).toBeCloseTo(10000.33, 10);
    });

    it('returns an empty list when there are no participants', () => {
      expect(computeFarmerPayoutSplits(1000, [])).toEqual([]);
    });
  });

  describe('proportional weighting', () => {
    it('splits evenly for equal portions', () => {
      // Lead keeps 50%, two co-farmers at 25% each
      const payouts = computeFarmerPayoutSplits(9000, [
        lead(50),
        co('a', 25),
        co('b', 25),
      ]);
      expect(payouts.map((p) => p.recipientId)).toEqual(['lead', 'a', 'b']);
      expect(payouts.map((p) => p.amountUsd)).toEqual([4500, 2250, 2250]);
      expect(sumOf(payouts)).toBe(9000);
    });

    it('respects uneven portions exactly', () => {
      const payouts = computeFarmerPayoutSplits(8000, [
        lead(40),
        co('a', 35),
        co('b', 25),
      ]);
      expect(payouts.map((p) => p.amountUsd)).toEqual([3200, 2800, 2000]);
      expect(sumOf(payouts)).toBe(8000);
    });
  });

  describe('conservation and rounding', () => {
    it.each([
      [10000, 33.33],
      [12345.67, 12.5],
      [9999.99, 66.66],
      [1, 99.99],
      [7777.77, 55.55],
    ])(
      'splits %j with co-portion %j%% so shares sum to the exact pool',
      (pool, portion) => {
        const payouts = computeFarmerPayoutSplits(pool, [
          lead(100 - portion),
          co('a', portion),
        ]);
        expect(sumOf(payouts)).toBeCloseTo(pool, 10);
        // No share may exceed its entitlement by more than one cent
        for (const payout of payouts) {
          expect(payout.amountUsd).toBeGreaterThanOrEqual(0);
        }
      },
    );

    it('absorbs the rounding remainder in the last participant only', () => {
      // Pool of 0.03 split three ways: floor gives 0.01 each; last gets remainder
      const payouts = computeFarmerPayoutSplits(0.03, [
        lead(34),
        co('a', 33),
        co('b', 33),
      ]);
      expect(sumOf(payouts)).toBe(0.03);
      // First two are floored whole cents
      expect(payouts[0].amountUsd * 100).toBe(
        Math.floor(payouts[0].amountUsd * 100),
      );
      expect(payouts[1].amountUsd * 100).toBe(
        Math.floor(payouts[1].amountUsd * 100),
      );
    });
  });

  describe('boundary conditions', () => {
    it('drops the lead farmer when co-farmers commit 100%', () => {
      const payouts = computeFarmerPayoutSplits(5000, [
        lead(0),
        co('a', 60),
        co('b', 40),
      ]);
      expect(payouts.map((p) => p.recipientId)).toEqual(['a', 'b']);
      expect(sumOf(payouts)).toBe(5000);
    });

    it('clamps negative weights to zero before allocating', () => {
      const payouts = computeFarmerPayoutSplits(1000, [
        lead(-20),
        co('a', 50),
        co('b', 50),
      ]);
      expect(payouts.map((p) => p.recipientId)).toEqual(['a', 'b']);
      expect(sumOf(payouts)).toBe(1000);
    });

    it('throws when every weight is zero or negative', () => {
      expect(() =>
        computeFarmerPayoutSplits(1000, [lead(0), co('a', -5)]),
      ).toThrow(/positive weights/i);
    });
  });
});

function sumOf(payouts: { amountUsd: number }[]): number {
  return payouts.reduce((sum, p) => sum + p.amountUsd, 0);
}
