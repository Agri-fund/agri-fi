import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Escrow-module Prometheus providers for release SLIs (#1034).
 * Batch/claimable/stellar_tx counters live in StellarModule.
 */
export const ESCROW_METRICS_PROVIDERS = [
  makeCounterProvider({
    name: 'escrow_release_attempts_total',
    help: 'Total escrow release attempts labelled by result (success|failure|skipped).',
    labelNames: ['result'],
  }),
  makeHistogramProvider({
    name: 'escrow_release_duration_seconds',
    help: 'End-to-end escrow release duration in seconds.',
    labelNames: ['result'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  }),
  makeCounterProvider({
    name: 'escrow_release_payouts_total',
    help: 'PaymentDistribution rows created during escrow release by recipient type.',
    labelNames: ['recipient_type'],
  }),
  makeCounterProvider({
    name: 'escrow_release_payout_amount_usd_total',
    help: 'USD payout volume recorded during escrow release by recipient type.',
    labelNames: ['recipient_type'],
  }),
  makeCounterProvider({
    name: 'escrow_release_dlq_total',
    help: 'Messages permanently failed and routed to the escrow DLQ.',
    labelNames: ['reason'],
  }),
  makeCounterProvider({
    name: 'escrow_release_dlq_replays_total',
    help: 'Escrow DLQ replay attempts labelled by result.',
    labelNames: ['result'],
  }),
  makeGaugeProvider({
    name: 'escrow_failed_payments',
    help: 'Current count of transaction_logs rows with status=failed.',
  }),
];
