'use client';

import React from 'react';
import { Bell, ShieldAlert } from 'lucide-react';
import { REJECTION_MESSAGES } from '@/lib/social-trading/copy-trading';
import type {
  CopyConfig,
  CopyMode,
  FieldError,
  SimulationResult,
} from '@/lib/social-trading/types';
import type { CopyAutoStopStatus } from '@/hooks/useCopyTrading';

export interface CopyTradingControlsProps {
  config: CopyConfig;
  fieldErrors: FieldError[];
  dryRun: SimulationResult;
  onChangeConfig: (patch: Partial<CopyConfig>) => void;
  onSave: () => void;
  onSubmitOrders: () => void;
  onRemoveBlacklistEntry?: (entry: string) => void;
  remainingAllowanceUsd: number;
  followingTrader: boolean;
  autoStop: CopyAutoStopStatus;
  onResumeCopying: () => void;
  traderName?: string;
}

const MODE_LABELS: Record<CopyMode, string> = {
  proportional: 'Proportional (mirror the leader weight)',
  fixed: 'Fixed (flat ticket per trade)',
  inverse_risk: 'Inverse risk (risk budget scaled by deal risk)',
};

const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export const CopyTradingControls: React.FC<CopyTradingControlsProps> = ({
  config,
  fieldErrors,
  dryRun,
  onChangeConfig,
  onSave,
  onSubmitOrders,
  remainingAllowanceUsd,
  followingTrader,
  autoStop,
  onResumeCopying,
  traderName,
}) => {
  const errorsFor = (path: string) => fieldErrors.filter((e) => e.path === path);

  const numberField = (
    key: 'maxPerTrade' | 'monthlyLimit' | 'minTradeValue' | 'autoStopLossPct' | 'autoTakeProfitPct' | 'maxDrawdownPct' | 'allocationPct' | 'fixedAmountUsd' | 'riskBudgetPct',
    label: string,
    suffix: 'usd' | 'pct',
  ) => {
    const errors = errorsFor(key);
    const errorId = `copycfg-${key}-error`;
    return (
      <div key={key}>
        <label htmlFor={`copycfg-${key}`} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
        </label>
        <input
          id={`copycfg-${key}`}
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(config[key]) ? config[key] : ''}
          onChange={(e) => onChangeConfig({ [key]: e.target.valueAsNumber } as Partial<CopyConfig>)}
          aria-label={label}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length > 0 ? errorId : undefined}
          className={`mt-1 w-full px-3 py-2 rounded-xl border bg-white dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white ${
            errors.length > 0
              ? 'border-red-400 dark:border-red-700'
              : 'border-slate-200 dark:border-slate-700'
          }`}
        />
        {suffix === 'usd' && (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Amount in USD</span>
        )}
        {errors.length > 0 && (
          <p id={errorId} role="alert" className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
            {errors.map((e) => e.message).join(' ')}
          </p>
        )}
      </div>
    );
  };

  const blacklistErrors = errorsFor('blacklist');

  return (
    <section
      aria-label={`Copy trading controls${traderName ? ` for ${traderName}` : ''}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-6"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Copy trading settings</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {traderName ? `Mirroring ${traderName}` : `Mirroring trader ${config.traderId}`} ·{' '}
            {followingTrader ? 'you follow this trader' : 'you do not follow this trader yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            aria-label="Save copy configuration"
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Save settings
          </button>
          <button
            type="button"
            onClick={onSubmitOrders}
            disabled={!dryRun.orders.length}
            aria-label="Submit planned copy orders"
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:opacity-40 text-white shadow-lg shadow-emerald-600/20 transition"
          >
            Execute dry run
          </button>
        </div>
      </div>

      {autoStop.active && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-800 dark:text-red-300"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <ShieldAlert size={14} aria-hidden="true" />
            Auto-stop is active: {autoStop.reason ?? 'Copying is paused.'}
          </span>
          <button
            type="button"
            onClick={onResumeCopying}
            aria-label="Resume copying after auto-stop"
            className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-[11px] transition"
          >
            Resume copying
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label htmlFor="copycfg-mode" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Copy mode
          </label>
          <select
            id="copycfg-mode"
            value={config.mode}
            onChange={(e) => onChangeConfig({ mode: e.target.value as CopyMode })}
            aria-label="Copy mode"
            className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-white"
          >
            {(Object.keys(MODE_LABELS) as CopyMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>

        {config.mode === 'proportional' && numberField('allocationPct', 'Allocation percentage', 'pct')}
        {config.mode === 'fixed' && numberField('fixedAmountUsd', 'Fixed copy amount (USD)', 'usd')}
        {config.mode === 'inverse_risk' && numberField('riskBudgetPct', 'Risk budget percentage', 'pct')}

        {numberField('maxPerTrade', 'Maximum per trade (USD)', 'usd')}
        {numberField('monthlyLimit', 'Monthly limit (USD)', 'usd')}
        {numberField('minTradeValue', 'Minimum trade value (USD)', 'usd')}
        {numberField('autoStopLossPct', 'Auto stop-loss percentage', 'pct')}
        {numberField('autoTakeProfitPct', 'Auto take-profit percentage', 'pct')}
        {numberField('maxDrawdownPct', 'Maximum drawdown percentage', 'pct')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="copycfg-blacklist" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Blacklist (comma-separated commodities, regions or deal ids)
          </label>
          <input
            id="copycfg-blacklist"
            type="text"
            value={config.blacklist.join(', ')}
            onChange={(e) =>
              onChangeConfig({
                blacklist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }
            aria-label="Blacklist"
            aria-invalid={blacklistErrors.length > 0}
            placeholder="e.g. Coffee, Sesame"
            className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
          />
          {config.blacklist.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {config.blacklist.map((entry) => (
                <span
                  key={entry}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                >
                  {entry}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Bell size={13} aria-hidden="true" />
            <input
              type="checkbox"
              checked={config.notifications}
              onChange={(e) => onChangeConfig({ notifications: e.target.checked })}
              aria-label="Receive notifications for copied trades"
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Receive notifications for copied trades
          </label>
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => onChangeConfig({ enabled: e.target.checked })}
              aria-label="Enable copy trading"
              className="rounded border-slate-300 dark:border-slate-600"
            />
            Enable copy trading
          </label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Fee on each copied ticket: {(config.feeBps / 100).toFixed(2)}% ({config.feeBps} bps)
          </p>
        </div>
      </div>

      <div data-testid="dry-run-summary" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-3">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Live dry run</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div>
            <span className="text-slate-500 dark:text-slate-400">Deployed</span>
            <p className="font-black text-slate-900 dark:text-white text-base">{usd(dryRun.deployedUsd)}</p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Estimated fees</span>
            <p className="font-black text-slate-900 dark:text-white text-base">{usd(dryRun.feesUsd)}</p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Simulated return</span>
            <p
              className={`font-black text-base ${
                dryRun.simulatedReturnPct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {dryRun.simulatedReturnPct}%
            </p>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400">Remaining monthly allowance</span>
            <p className="font-black text-slate-900 dark:text-white text-base">{usd(remainingAllowanceUsd)}</p>
          </div>
        </div>

        <div>
          <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
            Planned orders ({dryRun.orders.length})
          </h5>
          {dryRun.orders.length === 0 ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {fieldErrors.length > 0
                ? 'No orders are planned while the configuration has validation errors.'
                : 'No orders were planned for the leader trades in this window.'}
            </p>
          ) : (
            <ul className="space-y-1">
              {dryRun.orders.map((order) => (
                <li
                  key={order.id}
                  data-testid="planned-order"
                  className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {order.dealId} · {order.commodity} ({order.region})
                  </span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {usd(order.amountUsd)} · fee {usd(order.feeUsd)} · basis {order.sizingBasis}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {dryRun.rejections.length > 0 && (
          <div>
            <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Rejected orders ({dryRun.rejections.length})
            </h5>
            <ul className="space-y-1">
              {dryRun.rejections.map((rejection, index) => (
                <li
                  key={`${rejection.code}:${index}`}
                  data-testid="copy-rejection"
                  className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300"
                >
                  <span className="font-black uppercase tracking-wide">{rejection.code}</span>
                  {' — '}
                  {REJECTION_MESSAGES[rejection.code] ?? rejection.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};
