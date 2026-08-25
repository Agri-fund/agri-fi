'use client';

import React from 'react';

/**
 * The three transaction lifecycle states modelled by #724.
 *   simulating  — the transaction is being built / fee-bumped / simulated
 *   submitting  — the signed XDR has been broadcast to Horizon
 *   confirmed   — at least one ledger close has confirmed the transaction
 */
export type TxState = 'simulating' | 'submitting' | 'confirmed';

export interface OnChainProgressProps {
  /** Current lifecycle state of the Stellar transaction. */
  state: TxState;
  /**
   * Confirmed transaction hash (hex or base64 as returned by Horizon).
   * Required only when state === 'confirmed'.
   */
  txHash?: string;
  /**
   * Override the Stellar explorer base URL.
   * Defaults to the testnet Stellar Expert explorer.
   */
  explorerBaseUrl?: string;
  /** Optional Tailwind class overrides for the outer wrapper. */
  className?: string;
}

const STEPS: { key: TxState; label: string; description: string }[] = [
  {
    key: 'simulating',
    label: 'Simulating',
    description: 'Building and simulating transaction',
  },
  {
    key: 'submitting',
    label: 'Submitting',
    description: 'Broadcasting to the Stellar network',
  },
  {
    key: 'confirmed',
    label: 'Confirmed',
    description: 'Transaction included in a ledger',
  },
];

const STATE_ORDER: Record<TxState, number> = {
  simulating: 0,
  submitting: 1,
  confirmed: 2,
};

const DEFAULT_EXPLORER = 'https://stellar.expert/explorer/testnet/tx';

/**
 * OnChainProgressIndicator
 *
 * Renders a three-step progress bar that reflects the lifecycle of a
 * Stellar transaction (simulating → submitting → confirmed).
 * When the transaction is confirmed, a link to the Stellar Explorer is
 * shown using the provided transaction hash, satisfying the acceptance
 * criterion "Transaction hashes link to Stellar explorer instances."
 *
 * @example
 * <OnChainProgressIndicator state="simulating" />
 * <OnChainProgressIndicator state="confirmed" txHash="abc123..." />
 */
export const OnChainProgressIndicator: React.FC<OnChainProgressProps> = ({
  state,
  txHash,
  explorerBaseUrl = DEFAULT_EXPLORER,
  className = '',
}) => {
  const currentIndex = STATE_ORDER[state];

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}
      role="status"
      aria-live="polite"
      aria-label={`Transaction status: ${state}`}
    >
      {/* Step indicators */}
      <ol className="flex items-center gap-0">
        {STEPS.map((step, i) => {
          const isDone = i < currentIndex;
          const isActive = i === currentIndex;
          const isPending = i > currentIndex;

          return (
            <React.Fragment key={step.key}>
              {/* Step circle + label */}
              <li className="flex flex-col items-center flex-shrink-0">
                <div
                  className={`
                    w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold
                    transition-all duration-300
                    ${isDone ? 'bg-green-500 text-white' : ''}
                    ${isActive ? 'bg-blue-600 text-white ring-4 ring-blue-100 animate-pulse' : ''}
                    ${isPending ? 'bg-slate-100 text-slate-400' : ''}
                  `}
                  aria-current={isActive ? 'step' : undefined}
                >
                  {isDone ? (
                    <CheckIcon />
                  ) : isActive ? (
                    <SpinnerIcon />
                  ) : (
                    <span>{i + 1}</span>
                  )}
                </div>
                <span
                  className={`
                    mt-1.5 text-xs font-medium text-center whitespace-nowrap
                    ${isDone ? 'text-green-600' : ''}
                    ${isActive ? 'text-blue-600' : ''}
                    ${isPending ? 'text-slate-400' : ''}
                  `}
                >
                  {step.label}
                </span>
              </li>

              {/* Connector line between steps */}
              {i < STEPS.length - 1 && (
                <div
                  className={`
                    flex-1 h-0.5 mx-2 mt-[-18px] transition-colors duration-300
                    ${i < currentIndex ? 'bg-green-400' : 'bg-slate-200'}
                  `}
                  aria-hidden="true"
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>

      {/* Status description */}
      <p className="mt-3 text-center text-sm text-slate-500">
        {STEPS[currentIndex].description}
        {state === 'simulating' || state === 'submitting' ? (
          <span className="inline-flex ml-1.5 gap-0.5 align-middle">
            {[0, 1, 2].map((d) => (
              <span
                key={d}
                className="w-1 h-1 rounded-full bg-blue-500 animate-bounce"
                style={{ animationDelay: `${d * 150}ms` }}
              />
            ))}
          </span>
        ) : null}
      </p>

      {/* Transaction hash link — shown only when confirmed */}
      {state === 'confirmed' && txHash && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <span className="text-xs text-slate-500">TX:</span>
          <a
            href={`${explorerBaseUrl}/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="
              inline-flex items-center gap-1 text-xs font-mono
              text-blue-600 hover:text-blue-800 underline underline-offset-2
              break-all
            "
            aria-label={`View transaction ${txHash} on Stellar Explorer`}
          >
            <span>{txHash.length > 20 ? `${txHash.slice(0, 10)}…${txHash.slice(-8)}` : txHash}</span>
            <ExternalLinkIcon />
          </a>
        </div>
      )}

      {/* Success banner */}
      {state === 'confirmed' && (
        <div className="mt-3 flex items-center justify-center gap-1.5 text-green-600 text-sm font-medium">
          <CheckCircleIcon />
          <span>Transaction confirmed on-chain</span>
        </div>
      )}
    </div>
  );
};

// ── Inline SVG icons (no extra dependency) ────────────────────────────────────

const CheckIcon: React.FC = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={3}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const SpinnerIcon: React.FC = () => (
  <svg
    className="w-4 h-4 animate-spin"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
    />
  </svg>
);

const ExternalLinkIcon: React.FC = () => (
  <svg
    className="w-3 h-3 flex-shrink-0"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
    />
  </svg>
);

const CheckCircleIcon: React.FC = () => (
  <svg
    className="w-4 h-4"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);
