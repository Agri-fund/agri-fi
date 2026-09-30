import {
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Stellar-side escrow release SLI metrics (#1034).
 * Registered in StellarModule (where releaseEscrow lives).
 */
export const STELLAR_ESCROW_METRICS_PROVIDERS = [
  makeHistogramProvider({
    name: 'escrow_release_batch_duration_seconds',
    help: 'Per-batch Stellar escrow release duration in seconds.',
    labelNames: ['result'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  }),
  makeCounterProvider({
    name: 'escrow_release_batches_total',
    help: 'Total Stellar escrow release batches labelled by result.',
    labelNames: ['result'],
  }),
  makeCounterProvider({
    name: 'escrow_release_claimable_balances_total',
    help: 'Total claimable balances created during escrow release.',
  }),
  makeCounterProvider({
    name: 'escrow_stellar_tx_total',
    help: 'Total Stellar transactions submitted during escrow release.',
  }),
  makeCounterProvider({
    name: 'escrow_stellar_tx_failures_total',
    help: 'Failed Stellar transactions during escrow release.',
  }),
];
