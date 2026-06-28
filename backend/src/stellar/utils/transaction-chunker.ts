/**
 * Utility for chunking Stellar operations into transaction batches.
 *
 * Stellar enforces a maximum of 100 operations per transaction envelope.
 * This utility splits large operation sets into compliant sub-arrays and
 * provides helpers for sequential submission with correct sequence numbers.
 */

/**
 * Maximum operations per Stellar transaction envelope.
 * Stellar protocol limit is 100 operations per transaction.
 */
export const MAX_OPERATIONS_PER_TX = 100;

/**
 * Splits an array of operations into chunks of at most maxSize operations.
 *
 * @param operations - Array of Stellar operations to chunk
 * @param maxSize - Maximum operations per chunk (default: 100)
 * @returns Array of operation chunks
 *
 * @example
 * const ops = [op1, op2, ..., op150];
 * const chunks = chunkOperations(ops, 100);
 * // Returns [[op1..op100], [op101..op150]]
 */
export function chunkOperations<T>(
  operations: T[],
  maxSize: number = MAX_OPERATIONS_PER_TX,
): T[][] {
  if (maxSize <= 0) {
    throw new Error(`maxSize must be positive, got ${maxSize}`);
  }

  if (operations.length === 0) {
    return [];
  }

  if (operations.length <= maxSize) {
    return [operations];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < operations.length; i += maxSize) {
    chunks.push(operations.slice(i, i + maxSize));
  }

  return chunks;
}

/**
 * Result of chunking operations for batched submission.
 */
export interface ChunkedTransactionPlan {
  /** Number of transaction batches required */
  batchCount: number;
  /** Total operations across all batches */
  totalOperations: number;
  /** Operations per batch (last batch may be smaller) */
  operationsPerBatch: number[];
}

/**
 * Plans how operations will be split into batches without actually chunking.
 * Useful for logging and validation before building transactions.
 *
 * @param totalOperations - Total number of operations to submit
 * @param maxSize - Maximum operations per transaction (default: 100)
 * @returns Plan describing the batch structure
 */
export function planTransactionBatches(
  totalOperations: number,
  maxSize: number = MAX_OPERATIONS_PER_TX,
): ChunkedTransactionPlan {
  if (totalOperations < 0) {
    throw new Error(`totalOperations cannot be negative, got ${totalOperations}`);
  }

  if (totalOperations === 0) {
    return {
      batchCount: 0,
      totalOperations: 0,
      operationsPerBatch: [],
    };
  }

  const batchCount = Math.ceil(totalOperations / maxSize);
  const operationsPerBatch: number[] = [];

  for (let i = 0; i < batchCount; i++) {
    const start = i * maxSize;
    const remaining = totalOperations - start;
    operationsPerBatch.push(Math.min(maxSize, remaining));
  }

  return {
    batchCount,
    totalOperations,
    operationsPerBatch,
  };
}

/**
 * Validates that a set of operations can be submitted within Stellar limits.
 *
 * @param operations - Array of operations to validate
 * @throws Error if operations exceed the maximum allowed per transaction
 */
export function validateOperationCount(operations: any[]): void {
  if (operations.length > MAX_OPERATIONS_PER_TX) {
    throw new Error(
      `Transaction exceeds maximum of ${MAX_OPERATIONS_PER_TX} operations. ` +
        `Received ${operations.length} operations. ` +
        `Use chunkOperations() to split into multiple transactions.`,
    );
  }
}

/**
 * Generates a unique memo for batched transactions to help identify them on-chain.
 *
 * @param batchIndex - Zero-based index of this batch
 * @param totalBatches - Total number of batches
 * @param prefix - Optional prefix for the memo (max 20 chars to fit 28-byte limit)
 * @returns Memo text string (max 28 bytes)
 */
export function generateBatchMemo(
  batchIndex: number,
  totalBatches: number,
  prefix: string = 'batch',
): string {
  // Format: "prefix:batchIndex/totalBatches"
  // Example: "batch:0/5", "batch:1/5"
  const memo = `${prefix}:${batchIndex}/${totalBatches}`;

  // Stellar memo text is limited to 28 bytes
  if (memo.length > 28) {
    // Truncate prefix if needed
    const maxPrefixLen = 28 - `:0/999`.length - 1; // reserve space for ":X/Y"
    const truncatedPrefix = prefix.slice(0, maxPrefixLen);
    return `${truncatedPrefix}:${batchIndex}/${totalBatches}`;
  }

  return memo;
}