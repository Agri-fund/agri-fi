'use client';

import React from 'react';

export interface ShipmentStep {
  id: string;
  label: string;
  /** 'completed' | 'active' | 'pending' */
  status: 'completed' | 'active' | 'pending';
  timestamp?: string;
  location?: string;
  txHash?: string;
  notes?: string;
}

interface ShipmentStepperProps {
  steps: ShipmentStep[];
  className?: string;
}

const STELLAR_EXPLORER = 'https://stellar.expert/explorer/testnet/tx';

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ── Single step node ─────────────────────────────────────────────────────── */
function StepNode({ step, isLast }: { step: ShipmentStep; isLast: boolean }) {
  const isDone    = step.status === 'completed';
  const isActive  = step.status === 'active';
  const isPending = step.status === 'pending';

  return (
    /* Vertical layout (mobile) */
    <li className="relative flex gap-4 md:flex-col md:items-center md:gap-0 md:flex-1">

      {/* Connector line — vertical on mobile, horizontal on desktop */}
      {!isLast && (
        <>
          {/* Mobile: vertical line */}
          <div className={`absolute left-5 top-10 bottom-0 w-0.5 md:hidden ${isDone ? 'bg-brand-400' : 'bg-slate-200'}`} />
          {/* Desktop: horizontal line */}
          <div className={`hidden md:block absolute top-5 left-1/2 w-full h-0.5 ${isDone ? 'bg-brand-400' : 'bg-slate-200'}`} />
        </>
      )}

      {/* Dot */}
      <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-sm flex-shrink-0 transition-all md:mx-auto ${
        isDone
          ? 'bg-brand-600 text-white shadow-sm'
          : isActive
          ? 'bg-blue-500 text-white shadow-sm ring-4 ring-blue-100'
          : 'bg-slate-100 text-slate-400'
      }`}>
        {isDone ? (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : isActive ? (
          <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
        ) : (
          <span className="w-2 h-2 rounded-full bg-slate-300" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6 md:pb-0 md:mt-3 md:text-center">
        <p className={`text-sm font-semibold ${isPending ? 'text-slate-400' : 'text-slate-900'}`}>
          {step.label}
        </p>

        {isActive && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Active
          </span>
        )}

        {step.timestamp && (
          <p className="text-xs text-slate-500 mt-1">{formatDateTime(step.timestamp)}</p>
        )}

        {step.location && (
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1 md:justify-center">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {step.location}
          </p>
        )}

        {step.txHash && (
          <a
            href={`${STELLAR_EXPLORER}/${step.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[10px] font-mono text-brand-600 hover:text-brand-700 hover:underline mt-1 truncate max-w-[120px] md:max-w-full"
            title={step.txHash}
          >
            TX: {step.txHash.slice(0, 12)}…
          </a>
        )}

        {step.notes && (
          <p className="text-xs text-slate-400 mt-1 italic">{step.notes}</p>
        )}
      </div>
    </li>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */
export const ShipmentStepper: React.FC<ShipmentStepperProps> = ({ steps, className = '' }) => {
  if (!steps.length) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-slate-400 text-sm">No shipment steps available</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <h3 className="section-title mb-4">Shipment Progress</h3>
      <ol className="flex flex-col md:flex-row md:items-start md:gap-0 gap-0">
        {steps.map((step, idx) => (
          // eslint-disable-next-line react/jsx-key
          <React.Fragment key={step.id}>
            <StepNode step={step} isLast={idx === steps.length - 1} />
          </React.Fragment>
        ))}
      </ol>
    </div>
  );
};
