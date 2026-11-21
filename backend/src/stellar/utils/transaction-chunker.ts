/**
 * Utility for chunking Stellar operations into transaction batches.
 *
 * Stellar enforces a maximum of 100 operations per transaction envelope.
 * Agri-Fi enforces a hard invariant of at most 98 operations per envelope
 * to guarantee headroom for platform fees and claimable balance predicates.
 */

/**
 * Maximum operations per Stellar transaction envelope per protocol.
 */
export const MAX_OPERATIONS_PER_TX = 100;

/**
 * Hard guard limit for transaction envelopes in Agri-Fi (issue #958).
 * Never exceed 98 ops per envelope to leave safe headroom.
 */
export const MAX_OPS_PER_ENVELOPE = 98;

/**
 * Default escrow batch size (configurable via ESCROW_BATCH_SIZE env, bounded 1..95).
 */
export const DEFAULT_ESCROW_BATCH_SIZE = 95;

/**
 * Guard that enforces the invariant that total ops per envelope <= MAX_OPS_PER_ENVELOPE (98).
 * Throws fast if exceeded.
 */
export function assertEnvelopeOpCountGuard(opCount: number): void {
  if (opCount > MAX_OPS_PER_ENVELOPE) {
    throw new Error(
      `Envelope operation count guard violation: ${opCount} operations exceeds maximum safe limit of ${MAX_OPS_PER_ENVELOPE}`,
    );
  }
}

/**
 * Splits an array of operations into chunks of at most maxSize operations.
 *
 * @param operations - Array of Stellar operations to chunk
 * @param maxSize - Maximum operations per chunk (default: 95)
 * @returns Array of operation chunks
 */
export function chunkOperations<T>(
  operations: T[],
  maxSize: number = DEFAULT_ESCROW_BATCH_SIZE,
): T[][] {
  if (maxSize <= 0) {
    throw new Error(`maxSize must be positive, got ${maxSize}`);
  }

  assertEnvelopeOpCountGuard(maxSize);

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
 * @param maxSize - Maximum operations per transaction (default: 95)
 * @returns Plan describing the batch structure
 */
export function planTransactionBatches(
  totalOperations: number,
  maxSize: number = DEFAULT_ESCROW_BATCH_SIZE,
): ChunkedTransactionPlan {
  if (totalOperations < 0) {
    throw new Error(
      `totalOperations cannot be negative, got ${totalOperations}`,
    );
  }

  if (maxSize <= 0) {
    throw new Error(`maxSize must be positive, got ${maxSize}`);
  }

  assertEnvelopeOpCountGuard(maxSize);

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
    const count = Math.min(maxSize, remaining);
    assertEnvelopeOpCountGuard(count);
    operationsPerBatch.push(count);
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
 * @param maxAllowed - Maximum allowed operations (defaults to MAX_OPS_PER_ENVELOPE = 98)
 * @throws Error if operations exceed the maximum allowed per transaction
 */
export function validateOperationCount(
  operations: any[],
  maxAllowed: number = MAX_OPS_PER_ENVELOPE,
): void {
  if (operations.length > maxAllowed) {
    throw new Error(
      `Transaction exceeds maximum of ${maxAllowed} operations. ` +
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
  const memo = `${prefix}:${batchIndex}/${totalBatches}`;

  if (memo.length > 28) {
    const maxPrefixLen = 28 - `:0/999`.length - 1;
    const truncatedPrefix = prefix.slice(0, maxPrefixLen);
    return `${truncatedPrefix}:${batchIndex}/${totalBatches}`;
  }

  return memo;
}
