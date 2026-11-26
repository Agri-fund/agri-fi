import {
  chunkOperations,
  MAX_OPERATIONS_PER_TX,
  MAX_OPS_PER_ENVELOPE,
  DEFAULT_ESCROW_BATCH_SIZE,
  assertEnvelopeOpCountGuard,
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
      const result = chunkOperations(ops, 95);

      expect(result.length).toBe(3);
      expect(result[0].length).toBe(95);
      expect(result[1].length).toBe(95);
      expect(result[2].length).toBe(60);
    });

    it('should use default DEFAULT_ESCROW_BATCH_SIZE (95) when maxSize not provided', () => {
      const ops = Array.from({ length: 150 }, (_, i) => i);
      const result = chunkOperations(ops);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(DEFAULT_ESCROW_BATCH_SIZE);
      expect(result[1].length).toBe(55);
    });

    it('should throw error for invalid maxSize', () => {
      expect(() => chunkOperations([1, 2, 3], 0)).toThrow(
        'maxSize must be positive',
      );
      expect(() => chunkOperations([1, 2, 3], -1)).toThrow(
        'maxSize must be positive',
      );
    });

    it('should fail fast if maxSize exceeds MAX_OPS_PER_ENVELOPE (98)', () => {
      expect(() => chunkOperations([1, 2, 3], 99)).toThrow(
        'Envelope operation count guard violation',
      );
      expect(() => chunkOperations([1, 2, 3], 100)).toThrow(
        'Envelope operation count guard violation',
      );
    });

    it('should handle exact multiples of maxSize', () => {
      const ops = Array.from({ length: 190 }, (_, i) => i);
      const result = chunkOperations(ops, 95);

      expect(result.length).toBe(2);
      expect(result[0].length).toBe(95);
      expect(result[1].length).toBe(95);
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
      const plan = planTransactionBatches(50, 95);
      expect(plan.batchCount).toBe(1);
      expect(plan.totalOperations).toBe(50);
      expect(plan.operationsPerBatch).toEqual([50]);
    });

    it('should calculate correct batch structure for large operation sets', () => {
      const plan = planTransactionBatches(250, 95);
      expect(plan.batchCount).toBe(3);
      expect(plan.totalOperations).toBe(250);
      expect(plan.operationsPerBatch).toEqual([95, 95, 60]);
    });

    it('should throw error for negative operation count', () => {
      expect(() => planTransactionBatches(-1)).toThrow('cannot be negative');
    });

    it('should use default maxSize of 95', () => {
      const plan = planTransactionBatches(150);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([95, 55]);
    });
  });

  describe('Boundary property tests (98, 99, 100 candidate ops)', () => {
    it('should safely plan 98 candidate ops with maxSize 98', () => {
      const plan = planTransactionBatches(98, 98);
      expect(plan.batchCount).toBe(1);
      expect(plan.operationsPerBatch).toEqual([98]);
    });

    it('should safely chunk 98 candidate ops with default maxSize 95', () => {
      const plan = planTransactionBatches(98, 95);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([95, 3]);
    });

    it('should safely plan 99 candidate ops into 2 batches under the guard limit', () => {
      const plan = planTransactionBatches(99, 95);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([95, 4]);
      plan.operationsPerBatch.forEach((ops) => {
        expect(ops).toBeLessThanOrEqual(MAX_OPS_PER_ENVELOPE);
      });
    });

    it('should explicitly fail when attempting to put 99 candidate ops into a single envelope', () => {
      expect(() => planTransactionBatches(99, 99)).toThrow(
        'Envelope operation count guard violation',
      );
      expect(() => assertEnvelopeOpCountGuard(99)).toThrow(
        'exceeds maximum safe limit of 98',
      );
    });

    it('should safely plan 100 candidate ops into 2 batches with maxSize 95', () => {
      const plan = planTransactionBatches(100, 95);
      expect(plan.batchCount).toBe(2);
      expect(plan.operationsPerBatch).toEqual([95, 5]);
      plan.operationsPerBatch.forEach((ops) => {
        expect(ops).toBeLessThanOrEqual(MAX_OPS_PER_ENVELOPE);
      });
    });

    it('should explicitly fail when attempting to put 100 candidate ops into a single envelope', () => {
      expect(() => planTransactionBatches(100, 100)).toThrow(
        'Envelope operation count guard violation',
      );
      expect(() => assertEnvelopeOpCountGuard(100)).toThrow(
        'exceeds maximum safe limit of 98',
      );
    });
  });

  describe('validateOperationCount', () => {
    it('should not throw for operations within limit', () => {
      expect(() => validateOperationCount(Array(98).fill({}))).not.toThrow();
      expect(() => validateOperationCount(Array(1).fill({}))).not.toThrow();
    });

    it('should throw error when operations exceed limit', () => {
      const ops = Array(99).fill({});
      expect(() => validateOperationCount(ops)).toThrow(
        `Transaction exceeds maximum of ${MAX_OPS_PER_ENVELOPE} operations`,
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

  describe('Constants', () => {
    it('should have MAX_OPERATIONS_PER_TX = 100 and MAX_OPS_PER_ENVELOPE = 98', () => {
      expect(MAX_OPERATIONS_PER_TX).toBe(100);
      expect(MAX_OPS_PER_ENVELOPE).toBe(98);
      expect(DEFAULT_ESCROW_BATCH_SIZE).toBe(95);
    });
  });
});
