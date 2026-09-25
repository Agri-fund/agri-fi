'use client';

/**
 * useTransactionProgress — Manages the lifecycle of a Stellar transaction
 *
 * Tracks the state of a transaction through three phases:
 *   1. simulating — transaction is being built / fee-bumped / simulated
 *   2. submitting — the signed XDR is being broadcast to Horizon
 *   3. confirmed — at least one ledger close has confirmed the transaction
 *
 * Usage:
 *   const { state, txHash, setSimulating, setSubmitting, setConfirmed, reset } = useTransactionProgress();
 *
 *   // Move through the lifecycle:
 *   setSimulating();       // → state = 'simulating'
 *   setSubmitting();       // → state = 'submitting'
 *   setConfirmed(hash);    // → state = 'confirmed', txHash = hash
 *   reset();               // → state = 'simulating', txHash = null
 */

import { useState, useCallback } from 'react';
import type { TxState } from '../components/OnChainProgressIndicator';

export interface TransactionProgress {
  /** Current state of the transaction lifecycle. */
  state: TxState;
  /** Transaction hash when state is 'confirmed'. null otherwise. */
  txHash: string | null;
  /** Move to simulating state. */
  setSimulating: () => void;
  /** Move to submitting state. */
  setSubmitting: () => void;
  /**
   * Move to confirmed state and store the transaction hash.
   * @param txHash - Transaction hash from Horizon API response.
   */
  setConfirmed: (txHash: string) => void;
  /** Reset to initial state (simulating, no hash). */
  reset: () => void;
}

export function useTransactionProgress(): TransactionProgress {
  const [state, setState] = useState<TxState>('simulating');
  const [txHash, setTxHash] = useState<string | null>(null);

  const setSimulating = useCallback(() => {
    setState('simulating');
    setTxHash(null);
  }, []);

  const setSubmitting = useCallback(() => {
    setState('submitting');
  }, []);

  const setConfirmed = useCallback((hash: string) => {
    setState('confirmed');
    setTxHash(hash);
  }, []);

  const reset = useCallback(() => {
    setState('simulating');
    setTxHash(null);
  }, []);

  return {
    state,
    txHash,
    setSimulating,
    setSubmitting,
    setConfirmed,
    reset,
  };
}
