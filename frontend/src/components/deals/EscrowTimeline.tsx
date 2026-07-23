'use client';

import React from 'react';

export type DealLifecycleStatus = 'created' | 'funded' | 'in_transit' | 'delivered' | 'settled';

export interface EscrowEvent {
  status: DealLifecycleStatus;
  /** Actual execution timestamp (ISO string) — present when the event has occurred */
  executedAt?: string;
  /** Target / estimated date (ISO string) */
  targetDate?: string;
}

interface EscrowTimelineProps {
  events: EscrowEvent[];
  /** Current lifecycle status of the deal */
  currentStatus: DealLifecycleStatus;
  className?: string;
}

const STEPS: { status: DealLifecycleStatus; label: string; icon: string; description: string }[] = [
  { status: 'created',    label: 'Deal Created',      icon: '📋', description: 'Trade deal listed on-chain' },
  { status: 'funded',     label: 'Capital Locked',    icon: '🔒', description: 'Investor funds held in escrow' },
  { status: 'in_transit', label: 'In Transit',        icon: '🚢', description: 'Shipment milestones in progress' },
  { status: 'delivered',  label: 'Delivered',         icon: '📦', description: 'Goods received by importer' },
  { status: 'settled',    label: 'Settled',           icon: '✅', description: 'Escrow released to farmer' },
];

const STATUS_ORDER: Record<DealLifecycleStatus, number> = {
  created: 0, funded: 1, in_transit: 2, delivered: 3, settled: 4,
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function isOverdue(event: EscrowEvent, currentStatus: DealLifecycleStatus): boolean {
  if (!event.targetDate || event.executedAt) return false;
  const stepIdx = STATUS_ORDER[event.status];
  const currentIdx = STATUS_ORDER[currentStatus];
  // Only warn if this step hasn't happened yet but target date has passed
  if (stepIdx <= currentIdx) return false;
  return new Date(event.targetDate) < new Date();
}

export const EscrowTimeline: React.FC<EscrowTimelineProps> = ({
  events, currentStatus, className = '',
}) => {
  const eventMap = new Map<DealLifecycleStatus, EscrowEvent>(events.map(e => [e.status, e]));
  const currentIdx = STATUS_ORDER[currentStatus];

  return (
    <div className={`space-y-4 ${className}`}>
      <h3 className="section-title">Escrow Release Timeline</h3>

      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-[19px] top-5 bottom-5 w-0.5 bg-slate-100" />

        <ol className="space-y-0">
          {STEPS.map((step, idx) => {
            const event    = eventMap.get(step.status);
            const stepIdx  = STATUS_ORDER[step.status];
            const isDone   = stepIdx < currentIdx || (stepIdx === currentIdx && event?.executedAt);
            const isActive = stepIdx === currentIdx && !event?.executedAt;
            const isPending = stepIdx > currentIdx;
            const overdue  = event ? isOverdue(event, currentStatus) : false;

            return (
              <li key={step.status} className="relative flex items-start gap-4 pb-6 last:pb-0">
                {/* Step dot */}
                <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0 transition-all ${
                  isDone
                    ? 'bg-brand-600 text-white shadow-sm'
                    : isActive
                    ? 'bg-blue-500 text-white shadow-sm ring-4 ring-blue-100'
                    : 'bg-slate-100 text-slate-400'
                }`}>
                  {isDone ? '✓' : step.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`text-sm font-semibold ${isPending ? 'text-slate-400' : 'text-slate-900'}`}>
                      {step.label}
                    </p>

                    {/* Overdue warning */}
                    {overdue && (
                      <span className="badge-red text-[10px] py-0 px-2">⚠ Overdue</span>
                    )}

                    {/* Active indicator */}
                    {isActive && (
                      <span className="badge-blue text-[10px] py-0 px-2">In Progress</span>
                    )}
                  </div>

                  <p className={`text-xs mt-0.5 ${isPending ? 'text-slate-300' : 'text-slate-500'}`}>
                    {step.description}
                  </p>

                  {/* Timestamps */}
                  <div className="mt-1.5 space-y-0.5">
                    {event?.executedAt && (
                      <p className="text-xs text-brand-600 font-medium">
                        ✓ Executed {formatDateTime(event.executedAt)}
                      </p>
                    )}
                    {event?.targetDate && !event.executedAt && (
                      <p className={`text-xs font-medium ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
                        Target: {formatDate(event.targetDate)}
                      </p>
                    )}
                    {event?.targetDate && event.executedAt && (
                      <p className="text-xs text-slate-400">
                        Target was: {formatDate(event.targetDate)}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};
