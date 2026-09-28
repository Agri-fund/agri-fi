import {
  chunkOperations,
  MAX_OPERATIONS_PER_TX,
  planTransactionBatches,
  validateOperationCount,
  generateBatchMemo,
} from './transaction-chunker';

describe('transaction-chunker', () => {
  describe('chunkOperations', () => {
    it('should return empty array for empty input', () => {
      const result = chunkOperations([]);
      expect(result).toEqual([]);
    });

    it('should return single chunk when operations <= maxSize', () => {
      const ops = [1, 2, 3, 4, 5];
      const result = chunkOperations(ops, 10);
      expect(result).toEqual([ops]);
      expect(result.length).toBe(1);
    });

    it('should split operations into chunks of maxSize', () => {
      const ops = Array.from({ length: 250 }, (_, i) => i);
      const result = chunkOperations(ops, 100);

      expect(result.length).toBe(3);
      expect(result[0].length).toBe(100);
      expect(result[1].length).toBe(100);
      expect(result[2].length).toBe(50);
    });

    it('should use default MAX_OPERATIONS_PER_TX when maxSize not provided', () => {
      const ops = Array.from({ length: 150 }, (_, i) => i);
      const result = chunkOperations(ops);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(MAX_OPERATIONS_PER_TX);
      expect(result[1].length).toBe(50);
    });

    it('should throw error for invalid maxSize', () => {
      expect(() => chunkOperations([1, 2, 3], 0)).toThrow(
        'maxSize must be positive',
      );
      expect(() => chunkOperations([1, 2, 3], -1)).toThrow(
        'maxSize must be positive',
      );
    });

    it('should handle exact multiples of maxSize', () => {
      const ops = Array.from({ length: 200 }, (_, i) => i);
      const result = chunkOperations(ops, 100);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(100);
      expect(result[1].length).toBe(100);
    });

    it('should preserve order of operations', () => {
      const ops = Array.from({ length: 150 }, (_, i) => `op-${i}`);
      const result = chunkOperations(ops, 50);

      const flattened = result.flat();
      expect(flattened).toEqual(ops);
    });
  });

  describe('planTransactionBatches', () => {
    it('should return empty plan for 0 operations', () => {
      const plan = planTransactionBatches(0);
      expect(plan).toEqual({
        batchCount: 0,
        totalOperations: 0,
        operationsPerBatch: [],
      });
    });

    it('should return single batch for operations <= maxSize', () => {
      const plan = planTransactionBatches(50, 100);
      expect(plan.batchCount).toBe(1);
      expect(plan.totalOperations).toBe(50);
      expect(plan.operationsPerBatch).toEqual([50]);
    });

    it('should calculate correct batch structure for large operation sets', () => {
      const plan = planTransactionBatches(250, 100);
      expect(plan.batchCount).toBe(3);
      expect(plan.totalOperations).toBe(250);
      expect(plan.operationsPerBatch).toEqual([100, 100, 50]);
    });

    it('should handle exact multiples', () => {
      const plan = planTransactionBatches(200, 100);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([100, 100]);
    });

    it('should throw error for negative operation count', () => {
      expect(() => planTransactionBatches(-1)).toThrow('cannot be negative');
    });

    it('should use default maxSize', () => {
      const plan = planTransactionBatches(150);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([100, 50]);
    });
  });

  describe('validateOperationCount', () => {
    it('should not throw for operations within limit', () => {
      expect(() => validateOperationCount(Array(100).fill({}))).not.toThrow();
      expect(() => validateOperationCount(Array(1).fill({}))).not.toThrow();
    });

    it('should throw error when operations exceed limit', () => {
      const ops = Array(101).fill({});
      expect(() => validateOperationCount(ops)).toThrow(
        `Transaction exceeds maximum of ${MAX_OPERATIONS_PER_TX} operations`,
      );
    });

    it('should include operation count in error message', () => {
      const ops = Array(150).fill({});
      expect(() => validateOperationCount(ops)).toThrow(
        'Received 150 operations',
      );
    });
  });

  describe('generateBatchMemo', () => {
    it('should generate correct memo format', () => {
      expect(generateBatchMemo(0, 5)).toBe('batch:0/5');
      expect(generateBatchMemo(1, 5)).toBe('batch:1/5');
      expect(generateBatchMemo(4, 5)).toBe('batch:4/5');
    });

    it('should use custom prefix', () => {
      expect(generateBatchMemo(0, 3, 'payout')).toBe('payout:0/3');
      expect(generateBatchMemo(2, 3, 'chunk')).toBe('chunk:2/3');
    });

    it('should truncate prefix if memo exceeds 28 bytes', () => {
      const longPrefix = 'a'.repeat(20);
      const memo = generateBatchMemo(0, 100, longPrefix);
      expect(memo.length).toBeLessThanOrEqual(28);
    });

    it('should handle single batch', () => {
      expect(generateBatchMemo(0, 1)).toBe('batch:0/1');
    });
  });

  describe('MAX_OPERATIONS_PER_TX', () => {
    it('should be 100', () => {
      expect(MAX_OPERATIONS_PER_TX).toBe(100);
    });
  });
});
