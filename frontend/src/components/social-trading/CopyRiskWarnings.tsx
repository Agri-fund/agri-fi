'use client';

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { RiskSeverity, RiskWarning } from '@/lib/social-trading/types';

export interface CopyRiskWarningsProps {
  warnings: RiskWarning[];
  heading?: string;
}

const SEVERITY_ORDER: RiskSeverity[] = ['critical', 'warning', 'info'];

const SEVERITY_STYLES: Record<RiskSeverity, string> = {
  critical:
    'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300',
  warning:
    'border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300',
  info: 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300',
};

const SEVERITY_LABELS: Record<RiskSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Note',
};

export const CopyRiskWarnings: React.FC<CopyRiskWarningsProps> = ({ warnings, heading }) => {
  const sorted = [...warnings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );

  return (
    <section aria-label={heading ?? 'Copy risk warnings'} className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
        <ShieldAlert size={15} aria-hidden="true" />
        {heading ?? 'Risk warnings'}
        <span className="ml-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          ({warnings.length})
        </span>
      </h4>
      {sorted.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No risk warnings were raised for this configuration.
        </p>
      )}
      <ul className="space-y-2">
        {sorted.map((warning) => (
          <li
            key={`${warning.severity}:${warning.code}`}
            role={warning.severity === 'critical' ? 'alert' : 'status'}
            className={`rounded-xl border p-3 text-xs ${SEVERITY_STYLES[warning.severity]}`}
          >
            <p className="font-bold">
              {SEVERITY_LABELS[warning.severity]}: {warning.message}
            </p>
            <p className="mt-1 font-medium opacity-90">Mitigation: {warning.mitigation}</p>
          </li>
        ))}
      </ul>
    </section>
  );
};
