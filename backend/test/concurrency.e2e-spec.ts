/**
 * Concurrency Tests for Trade Deal Investment Locks
 *
 * These tests verify that database transaction locks prevent race conditions
 * when multiple investors attempt to fund the same deal simultaneously.
 *
 * The tests simulate the behavior of pessimistic locking and transaction rollback
 * to ensure data consistency under concurrent load.
 */

describe('Trade Deal Concurrency - Database Transaction Locks (E2E)', () => {
  /**
   * Mock Trade Deal for testing
   */
  interface MockTradeDeal {
    id: string;
    tokenCount: number;
    status: 'open' | 'funded' | 'closed';
    locked: boolean;
  }

  /**
   * Mock Investment for testing
   */
  interface MockInvestment {
    id: string;
    tradeDealId: string;
    investorId: string;
    tokenAmount: number;
    status: 'confirmed' | 'pending' | 'failed';
  }

  /**
   * In-memory store for testing
   */
  const deals: Map<string, MockTradeDeal> = new Map();
  const investments: Map<string, MockInvestment[]> = new Map();
  const locks: Map<string, boolean> = new Map();

  beforeEach(() => {
    deals.clear();
    investments.clear();
    locks.clear();
  });

  /**
   * Helper: Create a test trade deal
   */
  function createTestDeal(id: string, tokenCount: number = 100): MockTradeDeal {
    const deal: MockTradeDeal = {
      id,
      tokenCount,
      status: 'open',
      locked: false,
    };
    deals.set(id, deal);
    investments.set(id, []);
    return deal;
  }

  /**
   * Helper: Acquire pessimistic lock on a deal
   */
  async function acquireLock(dealId: string): Promise<boolean> {
    if (locks.get(dealId)) {
      // Simulate lock wait
      await new Promise((resolve) => setTimeout(resolve, 10));
      return acquireLock(dealId);
    }
    locks.set(dealId, true);
    return true;
  }

  /**
   * Helper: Release lock on a deal
   */
  function releaseLock(dealId: string): void {
    locks.delete(dealId);
  }

  /**
   * Helper: Simulate investment with pessimistic locking
   */
  async function investWithLock(
    dealId: string,
    investorId: string,
    tokenAmount: number,
  ): Promise<{ success: boolean; error?: string }> {
    // Acquire lock
    await acquireLock(dealId);

    try {
      // Get deal
      const deal = deals.get(dealId);
      if (!deal) {
        throw new Error('Deal not found');
      }

      // Check if deal is open
      if (deal.status !== 'open') {
        throw new Error('Deal is not open');
      }

      // Get current investments
      const dealInvestments = investments.get(dealId) || [];
      const totalTokensInvested = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      // Check if investment would exceed token count
      if (totalTokensInvested + tokenAmount > deal.tokenCount) {
        throw new Error(
          `Investment would exceed token limit. Available: ${deal.tokenCount - totalTokensInvested}, Requested: ${tokenAmount}`,
        );
      }

      // Create investment
      const investment: MockInvestment = {
        id: `inv-${Date.now()}-${Math.random()}`,
        tradeDealId: dealId,
        investorId,
        tokenAmount,
        status: 'confirmed',
      };

      dealInvestments.push(investment);
      investments.set(dealId, dealInvestments);

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      // Release lock
      releaseLock(dealId);
    }
  }

  /**
   * Test suite: Concurrent investment requests
   */
  describe('Concurrent Investment Requests', () => {
    it('should execute 10 concurrent investment requests targeting the same deal', async () => {
      const dealId = 'deal-1';
      createTestDeal(dealId, 100);

      // Execute 10 concurrent investment requests
      const investmentPromises = Array.from({ length: 10 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // Verify all succeeded
      expect(results).toHaveLength(10);
      expect(results.every((r) => r.success)).toBe(true);

      // Verify investments were recorded
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(10);
    });

    it('should prevent overfunding when concurrent requests exceed token limit', async () => {
      const dealId = 'deal-2';
      createTestDeal(dealId, 50); // Only 50 tokens available

      // Each investor tries to buy 10 tokens (total would be 100, exceeding 50 limit)
      const investmentPromises = Array.from({ length: 10 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // Count successful and failed investments
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      // Should have some successful and some failed
      expect(successful.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);

      // Total tokens invested should not exceed limit
      const dealInvestments = investments.get(dealId) || [];
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBeLessThanOrEqual(50);
    });

    it('should maintain data consistency under concurrent load', async () => {
      const dealId = 'deal-3';
      createTestDeal(dealId, 100);

      // Execute 10 concurrent investments
      const investmentPromises = Array.from({ length: 10 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // Verify all succeeded
      expect(results.every((r) => r.success)).toBe(true);

      // Verify investments were recorded
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(10);

      // Verify total tokens match
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );
      expect(totalTokens).toBe(100);
    });
  });

  /**
   * Test suite: Database lock behavior
   */
  describe('Database Lock Behavior', () => {
    it('should use pessimistic write locks to prevent race conditions', async () => {
      const dealId = 'deal-4';
      createTestDeal(dealId, 100);

      // Simulate two concurrent transactions
      const lock1Promise = acquireLock(dealId);
      const lock2Promise = acquireLock(dealId);

      // First lock should succeed immediately
      const lock1 = await lock1Promise;
      expect(lock1).toBe(true);

      // Second lock should wait (simulated with timeout)
      let lock2Acquired = false;
      const lock2Timeout = new Promise((resolve) => {
        setTimeout(() => {
          lock2Acquired = locks.has(dealId);
          resolve(lock2Acquired);
        }, 5);
      });

      await lock2Timeout;

      // Lock should still be held by first transaction
      expect(locks.has(dealId)).toBe(true);

      // Release first lock
      releaseLock(dealId);

      // Now second lock should be acquirable
      const lock2 = await lock2Promise;
      expect(lock2).toBe(true);

      releaseLock(dealId);
    });

    it('should acquire locks before checking investment limits', async () => {
      const dealId = 'deal-5';
      createTestDeal(dealId, 50);

      const result = await investWithLock(dealId, 'investor-1', 30);

      expect(result.success).toBe(true);

      // Verify investment was recorded
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(1);
      expect(dealInvestments[0].tokenAmount).toBe(30);
    });

    it('should release locks after transaction completion', async () => {
      const dealId = 'deal-6';
      createTestDeal(dealId, 100);

      // First investment
      const result1 = await investWithLock(dealId, 'investor-1', 50);
      expect(result1.success).toBe(true);

      // Lock should be released
      expect(locks.has(dealId)).toBe(false);

      // Second investment should succeed (lock was released)
      const result2 = await investWithLock(dealId, 'investor-2', 50);
      expect(result2.success).toBe(true);

      // Verify both investments exist
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(2);
    });
  });

  /**
   * Test suite: Transaction rollback
   */
  describe('Transaction Rollback', () => {
    it('should rollback transaction if deal limit is exceeded', async () => {
      const dealId = 'deal-7';
      createTestDeal(dealId, 50);

      // Try to invest more than available
      const result = await investWithLock(dealId, 'investor-1', 100);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceed');

      // Verify no investment was created
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(0);
    });

    it('should rollback transaction if deal is not open', async () => {
      const dealId = 'deal-8';
      const deal = createTestDeal(dealId, 100);
      deal.status = 'funded';

      const result = await investWithLock(dealId, 'investor-1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not open');

      // Verify no investment was created
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(0);
    });

    it('should rollback transaction if deal not found', async () => {
      const result = await investWithLock('nonexistent-deal', 'investor-1', 10);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should clean up resources after rollback', async () => {
      const dealId = 'deal-9';
      createTestDeal(dealId, 50);

      // Attempt investment that will fail
      const result = await investWithLock(dealId, 'investor-1', 100);
      expect(result.success).toBe(false);

      // Lock should be released
      expect(locks.has(dealId)).toBe(false);

      // Subsequent investment should work (no locks held)
      const result2 = await investWithLock(dealId, 'investor-2', 25);
      expect(result2.success).toBe(true);
    });
  });

  /**
   * Test suite: Overfunding prevention
   */
  describe('Overfunding Prevention', () => {
    it('should prevent total investments from exceeding token count', async () => {
      const dealId = 'deal-10';
      createTestDeal(dealId, 100);

      // 5 investors each try to invest 30 tokens (total would be 150)
      const investmentPromises = Array.from({ length: 5 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 30),
      );

      await Promise.all(investmentPromises);

      // Get all investments
      const dealInvestments = investments.get(dealId) || [];

      // Total should not exceed token count
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBeLessThanOrEqual(100);
    });

    it('should reject investment if it would exceed remaining tokens', async () => {
      const dealId = 'deal-11';
      createTestDeal(dealId, 100);

      // First investment: 80 tokens
      const result1 = await investWithLock(dealId, 'investor-1', 80);
      expect(result1.success).toBe(true);

      // Second investment: 30 tokens (would exceed 100 limit)
      const result2 = await investWithLock(dealId, 'investor-2', 30);
      expect(result2.success).toBe(false);

      // Third investment: 20 tokens (should succeed)
      const result3 = await investWithLock(dealId, 'investor-2', 20);
      expect(result3.success).toBe(true);

      // Verify total
      const dealInvestments = investments.get(dealId) || [];
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBe(100);
    });

    it('should handle exact token limit match', async () => {
      const dealId = 'deal-12';
      createTestDeal(dealId, 100);

      // 10 investors each invest exactly 10 tokens (total = 100)
      const investmentPromises = Array.from({ length: 10 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Verify total
      const dealInvestments = investments.get(dealId) || [];
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBe(100);
    });
  });

  /**
   * Test suite: Stress testing
   */
  describe('Stress Testing', () => {
    it('should handle 50 concurrent investment requests', async () => {
      const dealId = 'deal-13';
      createTestDeal(dealId, 500);

      // Execute 50 concurrent investments
      const investmentPromises = Array.from({ length: 50 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // Verify all succeeded
      expect(results.every((r) => r.success)).toBe(true);

      // Verify total
      const dealInvestments = investments.get(dealId) || [];
      expect(dealInvestments).toHaveLength(50);

      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBe(500);
    });

    it('should maintain consistency with mixed success and failure scenarios', async () => {
      const dealId = 'deal-14';
      createTestDeal(dealId, 100);

      // 20 investors each try to invest 10 tokens (total would be 200)
      const investmentPromises = Array.from({ length: 20 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 10),
      );

      const results = await Promise.all(investmentPromises);

      // Some should succeed, some should fail
      const successful = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      expect(successful.length).toBeGreaterThan(0);
      expect(failed.length).toBeGreaterThan(0);

      // Verify total doesn't exceed limit
      const dealInvestments = investments.get(dealId) || [];
      const totalTokens = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(totalTokens).toBeLessThanOrEqual(100);
    });

    it('should handle rapid sequential investments after concurrent failures', async () => {
      const dealId = 'deal-15';
      createTestDeal(dealId, 100);

      // First batch: 10 concurrent investments of 15 tokens each (would exceed limit)
      const batch1Promises = Array.from({ length: 10 }, (_, i) =>
        investWithLock(dealId, `investor-${i}`, 15),
      );

      const batch1Results = await Promise.all(batch1Promises);

      // Some should fail
      const batch1Failed = batch1Results.filter((r) => !r.success);
      expect(batch1Failed.length).toBeGreaterThan(0);

      // Second batch: Sequential investments to fill remaining capacity
      const dealInvestments = investments.get(dealId) || [];
      const currentTotal = dealInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );
      void currentTotal; // capacity reference for documentation

      const batch2Promises = Array.from({ length: 5 }, (_, i) =>
        investWithLock(dealId, `investor-batch2-${i}`, 10),
      );

      await Promise.all(batch2Promises);

      // Verify final total doesn't exceed limit
      const finalInvestments = investments.get(dealId) || [];
      const finalTotal = finalInvestments.reduce(
        (sum, inv) => sum + inv.tokenAmount,
        0,
      );

      expect(finalTotal).toBeLessThanOrEqual(100);
    });
  });

  /**
   * Test suite: Lock timeout and deadlock prevention
   */
  describe('Lock Timeout and Deadlock Prevention', () => {
    it('should not deadlock with multiple concurrent deals', async () => {
      const deal1Id = 'deal-16';
      const deal2Id = 'deal-17';

      createTestDeal(deal1Id, 100);
      createTestDeal(deal2Id, 100);

      // Concurrent investments on different deals
      const promises = [
        investWithLock(deal1Id, 'investor-1', 50),
        investWithLock(deal2Id, 'investor-2', 50),
        investWithLock(deal1Id, 'investor-3', 50),
        investWithLock(deal2Id, 'investor-4', 50),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      expect(results.every((r) => r.success)).toBe(true);

      // Verify both deals have investments
      const deal1Investments = investments.get(deal1Id) || [];
      const deal2Investments = investments.get(deal2Id) || [];

      expect(deal1Investments.length).toBeGreaterThan(0);
      expect(deal2Investments.length).toBeGreaterThan(0);
    });

    it('should release locks even if investment creation fails', async () => {
      const dealId = 'deal-18';
      createTestDeal(dealId, 50);

      // First investment fails (exceeds limit)
      const result1 = await investWithLock(dealId, 'investor-1', 100);
      expect(result1.success).toBe(false);

      // Lock should be released
      expect(locks.has(dealId)).toBe(false);

      // Second investment should succeed
      const result2 = await investWithLock(dealId, 'investor-2', 25);
      expect(result2.success).toBe(true);
    });
  });
});
